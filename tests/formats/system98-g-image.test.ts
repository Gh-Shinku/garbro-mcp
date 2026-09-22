import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { system98GImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

const PALETTE_OFFSET = 0x0a;
const BMP_HEADER_SIZE = 54;
const BMP_PALETTE_SIZE = 16 * 4;
const BMP_DATA_OFFSET = BMP_HEADER_SIZE + BMP_PALETTE_SIZE;

const WIDTH = 16;
const HEIGHT = 4;
const STREAM_BYTES = 0x200;

/** Sixteen RGB triples with distinct channels, so a swapped channel would change the output. */
function buildPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(48);
	for (let i = 0; i < 16; i += 1) {
		palette[i * 3] = (i * 13 + 1) & 0xff;
		palette[i * 3 + 1] = (i * 7 + 2) & 0xff;
		palette[i * 3 + 2] = (i * 3 + 3) & 0xff;
	}
	return palette;
}

function buildG(
	width = WIDTH,
	height = HEIGHT,
	stream = STREAM_BYTES,
	palette = true,
): Buffer {
	const header: Buffer = Buffer.alloc(PALETTE_OFFSET, 0x00);
	header.writeUInt16BE(width, 6);
	header.writeUInt16BE(height, 8);
	const body = palette ? buildPalette() : Buffer.alloc(0);
	// A zero bit stream is the one input whose output can be derived by hand.
	return Buffer.concat([header, body, Buffer.alloc(stream)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("system98 g image", () => {
	it("declares no signature, since the reference has none", () => {
		expect(system98GImageFormat.detection?.signatures).toEqual([]);
		expect(system98GImageFormat.detection?.extensionOnly).toBe(true);
	});

	it("decodes a four bit bitmap", async () => {
		const stored = buildG();
		const source = sourceOf(stored);
		expect(await system98GImageFormat.detect(source, "CG01.G")).toBe(true);
		const archive = await system98GImageFormat.open(source, "CG01.G");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 4,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
				colors: 16,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(4);
			expect(output.readUInt32LE(46)).toBe(16);
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			// The palette is stored as RGB and written as BGRX.
			const palette = buildPalette();
			for (let i = 0; i < 16; i += 1) {
				expect(output[BMP_HEADER_SIZE + i * 4]).toBe(palette[i * 3 + 2]);
				expect(output[BMP_HEADER_SIZE + i * 4 + 1]).toBe(palette[i * 3 + 1]);
				expect(output[BMP_HEADER_SIZE + i * 4 + 2]).toBe(palette[i * 3]);
				expect(output[BMP_HEADER_SIZE + i * 4 + 3]).toBe(0);
			}
			// The first row is eight bytes of packed nibbles, which already satisfies the bitmap's
			// four byte row alignment, so there is no padding.
			const stride = 8;
			expect(output.length).toBe(BMP_DATA_OFFSET + stride * HEIGHT);
			expect(output.subarray(BMP_DATA_OFFSET, BMP_DATA_OFFSET + 8)).toEqual(
				Buffer.from([0xec, 0xa8, 0xec, 0xb9, 0xec, 0xca, 0xec, 0xba]),
			);
		} finally {
			await archive.close();
		}
	});

	it("decodes the minimum length file as a partial image", async () => {
		// Sixty one bytes is the reference's minimum, which is exactly the header, the sixteen colours and
		// three stream bytes; the missing palette case cannot arise here because the minimum covers it.
		const stored = buildG(WIDTH, HEIGHT, 3);
		expect(stored.length).toBe(61);
		expect(await system98GImageFormat.detect(sourceOf(stored), "CG01.G")).toBe(
			true,
		);
		const archive = await system98GImageFormat.open(sourceOf(stored), "CG01.G");
		try {
			expect(archive.entries).toHaveLength(1);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_DATA_OFFSET + 8 * HEIGHT);
		} finally {
			await archive.close();
		}
	});

	it("decodes a truncated stream as a partial image", async () => {
		// Three stream bytes are enough for the opening pair and a little more; the decoder flushes what it
		// has when the bits run out instead of failing.
		const stored = buildG(WIDTH, HEIGHT, 3);
		const archive = await system98GImageFormat.open(sourceOf(stored), "CG01.G");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_DATA_OFFSET + 8 * HEIGHT);
			// The decoder flushes the ring when the bits run out, so the output exists and starts with the
			// pairs it managed to write before the stream ended.
			expect(output[BMP_DATA_OFFSET]).not.toBe(0x00);
		} finally {
			await archive.close();
		}
	});

	it("declines a file shorter than the reference minimum", async () => {
		const stored = buildG().subarray(0, 60);
		expect(await system98GImageFormat.detect(sourceOf(stored), "CG01.G")).toBe(
			false,
		);
	});

	it("declines zero dimensions", async () => {
		expect(
			await system98GImageFormat.detect(sourceOf(buildG(0, HEIGHT)), "CG01.G"),
		).toBe(false);
		expect(
			await system98GImageFormat.detect(sourceOf(buildG(WIDTH, 0)), "CG01.G"),
		).toBe(false);
	});

	it("declines a width that is not a multiple of eight", async () => {
		expect(
			await system98GImageFormat.detect(sourceOf(buildG(10, HEIGHT)), "CG01.G"),
		).toBe(false);
	});

	it("declines dimensions past the screen bounds", async () => {
		// Both are multiples of eight, so the bounds are what reject them.
		expect(
			await system98GImageFormat.detect(
				sourceOf(buildG(648, HEIGHT)),
				"CG01.G",
			),
		).toBe(false);
		expect(
			await system98GImageFormat.detect(sourceOf(buildG(WIDTH, 408)), "CG01.G"),
		).toBe(false);
	});
});
