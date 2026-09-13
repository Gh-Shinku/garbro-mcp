import { BufferByteSource } from "@garbro-mcp/core";
import { tiareGraImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x30;
const BMP_HEADER_SIZE = 54;
const BMP_DATA_OFFSET = BMP_HEADER_SIZE + 16 * 4;
const DESCRIPTION = Buffer.from("GRA\0", "latin1");
/** The cursor after the description: the flags byte sits here and the fields start eight bytes later. */
const FLAGS_OFFSET = 1 + DESCRIPTION.length;
const FIELDS_OFFSET = FLAGS_OFFSET + 8;

const WIDTH = 16;
const HEIGHT = 4;
const STREAM_BYTES = 0x200;

function buildPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(48);
	for (let i = 0; i < 16; i += 1) {
		palette[i * 3] = (i * 9 + 1) & 0xff;
		palette[i * 3 + 1] = (i * 4 + 2) & 0xff;
		palette[i * 3 + 2] = (i * 6 + 3) & 0xff;
	}
	return palette;
}

function buildGra(options: {
	flags?: number;
	width?: number;
	height?: number;
	skip?: number;
	marker?: number;
	bppMarker?: number;
	terminator?: boolean;
	stream?: number;
}): Buffer {
	const skip = options.skip ?? 0;
	const dataOffset = FIELDS_OFFSET + 2 + skip + 4;
	const total =
		Math.max(HEADER_SIZE, dataOffset) + 48 + (options.stream ?? STREAM_BYTES);
	const file: Buffer = Buffer.alloc(total, 0x00);
	file[0] = options.marker ?? 0x1a;
	DESCRIPTION.copy(file, 1);
	if (options.terminator === false) {
		// No zero terminator: fill the rest of the window with description bytes.
		file.fill(0x41, FLAGS_OFFSET - 1, HEADER_SIZE);
		return file;
	}
	file[FLAGS_OFFSET] = options.flags ?? 0;
	file[FLAGS_OFFSET + 3] = options.bppMarker ?? 4;
	file.writeUInt16BE(skip, FIELDS_OFFSET);
	const dims = FIELDS_OFFSET + 2 + skip;
	file.writeUInt16BE(options.width ?? WIDTH, dims);
	file.writeUInt16BE(options.height ?? HEIGHT, dims + 2);
	// A palette follows the dimensions, then the stream; the skipped region is filled with a marker.
	if (skip > 0) file.fill(0xab, FIELDS_OFFSET + 2, dims);
	buildPalette().copy(file, dims + 4);
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("tiare gra image", () => {
	it("declares no signature, since the reference has none", () => {
		expect(tiareGraImageFormat.detection?.signatures).toEqual([]);
	});

	it("decodes a four bit bitmap with its own palette", async () => {
		const stored = buildGra({});
		const source = sourceOf(stored);
		expect(await tiareGraImageFormat.detect(source, "CG01.GRA")).toBe(true);
		const archive = await tiareGraImageFormat.open(source, "CG01.GRA");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
				colors: 16,
				hasPalette: true,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(4);
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			const palette = buildPalette();
			for (let i = 0; i < 16; i += 1) {
				expect(output[BMP_HEADER_SIZE + i * 4]).toBe(palette[i * 3 + 2]);
				expect(output[BMP_HEADER_SIZE + i * 4 + 2]).toBe(palette[i * 3]);
			}
			// The stream is zero, so the traced decode of the shared decoder applies.
			expect(output.subarray(BMP_DATA_OFFSET, BMP_DATA_OFFSET + 8)).toEqual(
				Buffer.from([0xec, 0xa8, 0xec, 0xb9, 0xec, 0xca, 0xec, 0xba]),
			);
		} finally {
			await archive.close();
		}
	});

	it("falls back to the built in palette when the flag is set", async () => {
		const stored = buildGra({ flags: 0x80 });
		expect(await tiareGraImageFormat.detect(sourceOf(stored), "CG01.GRA")).toBe(
			true,
		);
		const archive = await tiareGraImageFormat.open(
			sourceOf(stored),
			"CG01.GRA",
		);
		try {
			expect(archive.metadata).toMatchObject({ hasPalette: false });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// Two entries of the table: the first dim blue and the first bright one.
			expect(output.subarray(BMP_HEADER_SIZE + 4, BMP_HEADER_SIZE + 8)).toEqual(
				Buffer.from([0x77, 0x00, 0x00, 0x00]),
			);
			expect(
				output.subarray(BMP_HEADER_SIZE + 9 * 4, BMP_HEADER_SIZE + 9 * 4 + 4),
			).toEqual(Buffer.from([0xff, 0x00, 0x00, 0x00]));
		} finally {
			await archive.close();
		}
	});

	it("honours the skip field", async () => {
		// The dimensions, palette and stream all move past the skipped region.
		const stored = buildGra({ skip: 0x40 });
		expect(await tiareGraImageFormat.detect(sourceOf(stored), "CG01.GRA")).toBe(
			true,
		);
		const archive = await tiareGraImageFormat.open(
			sourceOf(stored),
			"CG01.GRA",
		);
		try {
			expect(archive.metadata).toMatchObject({ width: WIDTH, height: HEIGHT });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(BMP_DATA_OFFSET, BMP_DATA_OFFSET + 8)).toEqual(
				Buffer.from([0xec, 0xa8, 0xec, 0xb9, 0xec, 0xca, 0xec, 0xba]),
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file with no delimiter", async () => {
		const stored = buildGra({});
		stored[0] = 0x41;
		expect(await tiareGraImageFormat.detect(sourceOf(stored), "CG01.GRA")).toBe(
			false,
		);
	});

	it("declines a file whose depth marker is wrong", async () => {
		const stored = buildGra({ bppMarker: 8 });
		expect(await tiareGraImageFormat.detect(sourceOf(stored), "CG01.GRA")).toBe(
			false,
		);
	});

	it("declines a description that runs to the end of the window", async () => {
		const stored = buildGra({ terminator: false });
		expect(await tiareGraImageFormat.detect(sourceOf(stored), "CG01.GRA")).toBe(
			false,
		);
	});

	it("declines zero dimensions and short files", async () => {
		expect(
			await tiareGraImageFormat.detect(
				sourceOf(buildGra({ width: 0 })),
				"CG01.GRA",
			),
		).toBe(false);
		expect(
			await tiareGraImageFormat.detect(
				sourceOf(buildGra({ height: 0 })),
				"CG01.GRA",
			),
		).toBe(false);
		const short = buildGra({}).subarray(0, HEADER_SIZE - 1);
		expect(await tiareGraImageFormat.detect(sourceOf(short), "CG01.GRA")).toBe(
			false,
		);
	});
});
