import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readCtfLayout,
	unknownCtfImageFormat,
	unpackCtfRle,
} from "../../packages/formats/src/unknown/ctf-image.js";

/** An LZSS stream of literals alone: a control byte of eight set bits before every eight bytes. */
function literalLzss(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let start = 0; start < data.length; start += 8) {
		parts.push(Buffer.from([0xff]), data.subarray(start, start + 8));
	}
	return Buffer.concat(parts);
}

/** The run walk of the planes: a head of twenty four bytes and then the runs. */
function runs(countLimit: number, body: Buffer): Buffer {
	const head = Buffer.alloc(0x18, 0x00);
	head[5] = countLimit;
	return Buffer.concat([head, body]);
}

/** A picture: the head, then the padding up to the stream and the packed planes. */
function ctfFile(input: {
	width: number;
	height: number;
	unpackedSize: number;
	red: number;
	green: number;
	blue: number;
	alpha?: number;
	runs: Buffer;
	bpp?: number;
	compressed?: number;
}): Buffer {
	const head = Buffer.alloc(0x48, 0x00);
	Buffer.from("CTFF", "latin1").copy(head, 0);
	head.writeUInt16LE(input.width, 4);
	head.writeUInt16LE(input.height, 6);
	head.writeInt32LE(input.unpackedSize, 0x0c);
	head.writeInt32LE(input.red, 0x10);
	head.writeInt32LE(input.green, 0x14);
	head.writeInt32LE(input.blue, 0x18);
	head.writeInt32LE(input.alpha ?? 0, 0x1c);
	head.writeUInt8(input.bpp ?? 24, 0x20);
	head.writeUInt8(input.compressed ?? 0xff, 0x22);
	return Buffer.concat([head, literalLzss(input.runs)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await unknownCtfImageFormat.open(
		new BufferByteSource(data),
		"pic.ctf",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("'Unknown' image", () => {
	it("reads the head as the reference does", () => {
		const data = ctfFile({
			width: 2,
			height: 1,
			unpackedSize: 6,
			red: 0,
			green: 2,
			blue: 4,
			runs: runs(1, Buffer.alloc(12)),
		});
		expect(readCtfLayout(data)).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			stride: 8,
			unpackedSize: 6,
			compressed: true,
		});
		// A place of the alpha plane is what makes the picture thirty two bits a pixel.
		const withAlpha = ctfFile({
			width: 2,
			height: 1,
			unpackedSize: 8,
			red: 0,
			green: 2,
			blue: 4,
			alpha: 6,
			runs: runs(1, Buffer.alloc(16)),
		});
		expect(readCtfLayout(withAlpha)).toMatchObject({
			bitsPerPixel: 32,
			stride: 8,
		});
	});

	it("gates on the word, the depth, the planes and the stream", () => {
		const good = ctfFile({
			width: 2,
			height: 1,
			unpackedSize: 6,
			red: 0,
			green: 2,
			blue: 4,
			runs: runs(1, Buffer.alloc(12)),
		});
		expect(readCtfLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("CTFE", 0, "latin1");
		expect(readCtfLayout(mark)).toBeUndefined();
		const depth = Buffer.from(good);
		depth.writeUInt8(32, 0x20);
		expect(readCtfLayout(depth)).toBeUndefined();
		// Every plane has to stand inside the planes the head declares.
		const far = Buffer.from(good);
		far.writeInt32LE(0x100, 0x10);
		expect(readCtfLayout(far)).toBeUndefined();
		const short = Buffer.from(good.subarray(0, 0x40));
		expect(readCtfLayout(short)).toBeUndefined();
	});

	it("walks runs of a byte up to the count and then behind it", () => {
		const output = Buffer.alloc(6, 0x00);
		// A count of two: two bytes of the run stand, and then a byte that says the run is four long. A byte
		// that no other follows is a run of one, and where the runs end the rest of the planes stands as it is.
		unpackCtfRle(runs(2, Buffer.from([0x11, 0x11, 0x02, 0x11])), output);
		expect(output.toString("hex")).toBe("111111111100");
	});

	it("writes a twenty four bit picture out again", async () => {
		const data = ctfFile({
			width: 2,
			height: 1,
			unpackedSize: 6,
			red: 0,
			green: 2,
			blue: 4,
			runs: runs(
				1,
				Buffer.from([
					0x11, 0x00, 0x22, 0x00, 0x33, 0x00, 0x44, 0x00, 0x55, 0x00, 0x66,
					0x00,
				]),
			),
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `ImageData.Create` keeps the stored order top down.
		expect(out.readInt32LE(0x16)).toBe(-1);
		// The planes are red, green and blue, and the picture is written blue, green, red.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("5533116644220000");
	});

	it("weaves the alpha plane into a thirty two bit picture", async () => {
		const data = ctfFile({
			width: 2,
			height: 1,
			unpackedSize: 8,
			red: 0,
			green: 2,
			blue: 4,
			alpha: 6,
			runs: runs(
				1,
				Buffer.from([
					0x11, 0x00, 0x22, 0x00, 0x33, 0x00, 0x44, 0x00, 0x55, 0x00, 0x66,
					0x00, 0x77, 0x00, 0x88, 0x00,
				]),
			),
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.subarray(0x36).toString("hex")).toBe("5533117766442288");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = ctfFile({
			width: 2,
			height: 1,
			unpackedSize: 6,
			red: 0,
			green: 2,
			blue: 4,
			runs: runs(1, Buffer.alloc(12)),
		});
		data.write("CTFE", 0, "latin1");
		await expect(
			unknownCtfImageFormat.open(new BufferByteSource(data), "pic.ctf"),
		).rejects.toThrow(GarbroError);
		await expect(
			unknownCtfImageFormat.open(new BufferByteSource(data), "pic.ctf"),
		).rejects.toThrow("Not an 'Unknown' picture");
	});
});
