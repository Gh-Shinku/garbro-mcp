import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { discoveryAn1ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 12;
const BMP_HEADER_SIZE = 54;
const BMP_PALETTE_BYTES = 16 * 4;
const BMP_PIXELS_OFFSET = BMP_HEADER_SIZE + BMP_PALETTE_BYTES;
/** One frame is thirty two pixels wide and thirty two of them tall, and sixteen bytes to a row. */
const FRAME_ROW_BYTES = 16;
const FRAME_BYTES = FRAME_ROW_BYTES * 32;

interface An1Options {
	/** The groups the planes hold, which is one plane byte of every plane each. */
	groups?: number;
	frameCount?: number;
	/** The colour map of sixteen colours, three bytes each in the order green, red, blue. */
	palette?: number[];
	/** Plane bytes to put somewhere other than the frame table, by the group they belong to. */
	patches?: Record<number, number[]>;
	stream?: Buffer;
}

/** One colour map of sixteen colours, each of them a different grey so a test can tell them apart. */
function greyPalette(): number[] {
	const values: number[] = [];
	for (let i = 0; i < 16; i += 1) {
		values.push(i + 1, i + 1, i + 1);
	}
	return values;
}

/**
 * The planes as one run of the plain kind of opcode after another, thirty two groups at a time. The second
 * and the third plane byte of the first group are the frame count, and the caller can put anything anywhere
 * else.
 */
function planStream(options: An1Options = {}): Buffer {
	const groups = options.groups ?? 128;
	const frameCount = options.frameCount ?? 1;
	const parts: Buffer[] = [];
	let index = 0;
	while (index < groups) {
		const count = Math.min(32, groups - index);
		parts.push(Buffer.from([count - 1]));
		for (let i = 0; i < count; i += 1) {
			const group = index + i;
			let bytes = [0x00, 0x00, 0x00, 0x00];
			if (2 === group) bytes = [frameCount & 0xff, 0x00, 0x00, 0x00];
			if (3 === group) bytes = [(frameCount >> 8) & 0xff, 0x00, 0x00, 0x00];
			parts.push(Buffer.from(options.patches?.[group] ?? bytes));
		}
		index += count;
	}
	return Buffer.concat(parts);
}

function buildAn1File(options: An1Options = {}): Buffer {
	const groups = options.groups ?? 128;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header[0] = 1;
	header[1] = 0xff;
	// The picture is a row of eighths of it wide and one group to a row tall, so the planes hold as many
	// groups as the caller asked for.
	header.writeUInt16LE(1, 8);
	header.writeUInt16LE(groups, 10);
	const palette = Buffer.from(options.palette ?? greyPalette());
	return Buffer.concat([
		header,
		palette,
		options.stream ?? planStream(options),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "anim.an1"): Promise<Buffer> {
	const archive = await discoveryAn1ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Discovery AN1 animation", () => {
	it("answers only to the extension of the animation resource", async () => {
		const file = buildAn1File();
		expect(
			await discoveryAn1ImageFormat.detect(sourceOf(file), "anim.an1"),
		).toBe(true);
		expect(
			await discoveryAn1ImageFormat.detect(sourceOf(file), "ANIM.AN1"),
		).toBe(true);
		// The still picture of the same engine shares the header, but its reader wants another extension.
		expect(
			await discoveryAn1ImageFormat.detect(sourceOf(file), "anim.pr1"),
		).toBe(false);
		expect(
			await discoveryAn1ImageFormat.detect(sourceOf(file), "anim.bmp"),
		).toBe(false);
		expect(
			await discoveryAn1ImageFormat.detect(sourceOf(Buffer.alloc(6)), "a.an1"),
		).toBe(false);
	});

	it("stacks the frames of the picture one after another", async () => {
		const file = buildAn1File({
			patches: {
				// A frame of the widest kind just before the frame table, which is not part of the picture.
				27: [0xff, 0xff, 0xff, 0xff],
				28: [0x80, 0x00, 0x00, 0x00],
			},
		});
		const archive = await discoveryAn1ImageFormat.open(
			sourceOf(file),
			"anim.an1",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["anim.bmp"]);
			// The listed measurements are the ones the stored header holds; the picture itself is a strip of
			// thirty two pixel frames.
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 8,
				height: 128,
				bitsPerPixel: 4,
				colors: 16,
				flags: 1,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "discovery-rle",
				width: 8,
				height: 128,
				bitsPerPixel: 4,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(4);
		expect(bmp.readUInt32LE(18)).toBe(32);
		expect(bmp.readInt32LE(22)).toBe(-32);
		// The frames start at the sixth byte behind their table, so the group written just before it is left out
		// and the one that follows it is the first eight pixels of the picture.
		expect(
			bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + FRAME_ROW_BYTES),
		).toEqual(
			Buffer.from([
				0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
				0x00, 0x00, 0x00, 0x00,
			]),
		);
		expect(
			bmp.subarray(
				BMP_PIXELS_OFFSET + FRAME_ROW_BYTES,
				BMP_PIXELS_OFFSET + 2 * FRAME_ROW_BYTES,
			),
		).toEqual(Buffer.alloc(FRAME_ROW_BYTES, 0x00));
		// The colour map is stored green, red, blue and scaled by seventeen.
		expect(bmp.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 8)).toEqual(
			Buffer.from([0x11, 0x11, 0x11, 0x00, 0x22, 0x22, 0x22, 0x00]),
		);
	});

	it("puts as many frames in the strip as the table holds", async () => {
		const bmp = await extract(
			buildAn1File({
				groups: 256,
				frameCount: 2,
				patches: {
					// The table of two frames is forty four bytes long, so the frames begin at the fiftieth byte
					// and the group before them tells a wrong start apart.
					28: [0xff, 0xff, 0xff, 0xff],
					50: [0x80, 0x00, 0x00, 0x00],
					178: [0x40, 0x00, 0x00, 0x00],
				},
			}),
		);
		expect(bmp.readInt32LE(22)).toBe(-64);
		expect(bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + 1)).toEqual(
			Buffer.from([0x10]),
		);
		expect(
			bmp.subarray(
				BMP_PIXELS_OFFSET + FRAME_BYTES,
				BMP_PIXELS_OFFSET + FRAME_BYTES + 1,
			),
		).toEqual(Buffer.from([0x01]));
	});

	it("refuses a picture whose frames outrun its planes", async () => {
		const file = buildAn1File({ groups: 128, frameCount: 3 });
		await expect(extract(file)).rejects.toThrow(GarbroError);
		await expect(extract(file)).rejects.toThrow(
			"Discovery image flattening reaches past a plane",
		);
	});

	it("refuses an animation of no frames", async () => {
		const file = buildAn1File({ frameCount: 0 });
		await expect(extract(file)).rejects.toThrow(
			"Unsupported Discovery animation of 0 frames",
		);
	});

	it("stops at the end of a stream that ends between its groups", async () => {
		// One group is there and the control byte before it asked for two.
		const file = buildAn1File({
			patches: { 2: [0x01, 0x00, 0x00, 0x00] },
			stream: Buffer.concat([Buffer.from([0x01]), Buffer.alloc(4, 0x00)]),
		});
		await expect(extract(file)).rejects.toThrow(GarbroError);
		await expect(extract(file)).rejects.toThrow(
			"Unexpected end of Discovery image",
		);
	});

	it("stops at the end of a stream that ends between its opcodes", async () => {
		// The planes are only written as far as the stream goes, and the frames they then hold are read out of
		// what was written.
		const file = buildAn1File({ stream: Buffer.alloc(40, 0x00) });
		await expect(extract(file)).rejects.toThrow(GarbroError);
		await expect(extract(file)).rejects.toThrow(
			"Unsupported Discovery animation of 0 frames",
		);
	});
});
