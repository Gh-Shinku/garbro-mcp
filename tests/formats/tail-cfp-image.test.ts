import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readCfp2Layout,
	readCfpLayout,
	tailCfp2ImageFormat,
	tailCfpImageFormat,
} from "../../packages/formats/src/tail/cfp-image.js";

/** A Tail picture: the head and the planes. */
function cfpFile(width: number, height: number, planes: Buffer): Buffer {
	const head = Buffer.alloc(0x1c);
	Buffer.from("REB ", "latin1").copy(head, 0);
	head.writeUInt32LE(width, 0x14);
	head.writeUInt32LE(height, 0x18);
	return Buffer.concat([head, planes]);
}

/** A Tail transparent bitmap: the head, the planes and the word at `0x1C`. */
function cfp2File(
	width: number,
	height: number,
	planes: Buffer,
	options: { offset?: number; start?: number; tight?: boolean } = {},
): Buffer {
	const head = Buffer.alloc(0x20);
	Buffer.from("REB2", "latin1").copy(head, 0);
	head.writeInt32LE(options.start ?? 0x36, 0x10);
	head.writeInt32LE(width, 0x14);
	head.writeInt32LE(height, 0x18);
	head.writeInt32LE(options.offset ?? 0, 0x1c);
	if (options.tight) {
		// The planes stand right behind the start, over the word at `0x1C`, and the file ends with them.
		const file = Buffer.alloc(0x1c + planes.length);
		head.copy(file, 0, 0, 0x1c);
		planes.copy(file, 0x1c);
		return file;
	}
	return Buffer.concat([head, planes]);
}

async function extract(
	format: typeof tailCfpImageFormat,
	data: Buffer,
): Promise<Buffer> {
	const handle = await format.open(new BufferByteSource(data), "pic.cfp");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Tail image", () => {
	it("reads the head as the reference does", () => {
		const data = cfpFile(2, 1, Buffer.alloc(6));
		expect(readCfpLayout(data)).toEqual({
			width: 2,
			height: 1,
			paddedWidth: 2,
			stride: 8,
			pitch: 8,
			dataOffset: 0x1c,
			dataLength: 6,
		});
	});

	it("gates on the mark and the planes standing at the end of the file", () => {
		const good = cfpFile(2, 1, Buffer.alloc(6));
		expect(readCfpLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("REB!", 0, "latin1");
		expect(readCfpLayout(mark)).toBeUndefined();
		// A file that does not even hold the head is turned away.
		expect(readCfpLayout(good.subarray(0, 0x10))).toBeUndefined();
		// The older mark stands in the low half of the word, so the two bytes behind it have to be nothing.
		const short = Buffer.from(good);
		short.writeUInt32LE(0x00005242, 0);
		expect(readCfpLayout(short)).toBeDefined();
		const trailing = Buffer.from(good);
		trailing.writeUInt32LE(0x00015242, 0);
		expect(readCfpLayout(trailing)).toBeUndefined();
	});

	it("unfolds the six planes of nibbles into two pixels at a time", async () => {
		const data = cfpFile(
			2,
			1,
			Buffer.from([0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc]),
		);
		const out = await extract(tailCfpImageFormat, data);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `ImageData.Create` keeps the stored order top down.
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("2468ac13579b0000");
	});

	it("walks the planes from the bottom row up", async () => {
		const data = cfpFile(
			2,
			2,
			Buffer.from([
				0x12, 0x00, 0x34, 0x0f, 0x56, 0x00, 0x78, 0xf0, 0x9a, 0x00, 0xbc, 0x0f,
			]),
		);
		const out = await extract(tailCfpImageFormat, data);
		// The first row of a plane is the lowest row, so it stands **last** in the bitmap.
		expect(out.subarray(0x36, 0x46).toString("hex")).toBe(
			"0f000f000f0000002468ac13579b0000",
		);
	});

	it("rounds an odd width up to two pixels and takes the padding out", async () => {
		const planes = Buffer.from(Array.from({ length: 12 }, (_, i) => i));
		const data = cfpFile(3, 1, planes);
		const layout = readCfpLayout(data);
		if (!layout) throw new Error("no layout");
		expect(layout.paddedWidth).toBe(4);
		expect(layout.stride).toBe(12);
		const out = await extract(tailCfpImageFormat, data);
		// Every byte holds the nibbles of two pixels, and the padding of the rounded row is written too.
		expect(out.subarray(0x36).toString("hex")).toBe("02468a00000013579b000000");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = cfpFile(2, 1, Buffer.alloc(6));
		data.write("REB!", 0, "latin1");
		await expect(
			tailCfpImageFormat.open(new BufferByteSource(data), "pic.cfp"),
		).rejects.toThrow(GarbroError);
		await expect(
			tailCfpImageFormat.open(new BufferByteSource(data), "pic.cfp"),
		).rejects.toThrow("Not a Tail picture");
	});
});

describe("Tail transparent bitmap", () => {
	it("reads the head as the reference does", () => {
		const data = cfp2File(2, 1, Buffer.alloc(8));
		expect(readCfp2Layout(data)).toEqual({
			width: 2,
			height: 1,
			paddedWidth: 2,
			stride: 8,
			pitch: 8,
			dataOffset: 0x20,
			dataLength: 8,
		});
	});

	it("gates on the mark and the start", () => {
		const good = cfp2File(2, 1, Buffer.alloc(8));
		expect(readCfp2Layout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("REB3", 0, "latin1");
		expect(readCfp2Layout(mark)).toBeUndefined();
		// The start may not be smaller than the head of the older variant.
		const early = Buffer.from(good);
		early.writeInt32LE(0x20, 0x10);
		expect(readCfp2Layout(early)).toBeUndefined();
	});

	it("takes the planes right behind the start where the picture would reach past the file", () => {
		const planes = Buffer.from([
			0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88,
		]);
		const tight = cfp2File(2, 1, planes, { tight: true });
		expect(readCfp2Layout(tight)?.dataOffset).toBe(0x1c);
		// And where it does not, the word at `0x1C` says how far behind the head they stand.
		const spaced = cfp2File(2, 1, Buffer.alloc(8), { offset: 4 });
		expect(readCfp2Layout(spaced)?.dataOffset).toBe(0x24);
	});

	it("unfolds the four planes of a picture", async () => {
		const data = cfp2File(
			2,
			1,
			Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]),
		);
		const out = await extract(tailCfp2ImageFormat, data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(0x36).toString("hex")).toBe("1133557722446688");
	});

	it("walks the planes from the bottom row up", async () => {
		const data = cfp2File(
			2,
			2,
			Buffer.from([
				0x00, 0x01, 0x10, 0x11, 0x02, 0x03, 0x20, 0x21, 0x04, 0x05, 0x30, 0x31,
				0x06, 0x07, 0x40, 0x41,
			]),
		);
		const out = await extract(tailCfp2ImageFormat, data);
		// The first row of a plane is the lowest row, so it stands **last** in the bitmap.
		expect(out.subarray(0x36).toString("hex")).toBe(
			"10203040112131410002040601030507",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = cfp2File(2, 1, Buffer.alloc(8));
		data.write("REB3", 0, "latin1");
		await expect(
			tailCfp2ImageFormat.open(new BufferByteSource(data), "pic.cfp"),
		).rejects.toThrow("Not a Tail transparent bitmap");
	});
});
