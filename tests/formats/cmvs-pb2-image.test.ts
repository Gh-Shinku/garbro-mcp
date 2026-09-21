import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { cmvsPb2ImageFormat } from "../../packages/formats/src/cmvs/pb2-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEADER_SIZE = 0x20;
const TAIL_SIZE = 27;
/** A tail whose bytes are nothing like the fields, so a head that ignores it comes out wrong. */
const TAIL_XOR_KEYS = [24, 25];
/** The ways a picture of this engine may be packed. */
const TYPE_BLOCKS = 1;
const TYPE_BLOCK_MAP = 2;
const TYPE_JBP = 4;
const TYPE_CHANNELS = 6;

function tail(): Buffer {
	const out = Buffer.alloc(TAIL_SIZE, 0x00);
	for (let at = 0; at < TAIL_SIZE; at += 1) out[at] = (at * 7 + 3) & 0x7f;
	return out;
}

/** Keys the fields of a head with a tail, adding the tail's byte before exclusive-or'ing. */
function keyHead(plain: Buffer, tailBytes: Buffer): Buffer {
	const out = Buffer.from(plain);
	for (let at = 8; at < HEADER_SIZE; at += 1) {
		out[at] =
			(((plain[at] ?? 0) + (tailBytes[at - 8] ?? 0)) & 0xff) ^
			(tailBytes[TAIL_XOR_KEYS[at & 1] ?? 0] ?? 0);
	}
	return out;
}

/** A control stream whose every bit is clear, so every byte behind it stands as it is. */
function controls(count: number): Buffer {
	return Buffer.alloc(Math.ceil(count / 8), 0x00);
}

function plainHead(fields: {
	type: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	offset1: number;
	offset2: number;
}): Buffer {
	const out = Buffer.alloc(HEADER_SIZE, 0x00);
	out.write("PB2A", 0, "latin1");
	out.writeInt32LE(0, 4);
	out.writeInt32LE(1, 8);
	out.writeUInt16LE(fields.type, 0x10);
	out.writeUInt16LE(fields.width, 0x12);
	out.writeUInt16LE(fields.height, 0x14);
	out.writeUInt16LE(fields.bitsPerPixel, 0x16);
	out.writeInt32LE(fields.offset1, 0x18);
	out.writeInt32LE(fields.offset2, 0x1c);
	return out;
}

/** Wraps a head and its bytes in the head's own tail, which is what the reader keys the fields with. */
function fileWith(plain: Buffer, body: Buffer): Buffer {
	const tailBytes = tail();
	const headBytes = keyHead(plain, tailBytes);
	return Buffer.concat([headBytes, body, tailBytes]);
}

/** The first way: one packed run of blocks of eight by eight, placed channel by channel. */
function buildV1(): Buffer {
	const width = 10;
	const height = 2;
	const bits = 8;
	const offset1 = HEADER_SIZE;
	const offset2 = offset1 + bits;
	const blockData = Buffer.from(
		Array.from({ length: 3 * 20 }, (_, at) => at + 1),
	);
	return fileWith(
		plainHead({
			type: TYPE_BLOCKS,
			width,
			height,
			bitsPerPixel: 24,
			offset1,
			offset2,
		}),
		Buffer.concat([controls(blockData.length), blockData]),
	);
}

/** What the first way places, block by block: the blocks of one channel come before the next channel's. */
function expectV1(): Buffer {
	const width = 10;
	const height = 2;
	const pixelSize = 3;
	const stride = width * pixelSize;
	const out = Buffer.alloc(stride * height, 0x00);
	const blockData = Array.from({ length: 3 * 20 }, (_, at) => at + 1);
	let source = 0;
	for (let channel = 0; channel < pixelSize; channel += 1) {
		let row = channel;
		for (let blockY = 0; blockY < 1; blockY += 1) {
			for (const [blockX, blockWidth] of [
				[0, 8],
				[8, 2],
			] as const) {
				const at = row + blockX * pixelSize;
				for (let line = 0; line < height; line += 1) {
					for (let column = 0; column < blockWidth; column += 1) {
						out[at + line * stride + column * pixelSize] =
							blockData[source] ?? 0;
						source += 1;
					}
				}
			}
			row += 8 * pixelSize;
		}
	}
	return out;
}

/** The second way: every channel carries a block of flags and a block of bytes of its own. */
function buildV2(): Buffer {
	const width = 10;
	const height = 2;
	const channels = 3;
	// A record is twelve bytes of sizes, then a block of flags, a block of bytes and the packed plane.
	const recordSize = 15;
	const tableSize = channels * 4;
	const offset1 = HEADER_SIZE;
	const dataAt = offset1 + tableSize + channels * recordSize;
	// Both places name the tables themselves; the reader steps over them by four bytes a channel.
	const offset2 = dataAt;
	const table = Buffer.alloc(tableSize, 0x00);
	const dataTable = Buffer.alloc(tableSize, 0x00);
	const records = Buffer.alloc(channels * recordSize, 0x00);
	const data: Buffer[] = [];
	for (let channel = 0; channel < channels; channel += 1) {
		const from = channel * recordSize;
		table.writeInt32LE(recordSize, channel * 4);
		dataTable.writeInt32LE(4, channel * 4);
		records.writeInt32LE(1, from);
		records.writeInt32LE(1, from + 4);
		records.writeInt32LE(4, from + 8);
		// The first block is set, which fills it whole; the second is clear, which takes the plane's bytes.
		records[from + 12] = 0x80;
		records[from + 13] = 0x10 * (channel + 1) + channel;
		records[from + 14] = 0x00;
		data.push(
			Buffer.from([
				0x40 + channel * 0x10 + 1,
				0x40 + channel * 0x10 + 2,
				0x40 + channel * 0x10 + 3,
				0x40 + channel * 0x10 + 4,
			]),
		);
	}
	return fileWith(
		plainHead({
			type: TYPE_BLOCK_MAP,
			width,
			height,
			bitsPerPixel: 24,
			offset1,
			offset2,
		}),
		Buffer.concat([table, records, dataTable, ...data]),
	);
}

function expectV2(): Buffer {
	const width = 10;
	const height = 2;
	const pixelSize = 3;
	const stride = width * pixelSize;
	const out = Buffer.alloc(stride * height, 0x00);
	for (let channel = 0; channel < pixelSize; channel += 1) {
		const fill = 0x10 * (channel + 1) + channel;
		const plane = [1, 2, 3, 4].map((step) => 0x40 + channel * 0x10 + step);
		for (let x = 0; x < 8; x += 1) {
			for (let y = 0; y < height; y += 1) {
				out[y * stride + x * pixelSize + channel] = fill;
			}
		}
		out[0 * stride + 8 * pixelSize + channel] = plane[0] ?? 0;
		out[0 * stride + 9 * pixelSize + channel] = plane[1] ?? 0;
		out[1 * stride + 8 * pixelSize + channel] = plane[2] ?? 0;
		out[1 * stride + 9 * pixelSize + channel] = plane[3] ?? 0;
	}
	return out;
}

/** The last way: four channels of their own, folded back one into the next. */
function buildV6(): Buffer {
	const width = 2;
	const height = 2;
	const size = width * height;
	const channels = [
		[0x01, 0x02, 0x03, 0x04],
		[0x10, 0x20, 0x30, 0x40],
		[0x0f, 0x1f, 0x2f, 0x3f],
		[0xff, 0x80, 0x00, 0x7f],
	];
	const tableAt = 0x30;
	const planesAt = tableAt + 0x20;
	const offset1 = tableAt;
	const offset2 = planesAt;
	const table = Buffer.alloc(0x20, 0x00);
	// The reader takes its table from the first nothing behind the head, so nothing may stand before it.
	const filler = Buffer.alloc(tableAt - HEADER_SIZE, 0x01);
	// The four streams the walk reads its control bits from stand first, then the bytes they stand for.
	const planes: Buffer[] = [
		controls(size),
		controls(size),
		controls(size),
		controls(size),
	];
	for (let channel = 0; channel < 4; channel += 1) {
		table.writeInt32LE(channel, channel * 8);
		table.writeInt32LE(4 + channel * 4, channel * 8 + 4);
		planes.push(Buffer.from(channels[channel] ?? []));
	}
	return fileWith(
		plainHead({
			type: TYPE_CHANNELS,
			width,
			height,
			bitsPerPixel: 32,
			offset1,
			offset2,
		}),
		Buffer.concat([filler, table, ...planes]),
	);
}

function expectV6(): Buffer {
	const channels = [
		[0x01, 0x02, 0x03, 0x04],
		[0x10, 0x20, 0x30, 0x40],
		[0x0f, 0x1f, 0x2f, 0x3f],
		[0xff, 0x80, 0x00, 0x7f],
	];
	const out: number[] = [];
	for (let at = 0; at < 4; at += 1) {
		const fourth = channels[3]?.[at] ?? 0;
		const red = ((channels[2]?.[at] ?? 0) ^ fourth) & 0xff;
		const green = ((channels[1]?.[at] ?? 0) ^ red) & 0xff;
		const blue = ((channels[0]?.[at] ?? 0) ^ green) & 0xff;
		out.push(blue, green, red, fourth);
	}
	return Buffer.from(out);
}

/** A picture of the JBP way whose every place stands as the place of the picture itself, which stands as the
 * place of the colours of the picture - the same degenerate fixture the ported PB3 pictures are pinned with. */
function buildJbp(): Buffer {
	const dataPos = 0x30;
	const walkPlaces = 0x10;
	const frequencySize = 0x40;
	const out = Buffer.alloc(dataPos, 0x00);
	out.write("JBP1", 0, "latin1");
	out.writeInt32LE(dataPos, 4);
	out.writeUInt16LE(16, 0x10);
	out.writeUInt16LE(16, 0x12);
	out.writeInt32LE(3, 0x1c);
	out.writeInt32LE(3, 0x20);
	const frequencies = Buffer.alloc(frequencySize * 2, 0x00);
	for (let at = 0; at < walkPlaces; at += 1) {
		frequencies.writeUInt32LE(1, at * 4);
		frequencies.writeUInt32LE(1, frequencySize + at * 4);
	}
	return Buffer.concat([
		out,
		frequencies,
		Buffer.alloc(walkPlaces, 0x00),
		Buffer.alloc(0x80, 0x00),
		Buffer.alloc(3, 0x00),
		Buffer.alloc(3, 0xff),
	]);
}

/** The fourth way hands the picture to the walk of the JBP way, which stands behind the head. */
function buildV4(): Buffer {
	return fileWith(
		plainHead({
			type: TYPE_JBP,
			width: 16,
			height: 16,
			bitsPerPixel: 32,
			offset1: 0,
			offset2: 0,
		}),
		buildJbp(),
	);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await cmvsPb2ImageFormat.open(
		new BufferByteSource(data),
		"picture.pb2",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

function pixels(out: Buffer): Buffer {
	const image = readBmpImage(out);
	if (!image) throw new Error("the picture is not a bitmap");
	return image.pixels;
}

describe("CVNS engine image format", () => {
	it("reads a head keyed with the tail of the picture", async () => {
		const data = buildV1();
		const handle = await cmvsPb2ImageFormat.open(
			new BufferByteSource(data),
			"picture.pb2",
		);
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 10,
			height: 2,
			bitsPerPixel: 24,
		});
	});

	it("places the blocks of the first way channel by channel", async () => {
		const out = await extract(buildV1());
		expect(pixels(out)).toEqual(expectV1());
	});

	it("fills a whole block of the second way and takes the next from its plane", async () => {
		const out = await extract(buildV2());
		expect(pixels(out)).toEqual(expectV2());
	});

	it("folds the four channels of the last way back one into the next", async () => {
		const out = await extract(buildV6());
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(pixels(out)).toEqual(expectV6());
	});

	it("hands a picture of the fourth way to the walk of the JBP pictures", async () => {
		const out = await extract(buildV4());
		expect(out.readUInt32LE(0x12)).toBe(16);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// The picture's own bytes come from the JBP walk rather than from this format, so only that the walk
		// was reached, at the head's own places and with a picture of the head's own size, is pinned here.
		expect(pixels(out).length).toBe(16 * 16 * 4);
	});

	it("turns away a way of packing the reference does not read either", async () => {
		for (const type of [3, 5, 7, 9]) {
			const data = Buffer.from(buildV1());
			data.writeUInt16LE(type, 0x10);
			await expect(extract(data)).rejects.toThrow(GarbroError);
		}
	});

	it("is told by the word of the picture, and needs a whole head", async () => {
		expect(cmvsPb2ImageFormat.descriptor.id).toBe("cmvs-pb2-image");
		const good = buildV1();
		expect(
			await cmvsPb2ImageFormat.detect(
				new BufferByteSource(good),
				"picture.pb2",
			),
		).toBe(true);
		const other = Buffer.from(good);
		other.write("XXXX", 0, "latin1");
		expect(
			await cmvsPb2ImageFormat.detect(
				new BufferByteSource(other),
				"picture.pb2",
			),
		).toBe(false);
		expect(
			await cmvsPb2ImageFormat.detect(
				new BufferByteSource(good.subarray(0, 0x10)),
				"picture.pb2",
			),
		).toBe(false);
	});
});
