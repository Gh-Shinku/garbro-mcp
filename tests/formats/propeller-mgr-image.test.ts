import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { propellerMgrImageFormat } from "../../packages/formats/src/propeller/mgr-image.js";
import {
	readBmpImage,
	writeBmp24,
	writeBmp32,
	writeBmpImage,
} from "../../packages/formats/src/shared/bmp.js";

/** A stream of nothing but runs of bytes, which is all the fixtures here need. */
function compressMgr(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	let at = 0;
	while (at < data.length) {
		const count = Math.min(0x20, data.length - at);
		parts.push(Buffer.from([count - 1]), data.subarray(at, at + count));
		at += count;
	}
	return Buffer.concat(parts);
}

/** A file of one picture, or of several behind a table of their offsets. */
function mgrFile(pictures: Buffer[], packed?: Buffer): Buffer {
	const streams = pictures.map((picture) => compressMgr(picture));
	if (pictures.length === 1) {
		const head: Buffer = Buffer.alloc(2, 0);
		head.writeInt16LE(1, 0);
		const size: Buffer = Buffer.alloc(8, 0);
		size.writeInt32LE(pictures[0]?.length ?? 0, 0);
		size.writeInt32LE((packed ?? streams[0])?.length ?? 0, 4);
		return Buffer.concat([head, size, packed ?? streams[0] ?? Buffer.alloc(0)]);
	}
	const head: Buffer = Buffer.alloc(2, 0);
	head.writeInt16LE(pictures.length, 0);
	const table: Buffer = Buffer.alloc(pictures.length * 4, 0);
	let offset = 2 + pictures.length * 4;
	const frames: Buffer[] = [];
	for (const [index, stream] of streams.entries()) {
		table.writeInt32LE(offset, index * 4);
		const size: Buffer = Buffer.alloc(8, 0);
		size.writeInt32LE(pictures[index]?.length ?? 0, 0);
		size.writeInt32LE(stream.length, 4);
		frames.push(size, stream);
		offset += 8 + stream.length;
	}
	return Buffer.concat([head, table, ...frames]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.mgr"): Promise<Buffer> {
	const handle = await propellerMgrImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Propeller image", () => {
	const pixels: Buffer = Buffer.alloc(4 * 2 * 3, 0);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 5) & 0xff;
	const picture = writeBmp24(4, 2, pixels);

	it("finds a file holding one picture", async () => {
		expect(
			await propellerMgrImageFormat.detect(
				sourceOf(mgrFile([picture])),
				"cg.mgr",
			),
		).toBe(true);
		// The reference reads this format from no name in particular, and asks only for the count.
		expect(
			await propellerMgrImageFormat.detect(
				sourceOf(mgrFile([picture])),
				"cg.dat",
			),
		).toBe(true);
	});

	it("declines a file of no picture, or of more than it reads", async () => {
		const none: Buffer = Buffer.alloc(10, 0);
		expect(await propellerMgrImageFormat.detect(sourceOf(none))).toBe(false);
		const many: Buffer = Buffer.alloc(10, 0);
		many.writeInt16LE(0x100, 0);
		expect(await propellerMgrImageFormat.detect(sourceOf(many))).toBe(false);
	});

	it("declines a table whose first picture is not behind it", async () => {
		const data = Buffer.from(mgrFile([picture, picture]));
		data.writeInt32LE(2 + 2 * 4 + 1, 2);
		expect(await propellerMgrImageFormat.detect(sourceOf(data))).toBe(false);
	});

	it("reports what the bitmap behind the stream says about itself", async () => {
		const handle = await propellerMgrImageFormat.open(
			sourceOf(mgrFile([picture])),
			"dir/cg.mgr",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 4,
			height: 2,
			bitsPerPixel: 24,
			unpackedSize: picture.length,
		});
	});

	it("writes the picture the stream unfolds to", async () => {
		const image = readBmpImage(picture);
		if (!image) throw new Error("the fixture is not a bitmap");
		expect(await extract(mgrFile([picture]))).toEqual(writeBmpImage(image));
	});

	it("reads the first picture of a file holding several", async () => {
		const other = writeBmp24(2, 2, Buffer.alloc(12, 0x77));
		const image = readBmpImage(picture);
		if (!image) throw new Error("the fixture is not a bitmap");
		expect(await extract(mgrFile([picture, other]))).toEqual(
			writeBmpImage(image),
		);
	});

	it("turns the rows of a picture of thirty two bits the other way up", async () => {
		// The stream keeps the rows the way a bitmap keeps them, and the reference copies them out backwards.
		const rows: Buffer = Buffer.alloc(4 * 2 * 4, 0);
		for (let i = 0; i < 4; i += 1) rows[i] = 0x11;
		for (let i = 4; i < 8; i += 1) rows[i] = 0x22;
		for (let i = 0; i < 8; i += 1) rows[8 + i] = (i * 9) & 0xff;
		const wide = writeBmp32(2, 2, rows, true);
		const out = await extract(mgrFile([wide]));
		expect(out.readUInt16LE(28)).toBe(32);
		// The first row of the picture is the second row of the stream.
		expect(out.subarray(54, 54 + 8)).toEqual(rows.subarray(8, 16));
		expect(out.subarray(54 + 8, 54 + 16)).toEqual(rows.subarray(0, 8));
	});

	it("refuses a stream that is cut short of its picture", async () => {
		const packed = compressMgr(picture);
		const short = Buffer.concat([packed.subarray(0, 4), Buffer.alloc(0)]);
		await expect(extract(mgrFile([picture], short))).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});
});
