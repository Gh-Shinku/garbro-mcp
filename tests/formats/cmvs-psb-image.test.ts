import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	cmvsPsbImageFormat,
	readPsbLayout,
	unpackPsbPicture,
} from "../../packages/formats/src/cmvs/psb-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEADER = 0x14;
const TAIL = 0x13;

/**
 * The walk of this engine, written the other way round: a control byte whose bits are read from its highest
 * down, where a clear bit stands for a byte that stands as it is and a set one for a copy. Every byte here
 * is written as it stands, so every bit is clear.
 */
function literalWalk(bytes: number[]): Buffer {
	const out: number[] = [];
	for (let at = 0; at < bytes.length; at += 8) {
		out.push(0x00, ...bytes.slice(at, at + 8));
	}
	return Buffer.from(out);
}

interface PsbFixture {
	width: number;
	height: number;
	bitsPerPixel: number;
	method: number;
	tableOffset: number;
	dataOffset: number;
	/** The bytes the fields behind the engine's word are stored as, before they are keyed. */
	body: Buffer;
	/** The file's last nineteen bytes, which key the head. */
	tail?: Buffer;
}

/** A picture of this engine: the word, the keyed head, the tables and their bodies, and a tail. */
function psbFile(options: PsbFixture): Buffer {
	const tail = options.tail ?? Buffer.alloc(TAIL, 0x00);
	const header = Buffer.alloc(HEADER, 0x00);
	header.write("PSBP", 0, "latin1");
	header.writeInt32LE(options.tableOffset, 4);
	header.writeInt32LE(options.dataOffset, 8);
	header.writeInt16LE(options.method, 0x0c);
	header.writeUInt16LE(options.width, 0x0e);
	header.writeUInt16LE(options.height, 0x10);
	header.writeUInt16LE(options.bitsPerPixel, 0x12);
	// The engine keys the fields behind its word with the tail: exclusive-or first, then subtract. To store
	// a field so that it comes back as it was, the tail byte is added before the exclusive-or.
	for (let at = 4; at < HEADER; at += 1) {
		const plain = (header[at] ?? 0) + (tail[at - 4] ?? 0);
		header[at] = (plain ^ (tail[TAIL - 3 + (at & 1)] ?? 0)) & 0xff;
	}
	return Buffer.concat([header, options.body, tail]);
}

/** A table of channels: the sizes in a row, and the bodies behind them. */
function table(bodies: Buffer[]): Buffer {
	const sizes = Buffer.alloc(4 * bodies.length, 0x00);
	for (const [index, body] of bodies.entries()) {
		sizes.writeInt32LE(body.length, 4 * index);
	}
	return Buffer.concat([sizes, ...bodies]);
}

describe("PVNS engine PSB image", () => {
	it("reads the head back through the key the file's own tail holds", () => {
		const tail = Buffer.alloc(TAIL, 0x00);
		for (let at = 0; at < TAIL; at += 1) tail[at] = (0x11 + at * 7) & 0xff;
		const file = psbFile({
			width: 320,
			height: 240,
			bitsPerPixel: 24,
			method: 2,
			tableOffset: HEADER,
			dataOffset: HEADER,
			body: Buffer.alloc(4, 0x00),
			tail,
		});
		const layout = readPsbLayout(file);
		if (!layout) throw new Error("the fixture is not a PSB picture");
		expect(layout.width).toBe(320);
		expect(layout.height).toBe(240);
		expect(layout.bitsPerPixel).toBe(24);
		expect(layout.method).toBe(2);
		expect(layout.channels).toBe(3);
		// The head cannot be read without the tail: with it zeroed the fields come out as nothing at all.
		const bare = Buffer.from(file);
		Buffer.alloc(TAIL, 0x00).copy(bare, bare.length - TAIL);
		expect(readPsbLayout(bare)).toBeUndefined();
	});

	it("adds a picture of the second method up channel by channel", () => {
		// Four pixels of three channels, each channel a plane of differences: the first pixel's differences
		// are its own colours, and the rest are the steps from the pixel before.
		const differences = [
			[10, 1, 2, 3],
			[20, 5, 0, 255],
			[30, 7, 8, 9],
		];
		// The first table holds the streams a channel's walk reads its control bits from, and the second the
		// bytes it reads as they stand; the sizes of each stand in front of its own bodies.
		const body = Buffer.concat([
			table(differences.map(() => Buffer.from([0x00]))),
			table(differences.map((plane) => Buffer.from(plane))),
		]);
		const file = psbFile({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			method: 2,
			tableOffset: HEADER,
			dataOffset: HEADER,
			body,
		});
		const layout = readPsbLayout(file);
		if (!layout) throw new Error("the fixture is not a PSB picture");
		const pixels = unpackPsbPicture(file, layout);
		expect([...pixels]).toEqual([
			10, 20, 30, 11, 25, 37, 13, 25, 45, 16, 24, 54,
		]);
	});

	it("fills the blocks a picture of the third method names", async () => {
		// A picture of two by two, which is one block: the block's flag is set, so the whole block takes one
		// byte of its own.
		const records = [0, 1, 2].map((channel) => {
			const flags = Buffer.from([0x80]);
			const fills = Buffer.from([0x40 + channel]);
			const plane = literalWalk([1, 2, 3, 4]);
			return Buffer.concat([
				Buffer.from([flags.length, 0, 0, 0, fills.length, 0, 0, 0, 4, 0, 0, 0]),
				flags,
				fills,
				plane,
			]);
		});
		const file = psbFile({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			method: 3,
			tableOffset: HEADER,
			dataOffset: HEADER,
			body: Buffer.concat([table(records), table(records)]),
		});
		const layout = readPsbLayout(file);
		if (!layout) throw new Error("the fixture is not a PSB picture");
		const pixels = unpackPsbPicture(file, layout);
		expect([...pixels]).toEqual([
			0x40, 0x41, 0x42, 0x40, 0x41, 0x42, 0x40, 0x41, 0x42, 0x40, 0x41, 0x42,
		]);
		const bitmap = readBmpImage(
			Buffer.concat(
				await (async () => {
					const archive = await cmvsPsbImageFormat.open(
						new BufferByteSource(file),
						"picture.psb",
					);
					try {
						const entry = archive.entries[0];
						if (!entry) throw new Error("the picture has no entry");
						const chunks: Buffer[] = [];
						for await (const chunk of await archive.openEntry(entry.id)) {
							chunks.push(Buffer.from(chunk as Uint8Array));
						}
						return chunks;
					} finally {
						await archive.close();
					}
				})(),
			),
		);
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.bitsPerPixel).toBe(24);
		expect(bitmap.pixels).toEqual(pixels);
	});

	it("refuses a picture it cannot read", () => {
		const base = psbFile({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			method: 2,
			tableOffset: HEADER,
			dataOffset: HEADER,
			body: Buffer.alloc(4, 0x00),
		});
		expect(readPsbLayout(base)).toBeDefined();
		// Another word, no width, and a depth this engine never writes.
		expect(
			readPsbLayout(Buffer.concat([Buffer.from("PSBR"), base.subarray(4)])),
		).toBeUndefined();
		const noWidth = psbFile({
			width: 0,
			height: 2,
			bitsPerPixel: 24,
			method: 2,
			tableOffset: HEADER,
			dataOffset: HEADER,
			body: Buffer.alloc(4, 0x00),
		});
		expect(readPsbLayout(noWidth)).toBeUndefined();
		const wrongDepth = psbFile({
			width: 2,
			height: 2,
			bitsPerPixel: 16,
			method: 2,
			tableOffset: HEADER,
			dataOffset: HEADER,
			body: Buffer.alloc(4, 0x00),
		});
		expect(readPsbLayout(wrongDepth)).toBeUndefined();
		// A method the reference does not name, and a table that reaches past the file.
		const other = psbFile({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			method: 7,
			tableOffset: HEADER,
			dataOffset: HEADER,
			body: Buffer.alloc(4, 0x00),
		});
		const layout = readPsbLayout(other);
		if (!layout) throw new Error("the fixture still names its size");
		expect(() => unpackPsbPicture(other, layout)).toThrow(GarbroError);
		expect(() => unpackPsbPicture(other, layout)).toThrow(/method 7/);
		const cut = psbFile({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			method: 2,
			tableOffset: 0x1000,
			dataOffset: 0x1000,
			body: Buffer.alloc(4, 0x00),
		});
		const cutLayout = readPsbLayout(cut);
		if (!cutLayout) throw new Error("the fixture still names its size");
		expect(() => unpackPsbPicture(cut, cutLayout)).toThrow();
		expect(readPsbLayout(base.subarray(0, 8))).toBeUndefined();
	});
});
