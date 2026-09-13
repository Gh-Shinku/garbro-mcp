import { BufferByteSource } from "@garbro-mcp/core";
import { ugImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const PIXEL_OFFSET = 0x28;
const BMP_HEADER_SIZE = 54;
const BMP_DATA_OFFSET = BMP_HEADER_SIZE + 16 * 4;

const LEFT = 3;
const TOP = 1;
/** Two column units, so the width is sixteen pixels. */
const RIGHT = LEFT + 1;
const BOTTOM = TOP + 3;

function buildPalette(): Buffer {
	const words: Buffer = Buffer.alloc(32);
	for (let i = 0; i < 16; i += 1) {
		const blue = (i * 3) & 0xf;
		const red = (15 - i) & 0xf;
		const green = (i * 5) & 0xf;
		words.writeUInt16LE(blue | (red << 4) | (green << 8), i * 2);
	}
	return words;
}

function buildUg(options: {
	left?: number;
	top?: number;
	right?: number;
	bottom?: number;
	stream?: number;
	withPalette?: boolean;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeUInt16LE(options.left ?? LEFT, 0);
	header.writeUInt16LE(options.top ?? TOP, 2);
	header.writeUInt16LE(options.right ?? RIGHT, 4);
	header.writeUInt16LE(options.bottom ?? BOTTOM, 6);
	const palette =
		options.withPalette === false ? Buffer.alloc(0) : buildPalette();
	return Buffer.concat([
		header,
		palette,
		Buffer.alloc(options.stream ?? 0x200),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("ucom ug image", () => {
	it("declares no signature, since the reference has none", () => {
		expect(ugImageFormat.detection?.signatures).toEqual([]);
		expect(ugImageFormat.descriptor.extensions).toEqual(["ug"]);
	});

	it("decodes a vertical scanline four bit bitmap", async () => {
		const stored = buildUg({});
		const source = sourceOf(stored);
		expect(await ugImageFormat.detect(source, "CG01.UG")).toBe(true);
		const archive = await ugImageFormat.open(source, "CG01.UG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			// Two column units and four rows.
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 16,
				height: 4,
				bitsPerPixel: 4,
				colors: 16,
				offsetX: LEFT,
				offsetY: TOP,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(4);
			expect(output.readInt32LE(22)).toBe(-4);
			const palette = buildPalette();
			for (let i = 0; i < 16; i += 1) {
				const word = palette.readUInt16LE(i * 2);
				expect(output[BMP_HEADER_SIZE + i * 4]).toBe((word & 0xf) * 0x11);
				expect(output[BMP_HEADER_SIZE + i * 4 + 1]).toBe(
					((word >> 8) & 0xf) * 0x11,
				);
				expect(output[BMP_HEADER_SIZE + i * 4 + 2]).toBe(
					((word >> 4) & 0xf) * 0x11,
				);
			}
			const stride = 8;
			expect(output.length).toBe(BMP_DATA_OFFSET + stride * 4);
			// The vertical decoder still fills the ring from its opening pair, so the zero stream does not
			// produce an empty image.
			expect([...output.subarray(BMP_DATA_OFFSET)].some((b) => b !== 0)).toBe(
				true,
			);
		} finally {
			await archive.close();
		}
	});

	it("is deterministic for the same stream", async () => {
		const stored = buildUg({});
		const first = await ugImageFormat.open(sourceOf(stored), "CG01.UG");
		const second = await ugImageFormat.open(sourceOf(stored), "CG01.UG");
		try {
			const a = first.entries[0];
			const b = second.entries[0];
			if (!a || !b) throw new Error("missing entry");
			const outA = await consumeBuffer(await first.openEntry(a.id));
			const outB = await consumeBuffer(await second.openEntry(b.id));
			expect(outA).toEqual(outB);
		} finally {
			await first.close();
			await second.close();
		}
	});

	it("requires the ug extension", async () => {
		const stored = buildUg({});
		expect(await ugImageFormat.detect(sourceOf(stored), "CG01.GRA")).toBe(
			false,
		);
		expect(await ugImageFormat.detect(sourceOf(stored), "CG01.ug")).toBe(true);
	});

	it("derives the size from the source rectangle", async () => {
		// Four column units and three rows, with a rectangle that does not start at zero.
		const stored = buildUg({ left: 7, right: 10, top: 2, bottom: 4 });
		const archive = await ugImageFormat.open(sourceOf(stored), "CG01.UG");
		try {
			expect(archive.metadata).toMatchObject({
				width: 32,
				height: 3,
				offsetX: 7,
				offsetY: 2,
			});
		} finally {
			await archive.close();
		}
	});

	it("lists a file with no palette but fails to extract it", async () => {
		const stored = buildUg({ withPalette: false, stream: 0 });
		expect(stored.length).toBe(HEADER_SIZE);
		expect(await ugImageFormat.detect(sourceOf(stored), "CG01.UG")).toBe(true);
		const archive = await ugImageFormat.open(sourceOf(stored), "CG01.UG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("decodes a file with no stream as a partial image", async () => {
		const stored = buildUg({ stream: 0 });
		expect(stored.length).toBe(PIXEL_OFFSET);
		const archive = await ugImageFormat.open(sourceOf(stored), "CG01.UG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_DATA_OFFSET + 8 * 4);
		} finally {
			await archive.close();
		}
	});

	it("declines an inverted or oversized rectangle", async () => {
		// A right edge left of the left edge makes the width negative.
		expect(
			await ugImageFormat.detect(
				sourceOf(buildUg({ left: 10, right: 5 })),
				"CG01.UG",
			),
		).toBe(false);
		// Eighty one column units are 648 pixels, past the 640 limit.
		expect(
			await ugImageFormat.detect(
				sourceOf(buildUg({ left: 0, right: 80 })),
				"CG01.UG",
			),
		).toBe(false);
		expect(
			await ugImageFormat.detect(
				sourceOf(buildUg({ top: 0, bottom: 512 })),
				"CG01.UG",
			),
		).toBe(false);
	});

	it("declines a file that stops inside the header", async () => {
		const stored = buildUg({}).subarray(0, HEADER_SIZE - 1);
		expect(await ugImageFormat.detect(sourceOf(stored), "CG01.UG")).toBe(false);
	});
});
