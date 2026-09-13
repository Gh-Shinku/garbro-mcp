import { BufferByteSource } from "@garbro-mcp/core";
import { desImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const PALETTE_OFFSET = 4;
const BMP_HEADER_SIZE = 54;
const BMP_DATA_OFFSET = BMP_HEADER_SIZE + 16 * 4;

const WIDTH = 16;
const HEIGHT = 4;
const STREAM_BYTES = 0x200;

/** Sixteen RGB triples, with each channel a different function so a swap would show. */
function buildPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(48);
	for (let i = 0; i < 16; i += 1) {
		palette[i * 3] = (i * 11 + 1) & 0xff;
		palette[i * 3 + 1] = (i * 5 + 2) & 0xff;
		palette[i * 3 + 2] = (i * 17 + 3) & 0xff;
	}
	return palette;
}

function buildDes(
	width = WIDTH,
	height = HEIGHT,
	stream = STREAM_BYTES,
): Buffer {
	const header: Buffer = Buffer.alloc(PALETTE_OFFSET, 0x00);
	header.writeUInt16BE(width, 0);
	header.writeUInt16BE(height, 2);
	return Buffer.concat([header, buildPalette(), Buffer.alloc(stream)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("desire des image", () => {
	it("declares no signature, since the reference has none", () => {
		expect(desImageFormat.detection?.signatures).toEqual([]);
	});

	it("decodes a four bit bitmap", async () => {
		const stored = buildDes();
		const source = sourceOf(stored);
		expect(await desImageFormat.detect(source, "CG01.DES")).toBe(true);
		const archive = await desImageFormat.open(source, "CG01.DES");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 4,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(4);
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			const palette = buildPalette();
			for (let i = 0; i < 16; i += 1) {
				expect(output[BMP_HEADER_SIZE + i * 4 + 2]).toBe(palette[i * 3]);
			}
			// The same zero stream the System98 decoder tests use, so the traced bytes carry over.
			expect(output.subarray(BMP_DATA_OFFSET, BMP_DATA_OFFSET + 8)).toEqual(
				Buffer.from([0xec, 0xa8, 0xec, 0xb9, 0xec, 0xca, 0xec, 0xba]),
			);
		} finally {
			await archive.close();
		}
	});

	it("lists a header only file but fails to extract it", async () => {
		// Four bytes are enough to list, while the palette needs forty eight more.
		const stored = buildDes().subarray(0, 20);
		expect(await desImageFormat.detect(sourceOf(stored), "CG01.DES")).toBe(
			true,
		);
		const archive = await desImageFormat.open(sourceOf(stored), "CG01.DES");
		try {
			expect(archive.entries).toHaveLength(1);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines a file too short for the dimensions", async () => {
		expect(
			await desImageFormat.detect(sourceOf(Buffer.alloc(3)), "CG01.DES"),
		).toBe(false);
	});

	it("declines zero dimensions", async () => {
		expect(
			await desImageFormat.detect(sourceOf(buildDes(0, HEIGHT)), "CG01.DES"),
		).toBe(false);
		expect(
			await desImageFormat.detect(sourceOf(buildDes(WIDTH, 0)), "CG01.DES"),
		).toBe(false);
	});

	it("declines a width that is not a multiple of eight", async () => {
		expect(
			await desImageFormat.detect(sourceOf(buildDes(12, HEIGHT)), "CG01.DES"),
		).toBe(false);
	});

	it("declines dimensions past the screen bounds", async () => {
		expect(
			await desImageFormat.detect(sourceOf(buildDes(648, HEIGHT)), "CG01.DES"),
		).toBe(false);
		expect(
			await desImageFormat.detect(sourceOf(buildDes(WIDTH, 408)), "CG01.DES"),
		).toBe(false);
	});
});
