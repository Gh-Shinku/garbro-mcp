import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	aypioPdtBmpImageFormat,
	decodePdtBmp,
	readPdtBmpLayout,
	unpackPdtBits,
} from "../../packages/formats/src/aypio/pdt-bmp-image.js";
import { writeBmp32 } from "../../packages/formats/src/shared/bmp.js";

/**
 * A walk of bits, written the way the reader takes them: every word of four bytes stands in the file from its
 * last byte towards its first, every byte from its highest place, and the writer of the walk hangs on to the
 * place it takes a byte at.
 */
function bits(spec: string): Buffer {
	const words = Math.max(1, Math.ceil(spec.length / 32));
	const out = Buffer.alloc(words * 4, 0x00);
	for (let at = 0; at < spec.length; at += 1) {
		if ("1" !== spec[at]) continue;
		const word = Math.floor(at / 32);
		const within = at % 32;
		const byte = 3 - (within >> 3);
		const place = 7 - (within & 7);
		out[word * 4 + byte] = (out[word * 4 + byte] ?? 0) | (1 << place);
	}
	return out;
}

/** A picture of the container: its head, its name, the walk of its places and the bytes the walk reads. */
function picture(input: {
	walk: Buffer;
	data: Buffer;
	size: number;
	name: string;
}): Buffer {
	const nameArea = Buffer.alloc(input.name.length + 1, 0x00);
	nameArea.write(input.name, 0, "latin1");
	const head = Buffer.alloc(0x18, 0x00);
	head.write("PDT\x00", 0, "latin1");
	head.writeInt32LE(0x118, 4);
	head.writeInt32LE(input.size, 0x08);
	const bitsOffset = 0x18 + nameArea.length;
	const dataOffset = bitsOffset + input.walk.length;
	head.writeInt32LE(dataOffset, 0x10);
	head.writeInt32LE(bitsOffset, 0x14);
	const body = Buffer.concat([head, nameArea, input.walk, input.data]);
	body.writeInt32LE(body.length, 0x0c);
	return body;
}

/** A bitmap of two places of width and two of height, four bytes a place. */
function bitmap(color: (x: number, y: number) => number[]): Buffer {
	const pixels = Buffer.alloc(2 * 2 * 4, 0x00);
	for (let y = 0; y < 2; y += 1) {
		for (let x = 0; x < 2; x += 1) {
			const entry = color(x, y);
			const at = (y * 2 + x) * 4;
			pixels[at] = entry[0] ?? 0;
			pixels[at + 1] = entry[1] ?? 0;
			pixels[at + 2] = entry[2] ?? 0;
			pixels[at + 3] = entry[3] ?? 0;
		}
	}
	return writeBmp32(2, 2, pixels);
}

/** A picture of a bitmap that stands as it is: every byte of it stands for itself in the walk. */
function pictureOf(input: { bmp: Buffer; name: string }): Buffer {
	return picture({
		walk: bits("0".repeat(input.bmp.length)),
		data: input.bmp,
		size: input.bmp.length,
		name: input.name,
	});
}

describe("UK2 engine compressed bitmap", () => {
	it("walks the ways of the walk of a picture", () => {
		// A byte behind no place stands for itself.
		expect(
			unpackPdtBits(Buffer.from("ABC"), 0, bits("000"), 3).toString("latin1"),
		).toBe("ABC");
		// A copy of two bytes from two bytes behind the place at hand.
		expect(
			unpackPdtBits(Buffer.from("AB"), 0, bits("0010100100"), 4).toString(
				"latin1",
			),
		).toBe("ABAB");
		// The byte before the place at hand, again.
		expect(
			unpackPdtBits(Buffer.from("A"), 0, bits("01110"), 2).toString("latin1"),
		).toBe("AA");
		// A run of copies of the byte before the place at hand: two of them, one place behind the other.
		expect(
			unpackPdtBits(Buffer.from("AB"), 0, bits("001100100"), 4).toString(
				"latin1",
			),
		).toBe("ABBB");
	});

	it("reads the head of a bitmap", () => {
		const bmp = bitmap((x, y) => [0x10 + x, 0x20 + y, 0x30, 0xff]);
		const data = pictureOf({ bmp, name: "places" });
		expect(readPdtBmpLayout(data, data.length)).toMatchObject({
			colour: { name: "places" },
		});
		// The word of the container and its own word have to stand there.
		const other = Buffer.from(data);
		other.write("PDX\x00", 0, "latin1");
		expect(readPdtBmpLayout(other)).toBeUndefined();
		const root = Buffer.from(data);
		root.writeInt32LE(0x119, 4);
		expect(readPdtBmpLayout(root)).toBeUndefined();
	});

	it("reads the shape of the places behind the picture", () => {
		const colour = bitmap((x, y) => [0x10 + x, 0x20 + y, 0x30, 0x00]);
		const shape = bitmap(() => [0x40, 0x40, 0x40, 0x00]);
		const data = Buffer.concat([
			pictureOf({ bmp: colour, name: "places" }),
			pictureOf({ bmp: shape, name: "shapes" }),
		]);
		const layout = readPdtBmpLayout(data, data.length);
		if (!layout) throw new Error("no layout");
		expect(layout.colour.name).toBe("places");
		expect(layout.alpha?.name).toBe("shapes");
		const out = decodePdtBmp(layout);
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe(
			hex([0x10, 0x20, 0x30, 0x40, 0x11, 0x20, 0x30, 0x40]),
		);
		expect(out.subarray(0x3e, 0x46).toString("hex")).toBe(
			hex([0x10, 0x21, 0x30, 0x40, 0x11, 0x21, 0x30, 0x40]),
		);
	});

	it("hands a picture out as a bitmap of four byte places", async () => {
		const bmp = bitmap((x, y) => [0x10 + x, 0x20 + y, 0x30, 0xff]);
		const data = pictureOf({ bmp, name: "places" });
		const handle = await aypioPdtBmpImageFormat.open(
			new BufferByteSource(data),
			"picture.pdt",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry).toMatchObject({
			path: "picture.bmp",
			metadata: { type: "image", width: 2, height: 2, bitsPerPixel: 32 },
		});
		const out = await consumeBuffer(await handle.openEntry(entry.id));
		expect(out.readUInt32LE(0x12)).toBe(2);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe(
			hex([0x10, 0x20, 0x30, 0xff, 0x11, 0x20, 0x30, 0xff]),
		);
	});

	it("declines a file that does not hold a bitmap", async () => {
		const other = pictureOf({
			bmp: bitmap(() => [0, 0, 0, 0]),
			name: "places",
		});
		other.write("PDX\x00", 0, "latin1");
		await expect(
			aypioPdtBmpImageFormat.open(new BufferByteSource(other), "picture.pdt"),
		).rejects.toThrow(GarbroError);
		await expect(
			aypioPdtBmpImageFormat.open(new BufferByteSource(other), "picture.pdt"),
		).rejects.toThrow("Not a UK2 engine bitmap");
	});

	it("stops where the walk of a picture runs out", () => {
		// The walk stands in one word of four bytes and the word behind it stands as nought: seventy places
		// stand beyond the words there are.
		expect(() =>
			unpackPdtBits(Buffer.alloc(70, 0x41), 0, bits("0".repeat(32)), 70),
		).toThrow("UK2 bitmap is cut short of its walk");
		// A picture whose bytes behind the walk do not stand in the file is cut short as well.
		expect(() =>
			unpackPdtBits(Buffer.alloc(2, 0x41), 0, bits("000"), 3),
		).toThrow("UK2 bitmap is cut short of its places");
	});
});

/** The bytes of a bitmap, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
