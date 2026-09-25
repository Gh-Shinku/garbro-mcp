import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { fdImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	fdSignatures,
	readFdLayout,
} from "../../packages/formats/src/mink/fd-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** A picture of this engine: the four words of its head, then the walk of the places of it. */
function fdFile(
	width: number,
	height: number,
	bits: number,
	body: Buffer,
	options: { flag?: number; letter?: number } = {},
): Buffer {
	const head: Buffer = Buffer.alloc(16, 0x00);
	head[0] = 0x46;
	head[1] = options.letter ?? 0x44;
	head[2] = bits;
	head[3] = options.flag ?? 0;
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	return Buffer.concat([head, body]);
}

async function pixelsOf(data: Buffer) {
	const handle = await fdImageFormat.open(new BufferByteSource(data), "cg.fd");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no bitmap");
	return image;
}

describe("Mink compressed bitmap of the second kind", () => {
	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const good = fdFile(2, 2, 24, Buffer.alloc(4, 0x00));
		const layout = readFdLayout(good);
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(2);
		expect(layout?.bitsPerPixel).toBe(24);
		expect(layout?.flag).toBe(0);
		expect(
			readFdLayout(fdFile(1, 1, 32, Buffer.alloc(4), { flag: 1 }))?.flag,
		).toBe(1);
		// The second letter of the head stands of either case.
		expect(
			readFdLayout(fdFile(1, 1, 24, Buffer.alloc(4), { letter: 0x64 })),
		).toBeDefined();
		const wrongLetter = fdFile(1, 1, 24, Buffer.alloc(4));
		wrongLetter[0] = 0x47;
		expect(readFdLayout(wrongLetter)).toBeUndefined();
		const wrongBits = fdFile(1, 1, 24, Buffer.alloc(4));
		wrongBits[2] = 16;
		expect(readFdLayout(wrongBits)).toBeUndefined();
		const wrongFlag = fdFile(1, 1, 24, Buffer.alloc(4));
		wrongFlag[3] = 2;
		expect(readFdLayout(wrongFlag)).toBeUndefined();
		const flat = fdFile(1, 1, 24, Buffer.alloc(4));
		flat.writeUInt16LE(0, 4);
		expect(readFdLayout(flat)).toBeUndefined();
		expect(readFdLayout(good.subarray(0, 15))).toBeUndefined();
		expect(readFdLayout(Buffer.alloc(16, 0x00))).toBeUndefined();
	});

	it("names the three heads the reference registers as its signatures", () => {
		expect(fdSignatures().map((signature) => [...signature.bytes])).toEqual([
			[0x46, 0x64, 0x18, 0x00],
			[0x46, 0x44, 0x18, 0x00],
			[0x46, 0x64, 0x20, 0x00],
		]);
	});

	// The four pictures of two places of a file stand of the four walks of the places of the reference: a
	// place of its own, a place behind the place before it, a run of the places of the picture itself, and a
	// run of them as the difference of the places of the picture. Their walks and the places they hand over
	// stand of an independent walk of the same reference, written apart from the port; the places of the
	// picture stand of the other way up in the bitmap of it.
	it("reads a place of the colours of a picture of the three bytes of it", async () => {
		const image = await pixelsOf(
			fdFile(
				2,
				2,
				24,
				Buffer.from("8a4803c861e6148309e678b876952789a0", "hex"),
			),
		);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([
			0x67, 0x9e, 0x30, 0x00, 0x95, 0x76, 0xb8, 0x00, 0x3c, 0x80, 0xa4, 0x00,
			0x14, 0xe6, 0x61, 0x00,
		]);
	});

	it("reads a place of a picture of the three walks of the places behind it", async () => {
		const image = await pixelsOf(
			fdFile(2, 2, 24, Buffer.from("88dfa161bfdb0ecc682919", "hex")),
		);
		expect([...image.pixels]).toEqual([
			0x8d, 0xf3, 0x99, 0x00, 0x8c, 0xf5, 0x99, 0x00, 0x16, 0xfa, 0x8d, 0x00,
			0x8b, 0xf7, 0x8c, 0x00,
		]);
	});

	it("reads a run of the places of a picture of the places of it", async () => {
		const image = await pixelsOf(
			fdFile(2, 2, 24, Buffer.from("66886bf19e26e2c5619a", "hex")),
		);
		expect([...image.pixels]).toEqual([
			0x9f, 0xee, 0x69, 0x00, 0xff, 0xfe, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00,
			0x9e, 0xf1, 0x6b, 0x00,
		]);
	});

	it("reads a run of the places of a picture as the difference of the places of it", async () => {
		const image = await pixelsOf(
			fdFile(2, 2, 24, Buffer.from("590385a2b7c40e0294bb9005151e", "hex")),
		);
		expect([...image.pixels]).toEqual([
			0xf8, 0xf9, 0xff, 0xff, 0xf1, 0xfb, 0xff, 0xff, 0x00, 0x00, 0x00, 0x00,
			0xff, 0xf7, 0xff, 0xff,
		]);
	});

	it("reads a place of a picture of one place, of the walk of a place of one of them", async () => {
		// The control of this walk stands of `4`, a place read from one of the eighteen places before the
		// place: the place itself, whose three numbers behind the control stand of `r = 2`, `g = 2` and
		// `b = 3`. The two first stand of no change to the place, the last stands of `(1 ^ -1) >> 1`,
		// which is `-1` - a white pixel, worked out by hand rather than by any walk of the tables.
		const image = await pixelsOf(fdFile(1, 1, 24, Buffer.from("a040", "hex")));
		expect([...image.pixels]).toEqual([0xff, 0xff, 0xff, 0xff]);
	});

	it("reads the places of the alpha of a picture of a place of four bytes", async () => {
		const image = await pixelsOf(
			fdFile(1, 1, 32, Buffer.from("540100", "hex")),
		);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([0x00, 0x00, 0x00, 0x01]);
	});

	it("hands over no picture of a walk that stands past the file of it", async () => {
		const short = fdFile(8, 8, 24, Buffer.from("8a48", "hex"));
		await expect(pixelsOf(short)).rejects.toThrow();
	});

	it("tells a picture by the head it opens with", async () => {
		const good = fdFile(1, 1, 24, Buffer.from("a040", "hex"));
		expect(await fdImageFormat.detect?.(new BufferByteSource(good))).toBe(true);
		const wrong = Buffer.from(good);
		wrong[2] = 16;
		// The same picture, whose head names places of a place this engine does not know.
		expect(await fdImageFormat.detect?.(new BufferByteSource(wrong))).toBe(
			false,
		);
	});
});
