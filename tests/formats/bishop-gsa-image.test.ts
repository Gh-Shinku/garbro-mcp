import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	gsaImageFormat,
	readGsaLayout,
	unpackGsaPicture,
} from "../../packages/formats/src/bishop/gsa-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEAD_SIZE = 0xd8;
const MARK = Buffer.from([0x8c, 0x8e, 0x42, 0x4d]);

/** The bits of a picture, of which the lowest stands first, written the way the reader takes them. */
function bitsToBytes(bits: number[]): Buffer {
	const bytes: number[] = [];
	for (let at = 0; at < bits.length; at += 8) {
		let value = 0;
		for (let bit = 0; bit < 8; bit += 1) value |= (bits[at + bit] ?? 0) << bit;
		bytes.push(value);
	}
	return Buffer.from(bytes);
}

/** A run of as many bits as the way of a block names, of which the lowest stands first as well. */
function bitsOf(value: number, count: number): number[] {
	const bits: number[] = [];
	for (let at = 0; at < count; at += 1) bits.push((value >> at) & 1);
	return bits;
}

/** The way of a block, then the run of it: the places themselves, four of them, of eight bits. */
function literal(values: number[]): number[] {
	return [...bitsOf(7, 3), ...values.flatMap((value) => bitsOf(value, 8))];
}

interface Wanted {
	type: number;
	width: number;
	height: number;
	offsetX?: number;
	offsetY?: number;
	bits: number[];
}

/** A picture of this engine: its word, its head far behind it, then the bits of its blocks. */
function gsaFile(wanted: Wanted): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	MARK.copy(head, 0);
	head.writeInt32LE(wanted.type, 0xc0);
	head.writeUInt32LE(wanted.width, 0xc4);
	head.writeUInt32LE(wanted.height, 0xc8);
	head.writeInt32LE(wanted.offsetX ?? 0, 0xcc);
	head.writeInt32LE(wanted.offsetY ?? 0, 0xd0);
	return Buffer.concat([head, bitsToBytes(wanted.bits)]);
}

async function extract(data: Buffer, name = "picture.gsa") {
	const source = new BufferByteSource(data);
	const handle = await gsaImageFormat.open(source, name);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("no picture");
	return image;
}

describe("Bishop image", () => {
	it("reads the head of a picture and turns away the ones that stand no picture", () => {
		const data = gsaFile({ type: 3, width: 4, height: 2, bits: [] });
		const layout = readGsaLayout(data);
		expect(layout?.type).toBe(3);
		expect(layout?.width).toBe(4);
		expect(layout?.height).toBe(2);
		const wrong = Buffer.from(data);
		wrong[0] = 0x00;
		expect(readGsaLayout(wrong)).toBeUndefined();
		expect(readGsaLayout(data.subarray(0, 0x20))).toBeUndefined();
	});

	it("draws the places of a picture themselves, three of them to a place", async () => {
		// Every block of the picture stands of two places by two, and its planes stand one behind the other.
		const bits = [
			...literal([0x11, 0x12, 0x13, 0x14]),
			...literal([0x21, 0x22, 0x23, 0x24]),
			...literal([0x31, 0x32, 0x33, 0x34]),
		];
		const data = gsaFile({ type: 3, width: 2, height: 2, bits });
		const layout = readGsaLayout(data);
		if (!layout) throw new Error("the head of the fixture stands");
		const picture = unpackGsaPicture(data, layout);
		expect(picture.format).toBe("bgr24");
		// The places of a row stand one behind the other, and the row is held in whole words.
		expect([...picture.pixels]).toEqual([
			0x11, 0x21, 0x31, 0x12, 0x22, 0x32, 0, 0, 0x13, 0x23, 0x33, 0x14, 0x24,
			0x34, 0, 0,
		]);
		// The reference turns the picture about as it hands it over, so the row its own walk draws first is
		// what a reader shows at the bottom of the picture.
		const image = await extract(data);
		expect(image.width).toBe(2);
		expect([...image.pixels]).toEqual([
			0x13, 0x23, 0x33, 0x14, 0x24, 0x34, 0x11, 0x21, 0x31, 0x12, 0x22, 0x32,
		]);
	});

	it("tells a picture of its own by the word it opens with", async () => {
		const good = gsaFile({ type: 3, width: 2, height: 2, bits: [] });
		expect(await gsaImageFormat.detect?.(new BufferByteSource(good))).toBe(
			true,
		);
		const bad = Buffer.from(good);
		bad[1] = 0x00;
		expect(await gsaImageFormat.detect?.(new BufferByteSource(bad))).toBe(
			false,
		);
	});
});
