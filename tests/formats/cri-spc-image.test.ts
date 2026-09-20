import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	criSpcImageFormat,
	readSpcSize,
	unpackSpc,
} from "../../packages/formats/src/cri/spc-image.js";
import { criXtxImageFormat } from "../../packages/formats/src/cri/xtx-image.js";
import { literalLzssStream } from "../helpers/lzss.js";

/** A texture: the head and then the pixels, the head naming a picture of the first kind of tiling unless the
 * places it is built with say otherwise. */
function xtxFile(input: {
	width: number;
	height: number;
	alignedWidth: number;
	alignedHeight: number;
	kind?: number;
	body: Buffer;
	headerSize?: number;
}): Buffer {
	const head = Buffer.alloc(0x20, 0x00);
	Buffer.from([0x78, 0x74, 0x78, 0x00]).copy(head, 0);
	head.writeUInt8(input.kind ?? 0, 4);
	head.writeInt32BE(input.alignedWidth, 8);
	head.writeInt32BE(input.alignedHeight, 0xc);
	head.writeUInt32BE(input.width, 0x10);
	head.writeUInt32BE(input.height, 0x14);
	if (input.headerSize === undefined) return Buffer.concat([head, input.body]);
	const size = Buffer.alloc(4, 0x00);
	size.writeUInt32LE(input.headerSize, 0);
	const padding = Buffer.alloc(input.headerSize - 4, 0x00);
	return Buffer.concat([size, padding, head, input.body]);
}

/** A file of the kind this format reads: the places of the head and then the walked texture. */
function spcFile(texture: Buffer, size?: number): Buffer {
	const head = Buffer.alloc(4, 0x00);
	head.writeUInt32LE(size ?? texture.length, 0);
	return Buffer.concat([head, literalLzssStream(texture)]);
}

async function extract(
	format: typeof criSpcImageFormat,
	data: Buffer,
	name: string,
) {
	const handle = await format.open(new BufferByteSource(data), name);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The four bytes of a pixel of the bitmap the picture is written to. */
function pixel(pixels: Buffer, width: number, x: number, y: number): Buffer {
	const at = (y * width + x) * 4;
	return pixels.subarray(at, at + 4);
}

/** A picture of the first kind of tiling: every place of the tiling stands as the place it stands at. */
function plainTexture(): Buffer {
	const texture = Buffer.alloc(32 * 32 * 4, 0x00);
	for (let at = 0; at < 32 * 32; at += 1) {
		texture[at * 4] = 0xff;
		texture[at * 4 + 1] = at & 0xff;
		texture[at * 4 + 2] = (at >> 8) & 0xff;
		texture[at * 4 + 3] = 0x00;
	}
	return texture;
}

/** A picture of the third kind of tiling: one block of four by four places, every place of it standing as the
 * whole of white and the whole of alpha. */
function blockTexture(): Buffer {
	const block = Buffer.alloc(16, 0x00);
	block[0] = 0xff;
	block[1] = 0x00;
	block.writeUInt16LE(0xffff, 8);
	block.writeUInt16LE(0x0000, 10);
	block.writeUInt32LE(0x00000000, 12);
	// Every word of two bytes of it stands turned around in the file.
	const texture = Buffer.from(block);
	for (let at = 0; at < texture.length; at += 2) {
		const first = texture[at] ?? 0;
		texture[at] = texture[at + 1] ?? 0;
		texture[at + 1] = first;
	}
	return texture;
}

describe("CRI compressed texture format", () => {
	it("reads how many places the texture holds", () => {
		const head = Buffer.alloc(4, 0x00);
		head.writeUInt32LE(0x1000, 0);
		expect(readSpcSize(head, 4)).toBe(0x1000);
	});

	it("turns away a head that names no texture", () => {
		for (const size of [0, 0x20, 0x5000001, 0xffffffff]) {
			const head = Buffer.alloc(4, 0x00);
			head.writeUInt32LE(size, 0);
			expect(readSpcSize(head, 4)).toBeUndefined();
		}
		expect(readSpcSize(Buffer.alloc(2), 2)).toBeUndefined();
	});

	it("stands the walked places of the texture as the places of the file name", () => {
		const texture = plainTexture();
		const walked = unpackSpc(spcFile(texture), texture.length);
		expect(walked.equals(texture)).toBe(true);
	});

	it("hands out what the texture of the same places hands out", async () => {
		// A texture of the first kind of tiling, stood behind a walk of its own, stands as the same picture as
		// the texture that stands in the clear.
		const texture = xtxFile({
			width: 32,
			height: 32,
			alignedWidth: 32,
			alignedHeight: 32,
			body: plainTexture(),
		});
		const walked = await extract(
			criSpcImageFormat,
			spcFile(texture),
			"tex.spc",
		);
		const plain = await extract(criXtxImageFormat, texture, "tex.xtx");
		expect(walked.equals(plain)).toBe(true);
		expect(walked.readUInt16LE(0x1c)).toBe(32);
		// `ImageData.Create` keeps the stored order top down, so the height of the bitmap is negative.
		expect(walked.readInt32LE(0x16)).toBe(-32);
		// What stands at the place is the whole, the two bytes of the place of the texture read back to front
		// and the whole again.
		expect(pixel(walked.subarray(0x36), 32, 4, 1).toString("hex")).toBe(
			"00000cff",
		);
	});

	it("hands out a picture of the third kind of tiling as the texture it walks", async () => {
		const texture = xtxFile({
			width: 4,
			height: 4,
			alignedWidth: 4,
			alignedHeight: 4,
			kind: 2,
			body: blockTexture(),
		});
		const walked = await extract(
			criSpcImageFormat,
			spcFile(texture),
			"tex.spc",
		);
		const plain = await extract(criXtxImageFormat, texture, "tex.xtx");
		expect(walked.equals(plain)).toBe(true);
		for (let at = 0; at < 16; at += 1) {
			expect(
				pixel(walked.subarray(0x36), 4, at % 4, Math.floor(at / 4)).toString(
					"hex",
				),
			).toBe("ffffffff");
		}
	});

	it("reads a texture whose head stands behind a size of its own", async () => {
		const texture = xtxFile({
			width: 4,
			height: 4,
			alignedWidth: 4,
			alignedHeight: 4,
			headerSize: 0x40,
			body: plainTexture().subarray(0, 4 * 4 * 4),
		});
		const data = spcFile(texture);
		await expect(
			criSpcImageFormat.detect(new BufferByteSource(data)),
		).resolves.toBe(true);
		const handle = await criSpcImageFormat.open(
			new BufferByteSource(data),
			"t.spc",
		);
		expect(handle.metadata).toMatchObject({
			width: 4,
			height: 4,
			unpackedSize: texture.length,
		});
	});

	it("turns away a walked part that names no texture", async () => {
		// A head of no places at all, a head that names more places than a texture may hold, and a walked part
		// whose places do not stand as a texture stand as no texture at all.
		const short = Buffer.alloc(8, 0x00);
		short.writeUInt32LE(0x40, 0);
		await expect(
			criSpcImageFormat.detect(new BufferByteSource(short)),
		).resolves.toBe(false);
		const tooBig = Buffer.alloc(8, 0x00);
		tooBig.writeUInt32LE(0x6000000, 0);
		await expect(
			criSpcImageFormat.detect(new BufferByteSource(tooBig)),
		).resolves.toBe(false);
		await expect(
			criSpcImageFormat.detect(new BufferByteSource(Buffer.alloc(4, 0x00))),
		).resolves.toBe(false);
		const other = Buffer.concat([
			Buffer.from([0x40, 0x00, 0x00, 0x00]),
			literalLzssStream(Buffer.alloc(0x40, 0x11)),
		]);
		await expect(
			criSpcImageFormat.detect(new BufferByteSource(other)),
		).resolves.toBe(false);
	});

	it("turns away a texture of the second kind of tiling", async () => {
		const texture = xtxFile({
			width: 4,
			height: 4,
			alignedWidth: 4,
			alignedHeight: 4,
			kind: 1,
			body: Buffer.alloc(32, 0x00),
		});
		await expect(
			extract(criSpcImageFormat, spcFile(texture), "tex.spc"),
		).rejects.toThrow(GarbroError);
	});

	it("stands after every kind of file that is told by a word of its own", async () => {
		expect(criSpcImageFormat.descriptor.id).toBe("cri-spc-image");
		expect(criSpcImageFormat.detection).toEqual({
			signatures: [],
			priority: -1,
		});
		const texture = xtxFile({
			width: 4,
			height: 4,
			alignedWidth: 4,
			alignedHeight: 4,
			body: plainTexture().subarray(0, 4 * 4 * 4),
		});
		await expect(
			criSpcImageFormat.detect(new BufferByteSource(spcFile(texture))),
		).resolves.toBe(true);
	});
});
