import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { discoveryPr1ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 12;
const BMP_HEADER_SIZE = 54;
const BMP_PALETTE_BYTES = 16 * 4;
const BMP_PIXELS_OFFSET = BMP_HEADER_SIZE + BMP_PALETTE_BYTES;

interface PrOptions {
	/** The picture, in pixels; the header stores the eighths of it. */
	width?: number;
	height?: number;
	flags?: number;
	offsetX?: number;
	offsetY?: number;
	/** The colour map of sixteen colours, three bytes each in the order green, red, blue. */
	palette?: number[];
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

/** One group of the plain kind: four plane bytes, which is eight pixels of the picture. */
function literals(groups: number[][]): Buffer {
	return Buffer.concat([
		Buffer.from([groups.length - 1]),
		Buffer.from(groups.flat()),
	]);
}

function buildPrFile(options: PrOptions = {}): Buffer {
	const width = options.width ?? 8;
	const height = options.height ?? 1;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header[0] = options.flags ?? 1;
	header[1] = 0xff;
	header.writeUInt16LE(options.offsetX ?? 0, 2);
	header.writeUInt16LE(options.offsetY ?? 0, 4);
	header.writeUInt16LE(width >> 3, 8);
	header.writeUInt16LE(height, 10);
	const palette = Buffer.from(options.palette ?? greyPalette());
	const stream = options.stream ?? literals([[0xaa, 0xcc, 0xf0, 0xff]]);
	return Buffer.concat([header, palette, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.pr1"): Promise<Buffer> {
	const archive = await discoveryPr1ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Discovery PR1 image", () => {
	it("finds its pictures by their extension", async () => {
		expect(discoveryPr1ImageFormat.detection?.signatures).toEqual([]);
		expect(
			await discoveryPr1ImageFormat.detect(sourceOf(buildPrFile()), "CG01.pr1"),
		).toBe(true);
		expect(
			await discoveryPr1ImageFormat.detect(sourceOf(buildPrFile()), "CG01.PR1"),
		).toBe(true);
		// The animation resource of the same engine is read with the same header.
		expect(
			await discoveryPr1ImageFormat.detect(sourceOf(buildPrFile()), "anim.AN1"),
		).toBe(true);
		expect(
			await discoveryPr1ImageFormat.detect(sourceOf(buildPrFile()), "CG01.bmp"),
		).toBe(false);
		expect(
			await discoveryPr1ImageFormat.detect(sourceOf(Buffer.alloc(6)), "a.pr1"),
		).toBe(false);
		// The reference checks no measurement at all, so a picture of no pixels is still found and only fails
		// when the framework refuses to build it.
		expect(
			await discoveryPr1ImageFormat.detect(
				sourceOf(buildPrFile({ width: 0, height: 0, stream: Buffer.alloc(0) })),
				"a.pr1",
			),
		).toBe(true);
	});

	it("weaves four one bit pictures into a picture of sixteen colours", async () => {
		const file = buildPrFile({ offsetX: 3, offsetY: 7 });
		const archive = await discoveryPr1ImageFormat.open(
			sourceOf(file),
			"CG01.pr1",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 8,
				height: 1,
				bitsPerPixel: 4,
				colors: 16,
				offsetX: 3,
				offsetY: 7,
				flags: 1,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "discovery-rle",
				width: 8,
				height: 1,
				bitsPerPixel: 4,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(4);
		expect(bmp.readInt32LE(22)).toBe(-1);
		// The highest bit of every plane is the first pixel of the group, and the first plane is its lowest bit.
		expect(bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + 4)).toEqual(
			Buffer.from([0xfe, 0xdc, 0xba, 0x98]),
		);
		// The colour map is stored green, red, blue and scaled by seventeen.
		expect(bmp.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 8)).toEqual(
			Buffer.from([0x11, 0x11, 0x11, 0x00, 0x22, 0x22, 0x22, 0x00]),
		);
	});

	it("walks the picture down its columns when the flag says so", async () => {
		// Two columns of two rows: two groups of eight pixels, four groups over the picture.
		const groups = [
			[0x80, 0x00, 0x00, 0x00],
			[0x01, 0x00, 0x00, 0x00],
			[0x00, 0x80, 0x00, 0x00],
			[0x00, 0x01, 0x00, 0x00],
		];
		const bmp = await extract(
			buildPrFile({ width: 16, height: 2, flags: 0, stream: literals(groups) }),
		);
		// The walk goes down a column, so the third group is written where the second row of the flattening
		// would have been: the picture reads its groups in the order first, third, second, fourth.
		expect(bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + 16)).toEqual(
			Buffer.from([
				0x10, 0x00, 0x00, 0x00, 0x20, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
				0x00, 0x00, 0x00, 0x02,
			]),
		);
	});

	it("repeats what it has just put in a window", async () => {
		// One group read as it stands and kept in the window of the second kind, then two more taken from it.
		const stream = Buffer.concat([
			Buffer.from([0x40]),
			Buffer.from([0xaa, 0xcc, 0xf0, 0xff]),
			Buffer.from([0x61, 0x00]),
		]);
		const bmp = await extract(buildPrFile({ width: 8, height: 3, stream }));
		const pixels = bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + 12);
		expect(pixels.subarray(0, 4)).toEqual(
			Buffer.from([0xfe, 0xdc, 0xba, 0x98]),
		);
		expect(pixels.subarray(4, 8)).toEqual(
			Buffer.from([0xfe, 0xdc, 0xba, 0x98]),
		);
		expect(pixels.subarray(8, 12)).toEqual(
			Buffer.from([0xfe, 0xdc, 0xba, 0x98]),
		);
	});

	it("moves a window on by the whole group its opcode names", async () => {
		// Two opcodes of the third kind that write one group each where their kind holds two, and then a copy
		// of the second slot of that window: the reference left the first opcode a slot between them.
		const stream = Buffer.concat([
			Buffer.from([0x80]),
			Buffer.from([0x01, 0x00, 0x00, 0x00]),
			Buffer.from([0x80]),
			Buffer.from([0x02, 0x00, 0x00, 0x00]),
			Buffer.from([0xa0, 0x02]),
		]);
		const bmp = await extract(buildPrFile({ width: 8, height: 3, stream }));
		// The second group sets the second lowest bit of its first plane, which is the sixth pixel.
		expect(bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + 12)).toEqual(
			Buffer.from([
				0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x10, 0x00, 0x00, 0x00, 0x10,
			]),
		);
	});

	it("takes a group back out of a window by its offset", async () => {
		// A group kept in the first window, then two copied out of it by their offset.
		const stream = Buffer.concat([
			Buffer.from([0x00]),
			Buffer.from([0xaa, 0xcc, 0xf0, 0xff]),
			Buffer.from([0x21, 0x00, 0x00]),
		]);
		const bmp = await extract(buildPrFile({ width: 8, height: 3, stream }));
		const pixels = bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + 12);
		expect(pixels.subarray(0, 4)).toEqual(
			Buffer.from([0xfe, 0xdc, 0xba, 0x98]),
		);
		expect(pixels.subarray(4, 12)).toEqual(
			Buffer.from([0xfe, 0xdc, 0xba, 0x98, 0xfe, 0xdc, 0xba, 0x98]),
		);
	});

	it("keeps the picture whole when the stream ends between opcodes", async () => {
		// A control byte whose group is not there: the reference raises its end of stream failure.
		const file = buildPrFile({ stream: Buffer.from([0x00, 0xaa]) });
		const archive = await discoveryPr1ImageFormat.open(
			sourceOf(file),
			"CG01.pr1",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Unexpected end of Discovery image",
			});
		} finally {
			await archive.close();
		}
	});

	it("stops when a run reaches past the plane", async () => {
		// Two groups where the picture holds one.
		const stream = literals([
			[0xaa, 0xcc, 0xf0, 0xff],
			[0x00, 0x00, 0x00, 0x00],
		]);
		const file = buildPrFile({ width: 8, height: 1, stream });
		const archive = await discoveryPr1ImageFormat.open(
			sourceOf(file),
			"CG01.pr1",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Discovery image run reaches past a plane",
			});
		} finally {
			await archive.close();
		}
	});

	it("refuses a picture of no pixels", async () => {
		const file = buildPrFile({ width: 0, height: 0, stream: Buffer.alloc(0) });
		const archive = await discoveryPr1ImageFormat.open(sourceOf(file), "a.pr1");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "UNSUPPORTED_FEATURE",
			});
		} finally {
			await archive.close();
		}
	});
});
