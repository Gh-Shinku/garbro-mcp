import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	gbcImageFormat,
	readGbcLayout,
	unpackGbcPicture,
} from "../../packages/formats/src/primel/gbc-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEAD_SIZE = 0x30;

/** The bits of a picture, of which the highest of a byte stands first. */
function bitsToBytes(bits: number[]): Buffer {
	const bytes: number[] = [];
	for (let at = 0; at < bits.length; at += 8) {
		let value = 0;
		for (let bit = 0; bit < 8; bit += 1)
			value = (value << 1) | (bits[at + bit] ?? 0);
		bytes.push(value);
	}
	return Buffer.from(bytes);
}

/** The four bits a run of one place of the first way stands of. */
function code(value: number): number[] {
	if (0 === value) return [0, 0, 0, 0];
	return [0, 0, 0, 1];
}

/** A picture of this engine: its head, then the bits of its blocks. */
function gbcFile(
	width: number,
	height: number,
	bits: number,
	options: { deep?: boolean } = {},
): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("GBCF", 0, "latin1");
	head.writeUInt32LE(width, 8);
	head.writeUInt32LE(height, 0xc);
	head.writeUInt16LE(bits, 0x10);
	head.writeUInt16LE(options.deep ? 0x800 : 0, 0x12);
	return Buffer.concat([head, Buffer.alloc(4, 0x00)]);
}

function gbcPicture(
	width: number,
	height: number,
	stream: number[],
	options: { deep?: boolean } = {},
): Buffer {
	const head = gbcFile(width, height, 8, options).subarray(0, HEAD_SIZE);
	return Buffer.concat([head, bitsToBytes(stream)]);
}

async function extract(data: Buffer) {
	const handle = await gbcImageFormat.open(
		new BufferByteSource(data),
		"picture.gbc",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("no picture");
	return image;
}

describe("Primel Adventure System image", () => {
	it("reads the head of a picture and turns away the ones that stand no picture", () => {
		const layout = readGbcLayout(gbcFile(8, 8, 8));
		expect(layout?.width).toBe(8);
		expect(layout?.height).toBe(8);
		expect(layout?.bitsPerPixel).toBe(8);
		expect(layout?.flags).toBe(0);
		const deep = readGbcLayout(gbcFile(8, 8, 24, { deep: true }));
		expect(deep?.bitsPerPixel).toBe(24);
		expect(deep?.flags).toBe(0x800);
		const wrong = Buffer.from(gbcFile(8, 8, 8));
		wrong.write("GBCE", 0, "latin1");
		expect(readGbcLayout(wrong)).toBeUndefined();
		expect(readGbcLayout(gbcFile(8, 8, 16))).toBeUndefined();
	});

	it("carries the places of a block from the places before them", () => {
		// The places of a block of the first way are carried along the zigzag order of it, and every place of
		// the picture stands a place of its own below the place of the block.
		const picture = unpackGbcPicture(
			gbcPicture(1, 1, [
				...new Array(64 * 4).fill(0),
				...new Array(64).fill(0),
			]),
			{ width: 1, height: 1, bitsPerPixel: 8, flags: 0 },
		);
		expect([...picture]).toEqual([0x80]);
		const one = unpackGbcPicture(
			gbcPicture(1, 1, [
				...code(1),
				...new Array(63 * 4).fill(0),
				...new Array(64).fill(0),
			]),
			{ width: 1, height: 1, bitsPerPixel: 8, flags: 0 },
		);
		// A place of the block carried along the whole of the zigzag order stands at every place of it.
		expect([...one]).toEqual([0x81]);
	});

	it("hands over the places of a block of the second way as they stand", () => {
		// The second way names the places of a block one by one, of as many places standing over as the bits
		// behind a place of nothing name; a place of nothing of sixteen of them ends the block.
		const zeros = [...new Array(64 * 5).fill(0), ...new Array(64).fill(0)];
		const picture = unpackGbcPicture(gbcPicture(1, 1, zeros, { deep: true }), {
			width: 1,
			height: 1,
			bitsPerPixel: 8,
			flags: 0x800,
		});
		expect([...picture]).toEqual([0x00]);
	});

	it("hands a picture over as a bitmap and tells one by the word it opens with", async () => {
		const data = gbcPicture(1, 1, [
			...new Array(64 * 4).fill(0),
			...new Array(64).fill(0),
		]);
		const image = await extract(data);
		expect(image.width).toBe(1);
		expect(image.height).toBe(1);
		expect([...image.pixels]).toEqual([0x80]);
		expect(await gbcImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		const wrong = Buffer.from(data);
		wrong[1] = 0x00;
		expect(await gbcImageFormat.detect?.(new BufferByteSource(wrong))).toBe(
			false,
		);
	});
});
