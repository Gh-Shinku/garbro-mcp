import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readRsgLayout,
	rsystemRsgImageFormat,
	unpackRsg,
} from "../../packages/formats/src/rsystem/rsg-image.js";

/** A file: the head and then the chunks. */
function rsgFile(
	width: number,
	height: number,
	chunkCount: number,
	body: Buffer,
): Buffer {
	const head = Buffer.alloc(12);
	Buffer.from("RS", "latin1").copy(head, 0);
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	head.writeInt32LE(chunkCount, 8);
	return Buffer.concat([head, body]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await rsystemRsgImageFormat.open(
		new BufferByteSource(data),
		"pic.rsg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("RSystem engine image", () => {
	it("reads the head as the reference does", () => {
		expect(readRsgLayout(rsgFile(4, 3, 2, Buffer.alloc(0)))).toEqual({
			width: 4,
			height: 3,
			bitsPerPixel: 32,
			chunkCount: 2,
		});
	});

	it("gates on the signature and the head", async () => {
		const data = rsgFile(2, 1, 1, Buffer.from([0x00, 1, 2, 3]));
		expect(
			await rsystemRsgImageFormat.detect(new BufferByteSource(data), "pic.rsg"),
		).toBe(true);
		const other = Buffer.from(data);
		other.write("RT", 0, "latin1");
		expect(readRsgLayout(other)).toBeUndefined();
		expect(readRsgLayout(rsgFile(0, 1, 1, Buffer.alloc(0)))).toBeUndefined();
		expect(readRsgLayout(rsgFile(2, 1, -1, Buffer.alloc(0)))).toBeUndefined();
	});

	it("reads the pixels that stand in the stream themselves", () => {
		const data = rsgFile(
			2,
			1,
			1,
			Buffer.from([0x01, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60]),
		);
		const layout = readRsgLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackRsg(data, layout).toString("hex")).toBe("1020300040506000");
	});

	it("repeats one pixel the number of times the control says", () => {
		const data = rsgFile(3, 1, 1, Buffer.from([0x12, 0xaa, 0xbb, 0xcc]));
		const layout = readRsgLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackRsg(data, layout).toString("hex")).toBe(
			"aabbcc00aabbcc00aabbcc00",
		);
	});

	it("copies a pixel from a distance again and again", () => {
		const data = rsgFile(
			3,
			1,
			2,
			Buffer.concat([
				Buffer.from([0x00, 0x11, 0x22, 0x33]),
				Buffer.from([0x41, 0x01, 0x00]),
			]),
		);
		const layout = readRsgLayout(data);
		if (!layout) throw new Error("no layout");
		// The place copied from stands still, so every pixel of the chunk is the same one.
		expect(unpackRsg(data, layout).toString("hex")).toBe(
			"112233001122330011223300",
		);
	});

	it("steps a pixel by the three channels of the word behind it", () => {
		const data = rsgFile(
			2,
			1,
			2,
			Buffer.concat([
				Buffer.from([0x00, 0x0a, 0x14, 0x1e]),
				Buffer.from([0x80, 0x41, 0x08]),
			]),
		);
		const layout = readRsgLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackRsg(data, layout).toString("hex")).toBe("0a141e000b151f00");
	});

	it("reads a step of every channel as a signed value", () => {
		const data = rsgFile(
			2,
			1,
			2,
			Buffer.concat([
				Buffer.from([0x00, 0x0a, 0x14, 0x1e]),
				Buffer.from([0x80, 0xff, 0xff]),
			]),
		);
		const layout = readRsgLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackRsg(data, layout).toString("hex")).toBe("0a141e0009131d00");
	});

	it("passes over a chunk whose high nibble it does not know", () => {
		const data = rsgFile(2, 1, 2, Buffer.from([0x20, 0xaa, 0xbb, 0xcc]));
		const layout = readRsgLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackRsg(data, layout).toString("hex")).toBe("0000000000000000");
	});

	it("refuses a chunk that reaches outside the picture", () => {
		const wide = rsgFile(
			2,
			1,
			1,
			Buffer.from([0x03, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
		);
		const wideLayout = readRsgLayout(wide);
		if (!wideLayout) throw new Error("no layout");
		expect(() => unpackRsg(wide, wideLayout)).toThrow("past its own end");
		const behind = rsgFile(3, 1, 1, Buffer.from([0x41, 0x01, 0x00]));
		const behindLayout = readRsgLayout(behind);
		if (!behindLayout) throw new Error("no layout");
		expect(() => unpackRsg(behind, behindLayout)).toThrow(
			"before its own start",
		);
	});

	it("writes the picture out again thirty two bits a pixel", async () => {
		const data = rsgFile(
			2,
			1,
			1,
			Buffer.from([0x01, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60]),
		);
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// `ImageData.Create` keeps the stored order top down.
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(54, 62).toString("hex")).toBe("1020300040506000");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = rsgFile(2, 1, 1, Buffer.alloc(0));
		data.write("RT", 0, "latin1");
		await expect(
			rsystemRsgImageFormat.open(new BufferByteSource(data), "pic.rsg"),
		).rejects.toThrow(GarbroError);
		await expect(
			rsystemRsgImageFormat.open(new BufferByteSource(data), "pic.rsg"),
		).rejects.toThrow("Not an RSystem picture");
	});
});
