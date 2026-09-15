import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { BufferByteSource } from "@garbro-mcp/core";
import { eaglsGrImageFormat } from "../../packages/formats/src/eagls/gr-image.js";
import {
	writeBmp24,
	writeBmp32,
	writeBmp8,
} from "../../packages/formats/src/shared/bmp.js";

/** One control byte per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

/** A picture: the bitmap the reference stores, with the measurements of its header left alone. */
function grFile(bitmap: Buffer): Buffer {
	return lzssLiterals(bitmap);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await eaglsGrImageFormat.open(sourceOf(data), "cg.grp");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const stream = await handle.openEntry(entry.id);
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

/** The pixels of a picture, top down, four bytes to a pixel. */
function bgra32(rows: number[][]): Buffer {
	return Buffer.from(rows.flat());
}

describe("EAGLS compressed bitmap", () => {
	it("finds a picture whose stream unfolds to a bitmap", async () => {
		const bitmap = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]), true);
		expect(await eaglsGrImageFormat.detect(sourceOf(grFile(bitmap)))).toBe(
			true,
		);
		expect(
			await eaglsGrImageFormat.detect(sourceOf(Buffer.alloc(0x40, 0x00))),
		).toBe(false);
	});

	it("lists the picture with the measurements of its bitmap", async () => {
		const bitmap = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]), true);
		const handle = await eaglsGrImageFormat.open(
			sourceOf(grFile(bitmap)),
			"cg.grp",
		);
		expect(handle.entries).toHaveLength(1);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			unpackedSize: bitmap.length,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "eagls-lzss",
		});
	});

	it("writes the bitmap its stream unfolds to", async () => {
		const bitmap = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]), true);
		const out = await extract(grFile(bitmap));
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
	});

	it("turns the rows of a picture of thirty two bits the right way up", async () => {
		// A bitmap stores its rows from the bottom up, so the file holds the bottom row of the picture first
		// and the reference reads them back into a picture that is the other way up.
		const top = [1, 2, 3, 4, 5, 6, 7, 8];
		const bottom = [9, 10, 11, 12, 13, 14, 15, 16];
		const bitmap = writeBmp32(2, 2, bgra32([bottom, top]), true);
		const out = await extract(grFile(bitmap));
		expect(out.readUInt16LE(28)).toBe(32);
		expect(out.equals(writeBmp32(2, 2, bgra32([top, bottom])))).toBe(true);
	});

	it("reads a picture with a colour map as the bitmap it holds", async () => {
		const bitmap = writeBmp8(2, 1, Buffer.from([0x05, 0x06]), true);
		const out = await extract(grFile(bitmap));
		expect(out.readUInt16LE(28)).toBe(8);
		expect(out.subarray(54 + 0x400, 54 + 0x400 + 2)).toEqual(
			Buffer.from([0x05, 0x06]),
		);
	});

	it("refuses a stream that unfolds to something other than a bitmap", async () => {
		const body: Buffer = Buffer.alloc(0x40, 0x41);
		await expect(extract(grFile(body))).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("refuses a picture whose pixels are cut short", async () => {
		// A header naming four rows of sixteen pixels, with the stream ending after the first of them.
		const bitmap = writeBmp32(4, 4, Buffer.alloc(4 * 4 * 4, 0x11), true);
		const cut = bitmap.subarray(0, 54 + 16);
		await expect(extract(grFile(cut))).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("refuses a picture of nothing", async () => {
		const bitmap = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]), true);
		bitmap.writeUInt32LE(0, 0x12);
		await expect(extract(grFile(bitmap))).rejects.toMatchObject({
			code: "UNSUPPORTED_FEATURE",
		});
	});
});
