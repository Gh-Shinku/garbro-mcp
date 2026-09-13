import { BufferByteSource } from "@garbro-mcp/core";
import { dpcImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_OFFSET = 0x20;
const PALETTE_OFFSET = 0x28;
const BMP_HEADER_SIZE = 54;
const BMP_DATA_OFFSET = BMP_HEADER_SIZE + 16 * 4;

const WIDTH = 16;
const HEIGHT = 4;
const STREAM_BYTES = 0x200;

function buildDpc(options: {
	width?: number;
	height?: number;
	left?: number;
	top?: number;
	words?: Buffer;
}): Buffer {
	const header: Buffer = Buffer.alloc(PALETTE_OFFSET + 48, 0x00);
	header.writeInt16LE(options.left ?? 0, HEADER_OFFSET);
	header.writeInt16LE(options.top ?? 0, HEADER_OFFSET + 2);
	header.writeUInt16LE(options.width ?? WIDTH, HEADER_OFFSET + 4);
	header.writeUInt16LE(options.height ?? HEIGHT, HEADER_OFFSET + 6);
	if (options.words) options.words.copy(header, PALETTE_OFFSET);
	return Buffer.concat([header, Buffer.alloc(STREAM_BYTES)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("desire dpc image", () => {
	it("declares no signature, since the reference has none", () => {
		expect(dpcImageFormat.detection?.signatures).toEqual([]);
	});

	it("decodes a four bit bitmap", async () => {
		const stored = buildDpc({});
		const source = sourceOf(stored);
		expect(await dpcImageFormat.detect(source, "CG01.DPC")).toBe(true);
		const archive = await dpcImageFormat.open(source, "CG01.DPC");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
				colors: 16,
				offsetX: 0,
				offsetY: 0,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(4);
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			// A zero palette leaves the stream's first bytes zero, so the traced decode applies.
			expect(output.subarray(BMP_DATA_OFFSET, BMP_DATA_OFFSET + 8)).toEqual(
				Buffer.from([0xec, 0xa8, 0xec, 0xb9, 0xec, 0xca, 0xec, 0xba]),
			);
		} finally {
			await archive.close();
		}
	});

	it("decodes the packed palette words", async () => {
		// One word per colour, each channel a nibble: green in the top four bits, red below it, blue below
		// that, and the low bit an alpha flag.
		const words: Buffer = Buffer.alloc(32);
		for (let i = 0; i < 16; i += 1) {
			const green = i & 0xf;
			const red = (15 - i) & 0xf;
			const blue = (i * 3) & 0xf;
			words.writeUInt16LE(
				(green << 12) | (red << 7) | (blue << 2) | (i & 1),
				i * 2,
			);
		}
		const stored = buildDpc({ words });
		const archive = await dpcImageFormat.open(sourceOf(stored), "CG01.DPC");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			for (let i = 0; i < 16; i += 1) {
				const green = i & 0xf;
				const red = (15 - i) & 0xf;
				const blue = (i * 3) & 0xf;
				expect(output[BMP_HEADER_SIZE + i * 4]).toBe(blue * 0x11);
				expect(output[BMP_HEADER_SIZE + i * 4 + 1]).toBe(green * 0x11);
				expect(output[BMP_HEADER_SIZE + i * 4 + 2]).toBe(red * 0x11);
			}
			// The same words are the start of the compressed stream, so the pixels are no longer the zero
			// stream decode.
			expect(output.subarray(BMP_DATA_OFFSET, BMP_DATA_OFFSET + 8)).not.toEqual(
				Buffer.from([0xec, 0xa8, 0xec, 0xb9, 0xec, 0xca, 0xec, 0xba]),
			);
		} finally {
			await archive.close();
		}
	});

	it("requires the dpc extension", async () => {
		const stored = buildDpc({});
		expect(await dpcImageFormat.detect(sourceOf(stored), "CG01.DES")).toBe(
			false,
		);
		expect(await dpcImageFormat.detect(sourceOf(stored), "CG01.dpc")).toBe(
			true,
		);
	});

	it("records the source rectangle", async () => {
		const stored = buildDpc({ left: 12, top: 7 });
		const archive = await dpcImageFormat.open(sourceOf(stored), "CG01.DPC");
		try {
			expect(archive.metadata).toMatchObject({ offsetX: 12, offsetY: 7 });
		} finally {
			await archive.close();
		}
	});

	it("declines zero dimensions", async () => {
		expect(
			await dpcImageFormat.detect(sourceOf(buildDpc({ width: 0 })), "CG01.DPC"),
		).toBe(false);
		expect(
			await dpcImageFormat.detect(
				sourceOf(buildDpc({ height: 0 })),
				"CG01.DPC",
			),
		).toBe(false);
	});

	it("declines a rectangle that leaves the canvas", async () => {
		// The canvas is 2048 square, and both of these overhang it by eight pixels.
		expect(
			await dpcImageFormat.detect(
				sourceOf(buildDpc({ left: 2040, width: 16 })),
				"CG01.DPC",
			),
		).toBe(false);
		expect(
			await dpcImageFormat.detect(
				sourceOf(buildDpc({ top: 2040, height: 16 })),
				"CG01.DPC",
			),
		).toBe(false);
	});

	it("declines a negative origin", async () => {
		expect(
			await dpcImageFormat.detect(sourceOf(buildDpc({ left: -1 })), "CG01.DPC"),
		).toBe(false);
		expect(
			await dpcImageFormat.detect(sourceOf(buildDpc({ top: -1 })), "CG01.DPC"),
		).toBe(false);
	});

	it("declines a file that stops inside the header", async () => {
		const stored = buildDpc({}).subarray(0, HEADER_OFFSET + 7);
		expect(await dpcImageFormat.detect(sourceOf(stored), "CG01.DPC")).toBe(
			false,
		);
	});
});
