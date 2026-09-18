import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	applyHgDelta,
	type HgGeometry,
	HgBitReader,
	readHgBitCount,
} from "../../packages/formats/src/cat-system/hg-core.js";
import {
	catSystemHg2ImageFormat,
	readHg2Layout,
} from "../../packages/formats/src/cat-system/hg2-image.js";

const HEADER_SIZES: Record<number, number> = {
	0x10: 0x30,
	0x20: 0x50,
	0x25: 0x58,
};

/** `GetBitCount` written the other way round: the zeros that lead and then the value's own bits. */
function bitCountCode(value: number): number[] {
	let zeros = 0;
	while (1 << (zeros + 1) <= value) zeros += 1;
	const bits: number[] = [];
	for (let index = 0; index < zeros; index += 1) bits.push(0);
	bits.push(1);
	for (let index = zeros - 1; index >= 0; index -= 1) {
		bits.push((value >> index) & 1);
	}
	return bits;
}

/** The bits packed least significant first, which is how the reference's own reader takes them. */
function packLsb(bits: number[]): Buffer {
	const packed = Buffer.alloc(Math.ceil(bits.length / 8), 0x00);
	bits.forEach((bit, index) => {
		if (bit !== 0)
			packed[index >> 3] = (packed[index >> 3] ?? 0) | (1 << (index & 7));
	});
	return packed;
}

interface HgRun {
	copy: boolean;
	data: Buffer;
}

/** A walk of runs: the first flag stands at the front, then the length of the picture and of every run. */
function encodeRuns(outputSize: number, runs: HgRun[]): Buffer {
	const bits: number[] = [];
	bits.push(runs[0]?.copy ? 1 : 0);
	bits.push(...bitCountCode(outputSize));
	for (const run of runs) {
		bits.push(...bitCountCode(run.data.length));
	}
	return packLsb(bits);
}

function hg2File(input: {
	version: number;
	width: number;
	height: number;
	bpp: number;
	depth: number;
	runs: HgRun[];
}): Buffer {
	const headerSize = HEADER_SIZES[input.version];
	if (headerSize === undefined) throw new Error("unknown version");
	const pixelSize = input.bpp >> 3;
	const stride = input.width * pixelSize;
	const outputSize = stride * input.height;
	// The data stream holds the whole picture: only the runs that copy take from it, and the rest of it
	// stands as padding, which is what the reference's own length check asks for.
	const data = Buffer.alloc(outputSize, 0x00);
	let copied = 0;
	for (const run of input.runs) {
		if (!run.copy) continue;
		run.data.copy(data, copied);
		copied += run.data.length;
	}
	const control = encodeRuns(outputSize, input.runs);
	const head = Buffer.alloc(headerSize, 0x00);
	Buffer.from("HG-2", "latin1").copy(head, 0);
	head.writeInt32LE(input.version, 0x08);
	head.writeUInt32LE(input.width, 0x0c);
	head.writeUInt32LE(input.height, 0x10);
	head.writeInt16LE(input.bpp, 0x14);
	head.writeInt16LE(input.depth, 0x16);
	const packed = deflateSync(data);
	const packedControl = deflateSync(control);
	head.writeInt32LE(packed.length, 0x20);
	head.writeInt32LE(outputSize, 0x24);
	head.writeInt32LE(packedControl.length, 0x28);
	head.writeInt32LE(control.length, 0x2c);
	return Buffer.concat([head, packed, packedControl]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await catSystemHg2ImageFormat.open(
		new BufferByteSource(data),
		"pic.hg2",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("CatSystem HG-2 image", () => {
	it("reads the head of each version as the reference does", () => {
		const data = hg2File({
			version: 0x10,
			width: 4,
			height: 1,
			bpp: 24,
			depth: 8,
			runs: [{ copy: true, data: Buffer.alloc(12) }],
		});
		expect(readHg2Layout(data)).toMatchObject({
			version: 0x10,
			headerSize: 0x30,
			width: 4,
			height: 1,
			bitsPerPixel: 24,
			dataUnpacked: 12,
			flipped: false,
			scaled: false,
			invertedAlpha: false,
		});
		const newer = hg2File({
			version: 0x25,
			width: 4,
			height: 2,
			bpp: 32,
			depth: 8,
			runs: [{ copy: true, data: Buffer.alloc(32) }],
		});
		expect(readHg2Layout(newer)).toMatchObject({
			version: 0x25,
			headerSize: 0x58,
			flipped: true,
			scaled: false,
			invertedAlpha: false,
		});
	});

	it("gates on the mark, the version and the streams", () => {
		const good = hg2File({
			version: 0x10,
			width: 4,
			height: 1,
			bpp: 24,
			depth: 8,
			runs: [{ copy: true, data: Buffer.alloc(12) }],
		});
		expect(readHg2Layout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("HG-3", 0, "latin1");
		expect(readHg2Layout(mark)).toBeUndefined();
		// Only the three versions the reference knows are read.
		const version = Buffer.from(good);
		version.writeInt32LE(0x11, 0x08);
		expect(readHg2Layout(version)).toBeUndefined();
		// The depth has to be one the reader has a layout for.
		const depth = Buffer.from(good);
		depth.writeInt16LE(8, 0x14);
		expect(readHg2Layout(depth)).toBeUndefined();
		// And the streams have to stand inside the file.
		const short = Buffer.from(good);
		short.writeInt32LE(0x1000, 0x20);
		expect(readHg2Layout(short)).toBeUndefined();
	});

	it("reads a run of lengths as the reference does", () => {
		expect(
			readHgBitCount(new HgBitReader(packLsb([0, 0, 0, 1, 1, 0, 0]))),
		).toBe(12);
		// A run of nothing but a one is a length of one, and a run that nests too deep is refused.
		expect(readHgBitCount(new HgBitReader(packLsb([1])))).toBe(1);
		expect(() =>
			readHgBitCount(new HgBitReader(packLsb(Array(0x21).fill(0)))),
		).toThrow("nests its runs too deep");
		// So is a stream that ends inside a run.
		expect(() =>
			readHgBitCount(new HgBitReader(packLsb(Array(8).fill(0)))),
		).toThrow("cut short");
	});

	it("unfolds the four planes and steps every byte of them", () => {
		// Only the first byte of the first plane stands, and a picture of one row has no step below it.
		const geometry: HgGeometry = {
			width: 4,
			height: 1,
			bitsPerPixel: 24,
			pixelSize: 3,
			stride: 12,
		};
		const intermediate = Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
		expect(applyHgDelta(intermediate, geometry).toString("hex")).toBe(
			"200000200000200000200000",
		);
	});

	it("steps every byte of a picture from the row above as well", async () => {
		const data = hg2File({
			version: 0x10,
			width: 4,
			height: 2,
			bpp: 24,
			depth: 8,
			runs: [
				{
					copy: true,
					data: Buffer.from([
						1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
						0,
					]),
				},
			],
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// The older head stores its rows top down, which a bitmap records with a negative height.
		expect(out.readInt32LE(0x16)).toBe(-2);
		// The second row's own differences are nothing, so it is the first row added to it again.
		expect(out.subarray(0x36).toString("hex")).toBe(
			"200000200000200000200000200000200000200000200000",
		);
	});

	it("walks runs of the data and runs left as they stand in turn", async () => {
		const data = hg2File({
			version: 0x10,
			width: 4,
			height: 1,
			bpp: 24,
			depth: 8,
			runs: [
				{ copy: true, data: Buffer.from([1, 0, 0, 0]) },
				{ copy: false, data: Buffer.alloc(4) },
				{ copy: true, data: Buffer.from([2, 0, 0, 0]) },
			],
		});
		const out = await extract(data);
		// The bytes the third run copies land in the second plane, at the place the walk left off.
		expect(out.subarray(0x36).toString("hex")).toBe("200000200000200004200004");
	});

	it("stretches the channels of a picture of few bits and inverts its fourth byte", async () => {
		const data = hg2File({
			version: 0x10,
			width: 4,
			height: 1,
			bpp: 32,
			depth: 5,
			runs: [
				{
					copy: true,
					data: Buffer.from([1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]),
				},
			],
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// The first channel of every pixel is 0x20, stretched over the whole byte and the fourth inverted.
		const stretched = Math.trunc((0x20 * 0xff) / 31) & 0xff;
		const pixel = [stretched, 0, 0, 0xff]
			.map((value) => value.toString(16).padStart(2, "0"))
			.join("");
		expect(out.subarray(0x36).toString("hex")).toBe(pixel.repeat(4));
	});

	it("keeps the rows of a picture of the newer head bottom up", async () => {
		const data = hg2File({
			version: 0x25,
			width: 4,
			height: 1,
			bpp: 24,
			depth: 8,
			runs: [{ copy: true, data: Buffer.alloc(12) }],
		});
		const out = await extract(data);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(1);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = hg2File({
			version: 0x10,
			width: 4,
			height: 1,
			bpp: 24,
			depth: 8,
			runs: [{ copy: true, data: Buffer.alloc(12) }],
		});
		data.write("HG-3", 0, "latin1");
		await expect(
			catSystemHg2ImageFormat.open(new BufferByteSource(data), "pic.hg2"),
		).rejects.toThrow(GarbroError);
		await expect(
			catSystemHg2ImageFormat.open(new BufferByteSource(data), "pic.hg2"),
		).rejects.toThrow("Not a CatSystem picture");
	});
});
