import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readMtlLayout,
	unpackMtl,
	zyxMtlImageFormat,
} from "../../packages/formats/src/zyx/mtl-image.js";

const HEADER_SIZE = 0x2c;

/** A file: the head, the name, the frame index and then the walk. */
function mtlFile(
	width: number,
	height: number,
	stream: Buffer,
	frameCount = 1,
	name = "metal",
): Buffer {
	const head = Buffer.alloc(HEADER_SIZE);
	Buffer.from("METAL", "latin1").copy(head, 0);
	head.writeInt32LE(0x28, 0x10);
	head[0x15] = 1;
	head.writeUInt32LE(width, 0x20);
	head.writeUInt32LE(height, 0x24);
	head.writeInt32LE(name.length, 0x28);
	const nameBytes = Buffer.from(name, "latin1");
	const index = Buffer.alloc(8 + frameCount * 0x18);
	index.writeInt32LE(0xc, 0);
	index.writeInt32LE(frameCount, 4);
	return Buffer.concat([head, nameBytes, index, stream]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await zyxMtlImageFormat.open(
		new BufferByteSource(data),
		"pic.mtl",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** Two literals, a copy of the pixel to the left and a run of one from the start. */
const FOUR_BY_ONE = Buffer.from([
	0x01, 0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0xe0, 0xf0, 0x02,
]);

describe("Zyx METAL picture", () => {
	it("finds a picture by its head", async () => {
		const data = mtlFile(4, 1, FOUR_BY_ONE);
		expect(
			await zyxMtlImageFormat.detect(new BufferByteSource(data), "pic.mtl"),
		).toBe(true);
		// The word at 0x10 has to be 0x28.
		const odd = Buffer.from(data);
		odd.writeInt32LE(0x29, 0x10);
		expect(
			await zyxMtlImageFormat.detect(new BufferByteSource(odd), "pic.mtl"),
		).toBe(false);
		// The byte at 0x15 may not be nothing.
		const blank = Buffer.from(data);
		blank[0x15] = 0;
		expect(
			await zyxMtlImageFormat.detect(new BufferByteSource(blank), "pic.mtl"),
		).toBe(false);
		// Nor may the name length.
		const unnamed = Buffer.from(data);
		unnamed.writeInt32LE(0, 0x28);
		expect(
			await zyxMtlImageFormat.detect(new BufferByteSource(unnamed), "pic.mtl"),
		).toBe(false);
		// The word behind the name has to be 0xc.
		const wrongIndex = Buffer.from(data);
		wrongIndex.writeInt32LE(0xd, HEADER_SIZE + 5);
		expect(
			await zyxMtlImageFormat.detect(
				new BufferByteSource(wrongIndex),
				"pic.mtl",
			),
		).toBe(false);
		// And the count of frames has to be sane.
		const noFrames = mtlFile(4, 1, FOUR_BY_ONE, 0);
		noFrames.writeInt32LE(0, HEADER_SIZE + 5 + 4);
		expect(
			await zyxMtlImageFormat.detect(new BufferByteSource(noFrames), "pic.mtl"),
		).toBe(false);
	});

	it("reads the head as the reference does", () => {
		const data = mtlFile(320, 240, FOUR_BY_ONE, 2);
		const layout = readMtlLayout(data);
		// The walk stands behind the name, the marker and one record per frame.
		expect(layout).toEqual({
			width: 320,
			height: 240,
			dataOffset: HEADER_SIZE + 5 + 8 + 2 * 0x18,
		});
	});

	it("reports the measurements of the picture", async () => {
		const data = mtlFile(4, 1, FOUR_BY_ONE, 2);
		const handle = await zyxMtlImageFormat.open(
			new BufferByteSource(data),
			"dir/pic.mtl",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		// The walk stands behind the head, the name, the marker and one record per frame.
		expect(handle.entries[0]?.packedSize).toBe(BigInt(FOUR_BY_ONE.length));
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 4,
			height: 1,
			bitsPerPixel: 32,
		});
	});

	it("writes the picture out again thirty two bits a pixel", async () => {
		const out = await extract(mtlFile(4, 1, FOUR_BY_ONE));
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.readInt32LE(0x12)).toBe(4);
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(54).toString("hex")).toBe(
			"01020300" + "11121300" + "11121300" + "01020300",
		);
	});

	it("declines a stream that does not hold a picture", async () => {
		// A head that is not all there is refused before the walk is reached.
		const data = mtlFile(4, 1, FOUR_BY_ONE).subarray(0, 0x20);
		await expect(
			zyxMtlImageFormat.open(new BufferByteSource(data), "pic.mtl"),
		).rejects.toThrow(GarbroError);
		await expect(
			zyxMtlImageFormat.open(new BufferByteSource(data), "pic.mtl"),
		).rejects.toThrow("Not a Zyx METAL picture");
		// And a walk that stops before the picture is whole is refused when it is read.
		const short = mtlFile(4, 1, FOUR_BY_ONE.subarray(0, 2));
		const handle = await zyxMtlImageFormat.open(
			new BufferByteSource(short),
			"pic.mtl",
		);
		await expect(handle.openEntry("0")).rejects.toThrow("cut short");
	});
});

describe("Zyx METAL walk", () => {
	const layout = { width: 4, height: 1, dataOffset: 0 };

	it("leaves the pixels of the second kind as they stand", () => {
		// A literal, then three pixels left as nothing.
		const out = unpackMtl(Buffer.from([0x00, 0xaa, 0xbb, 0xcc, 0x82]), layout);
		expect(out.toString("hex")).toBe(
			"aabbcc00" + "00000000" + "00000000" + "00000000",
		);
	});

	it("repeats the pixel of the third kind, one more than the control says", () => {
		const out = unpackMtl(Buffer.from([0xc1, 0xaa, 0xbb, 0xcc, 0x80]), layout);
		// A count of two in the low five bits makes three pixels.
		expect(out.subarray(0, 12).toString("hex")).toBe(
			"aabbcc00aabbcc00aabbcc00",
		);
	});

	it("copies the pixel above and above left", () => {
		// Two rows of two pixels: two literals, then the pixel above and the pixel above left.
		const stream = Buffer.from([
			0x01, 0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0xe1, 0xe2,
		]);
		const out = unpackMtl(stream, { width: 2, height: 2, dataOffset: 0 });
		expect(out.subarray(0, 8).toString("hex")).toBe("0102030011121300");
		// Above left of the second pixel of the second row is the first pixel of the picture.
		expect(out.subarray(8, 16).toString("hex")).toBe("0102030001020300");
	});

	it("copies the pixel above right and the pixel to the left", () => {
		const stream = Buffer.from([
			0x01, 0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0xe3, 0xe0,
		]);
		const out = unpackMtl(stream, { width: 2, height: 2, dataOffset: 0 });
		// Above right of the first pixel of the second row is the second pixel of the first row, and the
		// pixel to its left is that same one.
		expect(out.subarray(8, 16).toString("hex")).toBe("1112130011121300");
	});

	it("reads a run of one from an eight bit distance", () => {
		// Three literals, then a run of one from distance four, the pixel before the last.
		const stream = Buffer.from([
			0x02, 0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0x21, 0x22, 0x23, 0xf0, 0x00,
		]);
		const out = unpackMtl(stream, layout);
		expect(out.subarray(12, 16).toString("hex")).toBe("21222300");
	});

	it("reads a run with a sixteen bit distance and a sixteen bit count", () => {
		// One literal of the value `aa`, then a run of two from distance four that repeats it.
		const stream = Buffer.from([
			0x00, 0xaa, 0xbb, 0xcc, 0xf9, 0x00, 0x00, 0x01, 0x80,
		]);
		const out = unpackMtl(stream, layout);
		expect(out.toString("hex")).toBe("aabbcc00aabbcc00aabbcc0000000000");
	});

	it("refuses a command that reaches outside the picture", () => {
		expect(() => unpackMtl(Buffer.from([0xf0, 0x00]), layout)).toThrow(
			"past its own end",
		);
		expect(() =>
			unpackMtl(Buffer.from([0x82]), { width: 1, height: 1, dataOffset: 0 }),
		).toThrow("past its own end");
	});
});
