import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	WbmPackedReader,
	decodeWbmPicture,
	mergeWbmAlpha,
	readWbmLayout,
	wildbugWbmImageFormat,
} from "../../packages/formats/src/wildbug/wbm-image.js";

const HEADER = 0x10;
const RECORD = 16;
const STORED = 0x80;

interface Section {
	id: number;
	body: Buffer;
	/** How the section says it is stored; the top bit is the one way this port reads. */
	format?: number;
	/** What the section says it unfolds to, which for a packed one is not the length of its bytes. */
	unpackedSize?: number;
	packedSize?: number;
}

/** A file of this engine: the word, the kind, the directory, and the sections' bytes behind it. */
function wpxFile(
	marker: string,
	sections: Section[],
	options: { count?: number; recordSize?: number } = {},
): Buffer {
	const recordSize = options.recordSize ?? RECORD;
	const count = options.count ?? sections.length;
	const directorySize = count * recordSize;
	const head = Buffer.alloc(HEADER, 0x00);
	head.write("WPX\u001a", 0, "latin1");
	head.write(marker, 4, "latin1");
	head[0x0c] = 1;
	head[0x0e] = count;
	head[0x0f] = recordSize;
	let offset = HEADER + directorySize;
	const directory = Buffer.alloc(directorySize, 0x00);
	const bodies: Buffer[] = [];
	sections.forEach((section, index) => {
		const at = index * recordSize;
		directory[at] = section.id;
		directory[at + 1] = section.format ?? STORED;
		directory.writeInt32LE(offset, at + 4);
		directory.writeInt32LE(section.unpackedSize ?? section.body.length, at + 8);
		directory.writeInt32LE(section.packedSize ?? 0, at + 12);
		bodies.push(section.body);
		offset += section.body.length;
	});
	return Buffer.concat([head, directory, ...bodies]);
}

/** The picture's own head: the size, and the depth it is stored in. */
function pictureHead(
	width: number,
	height: number,
	bitsPerPixel: number,
): Buffer {
	const head = Buffer.alloc(0x10, 0x00);
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	head[0x0c] = bitsPerPixel;
	return head;
}

function pixels24(): Buffer {
	return Buffer.from([
		1, 2, 3, 4, 5, 6, 7, 8, 9, 0, 0, 0, 10, 11, 12, 13, 14, 15, 16, 17, 18, 0,
		0, 0,
	]);
}

function pictureFile(sections: Section[]): Buffer {
	return wpxFile("BMP", sections);
}

function base24(extra: Section[] = []): Buffer {
	return pictureFile([
		{ id: 0x10, body: pictureHead(3, 2, 24) },
		{ id: 0x11, body: pixels24() },
		...extra,
	]);
}

async function bitmapOf(file: Buffer): Promise<Buffer> {
	const archive = await wildbugWbmImageFormat.open(
		new BufferByteSource(file),
		"picture.wbm",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("the picture has no entry");
		const chunks: Buffer[] = [];
		for await (const chunk of await archive.openEntry(entry.id)) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks);
	} finally {
		await archive.close();
	}
}

describe("Wild Bug WBM image", () => {
	it("reads a stored picture of twenty four bits", async () => {
		const file = base24();
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.width).toBe(3);
		expect(layout.height).toBe(2);
		expect(layout.bitsPerPixel).toBe(24);
		// The rows are padded to four bytes, so nine bytes of pixels take twelve.
		expect(layout.stride).toBe(12);
		const picture = decodeWbmPicture(file, layout);
		expect(picture.bottomUp).toBe(false);
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.width).toBe(3);
		expect(bitmap.height).toBe(2);
		expect(bitmap.bitsPerPixel).toBe(24);
		expect(bitmap.pixels).toEqual(
			Buffer.from([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
			]),
		);
	});

	it("spreads the alpha channel it finds over the picture", () => {
		const pixels = Buffer.from([
			1, 2, 3, 0xa0, 4, 5, 6, 0xa1, 7, 8, 9, 0xa2, 10, 11, 12, 0xa3,
		]);
		// The alpha channel is one byte a pixel over the rows the picture takes, padded like them.
		const alpha = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);
		const file = pictureFile([
			{ id: 0x10, body: pictureHead(2, 2, 32) },
			{ id: 0x11, body: pixels },
			{ id: 0x13, body: alpha },
		]);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.pixelSize).toBe(4);
		expect(layout.alphaStride).toBe(4);
		const picture = decodeWbmPicture(file, layout);
		// The byte the picture keeps behind its colours is dropped: the alpha channel is the one that counts.
		// The alpha channel is read a row at a time, and its rows are four bytes wide: the second row of
		// this picture therefore begins at the fifth byte of the section.
		expect(mergeWbmAlpha(picture, layout)).toEqual(
			Buffer.from([
				1, 2, 3, 0x11, 4, 5, 6, 0x22, 7, 8, 9, 0x55, 10, 11, 12, 0x66,
			]),
		);
	});

	it("leaves a picture of thirty two bits alone when no alpha channel is there", () => {
		const pixels = Buffer.from([
			1, 2, 3, 0xa0, 4, 5, 6, 0xa1, 7, 8, 9, 0xa2, 10, 11, 12, 0xa3,
		]);
		const file = pictureFile([
			{ id: 0x10, body: pictureHead(2, 2, 32) },
			{ id: 0x11, body: pixels },
		]);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		const picture = decodeWbmPicture(file, layout);
		expect(picture.alpha).toBeUndefined();
		expect(mergeWbmAlpha(picture, layout)).toEqual(pixels);
	});

	it("reads the colours of a picture of eight bits", async () => {
		const palette = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const pixels = Buffer.from([0, 1, 2, 3, 0, 0, 0, 0]);
		const file = pictureFile([
			{ id: 0x10, body: pictureHead(4, 2, 8) },
			{ id: 0x11, body: pixels },
			{ id: 0x12, body: palette },
		]);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.pixelSize).toBe(1);
		expect(layout.stride).toBe(4);
		const picture = decodeWbmPicture(file, layout);
		// A bitmap keeps its colours blue first, the picture keeps them red first.
		expect(picture.palette?.subarray(0, 12)).toEqual(
			Buffer.from([3, 2, 1, 0, 6, 5, 4, 0, 9, 8, 7, 0]),
		);
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.bitsPerPixel).toBe(8);
		expect(bitmap.palette.subarray(1 * 4, 1 * 4 + 3)).toEqual(
			Buffer.from([6, 5, 4]),
		);
		expect(bitmap.pixels).toEqual(pixels);
	});

	it("reads a picture of eight bits without colours as one shade of grey each", async () => {
		const pixels = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
		const file = pictureFile([
			{ id: 0x10, body: pictureHead(4, 2, 8) },
			{ id: 0x11, body: pixels },
		]);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.palette).toBeUndefined();
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.bitsPerPixel).toBe(8);
		expect(bitmap.pixels).toEqual(pixels);
		// The colours climb from nothing to white, which is what the writer here gives a grey picture.
		expect(bitmap.palette.subarray(0, 4)).toEqual(Buffer.from([0, 0, 0, 0]));
	});

	it("reads a stored picture of sixteen bits with the colours a five bit kind takes", async () => {
		const pixels = Buffer.from([
			0x1f, 0x00, 0xe0, 0x03, 0x00, 0x7c, 0xff, 0x7f,
		]);
		const file = pictureFile([
			{ id: 0x10, body: pictureHead(2, 2, 16) },
			{ id: 0x11, body: pixels },
		]);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.pixelSize).toBe(2);
		expect(layout.stride).toBe(4);
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.bitsPerPixel).toBe(16);
		expect(bitmap.masks).toEqual({
			red: 0x7c00,
			green: 0x03e0,
			blue: 0x001f,
		});
	});

	it("refuses a packed section and reads one that says it holds nothing packed", async () => {
		const packed = pictureFile([
			{ id: 0x10, body: pictureHead(3, 2, 24) },
			{ id: 0x11, body: pixels24(), format: 0x04, packedSize: 8 },
		]);
		const layout = readWbmLayout(packed);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		// The refusal names the walk the section's own byte asks for.
		expect(() => decodeWbmPicture(packed, layout)).toThrow(GarbroError);
		expect(() => decodeWbmPicture(packed, layout)).toThrow(/0x04 walk/);
		// A section that declares no packed bytes at all is read as it stands, as the reference does.
		const plain = pictureFile([
			{ id: 0x10, body: pictureHead(3, 2, 24) },
			{ id: 0x11, body: pixels24(), format: 0x01, packedSize: 0 },
		]);
		const plainLayout = readWbmLayout(plain);
		if (!plainLayout) throw new Error("the fixture is not a WBM picture");
		expect(decodeWbmPicture(plain, plainLayout).pixels).toEqual(pixels24());
		expect(readBmpImage(await bitmapOf(plain))?.pixels).toEqual(
			Buffer.from([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
			]),
		);
	});

	it("refuses a picture it cannot read", () => {
		const base = base24();
		expect(readWbmLayout(base)).toBeDefined();
		// The word of a sound of this engine, which the sound's own reader takes.
		const sound = pictureFile([
			{ id: 0x10, body: pictureHead(3, 2, 24) },
			{ id: 0x11, body: pixels24() },
		]);
		sound.write("WAV", 4, "latin1");
		expect(readWbmLayout(sound)).toBeUndefined();
		// A picture with no head of its own, and one whose head is too short to name a size.
		expect(
			readWbmLayout(pictureFile([{ id: 0x11, body: pixels24() }])),
		).toBeUndefined();
		expect(
			readWbmLayout(
				pictureFile([
					{ id: 0x10, body: Buffer.alloc(8, 0x00) },
					{ id: 0x11, body: pixels24() },
				]),
			),
		).toBeUndefined();
		// A depth this engine never writes.
		expect(
			readWbmLayout(
				pictureFile([
					{ id: 0x10, body: pictureHead(3, 2, 12) },
					{ id: 0x11, body: pixels24() },
				]),
			),
		).toBeUndefined();
		// A picture with no pixels.
		expect(
			readWbmLayout(pictureFile([{ id: 0x10, body: pictureHead(3, 2, 24) }])),
		).toBeUndefined();
		// A picture whose pixels reach past the end of the file.
		const past = pictureFile([
			{ id: 0x10, body: pictureHead(3, 2, 24) },
			{ id: 0x11, body: Buffer.alloc(4, 0x00) },
		]);
		const layout = readWbmLayout(past);
		if (!layout) throw new Error("the fixture still names its size");
		expect(() => decodeWbmPicture(past, layout)).toThrow();
	});
});

/**
 * The bit stream a packed walk reads. The walk takes one byte at a time for a literal and bits out of a byte
 * of flags, taking a further byte of flags only once the eight bits it holds are used up. The two are
 * therefore interleaved the way an LZSS stream is: a byte of flags, the literal bytes whose bits it holds,
 * and then the next byte of flags.
 */
class PackedBits {
	#events: { bit?: number; byte?: number }[] = [];

	/** A bit whose own value the walk acts on. */
	bit(value: number): this {
		this.#events.push({ bit: value & 1 });
		return this;
	}

	/** A byte the walk reads as it stands, behind whatever bit made it ask for one. */
	byte(value: number): this {
		this.#events.push({ byte: value });
		return this;
	}

	/** A literal byte, flagged with the bit the walk is looking for. */
	literal(condition: number, value: number): this {
		this.#events.push({ bit: condition & 1, byte: value });
		return this;
	}

	/**
	 * A back reference: the bit that is not the walk's, then the index of the pixel offset in three bits,
	 * and then either the shortest run or a run whose length the walk counts out for itself.
	 */
	backReference(condition: number, index: number, length?: number): this {
		this.#events.push({ bit: 1 - (condition & 1) });
		this.#events.push({ bit: (index >> 2) & 1 });
		this.#events.push({ bit: (index >> 1) & 1 });
		this.#events.push({ bit: index & 1 });
		if (undefined === length) {
			this.#events.push({ bit: 1 });
			return this;
		}
		this.#events.push({ bit: 0 });
		// `ReadCount` counts out the run itself: a run of clear bits says how many bits follow.
		const count = length;
		let steps = 1;
		while (2 ** steps <= count) steps += 1;
		const tail = count - 2 ** steps;
		for (let at = 0; at < steps - 1; at += 1) this.#events.push({ bit: 0 });
		this.#events.push({ bit: 1 });
		for (let at = steps - 1; at >= 0; at -= 1) {
			this.#events.push({ bit: (tail >> at) & 1 });
		}
		return this;
	}

	/**
	 * The bytes as the walk reads them: a byte of flags holds eight bits, and every byte the walk asks for
	 * while those bits are the ones in hand stands behind that byte of flags, in the order it was asked for.
	 */
	toBuffer(): Buffer {
		const out: number[] = [];
		let flags = 0;
		let held = 0;
		let pending: number[] = [];
		const flush = (): void => {
			out.push(flags, ...pending);
			flags = 0;
			held = 0;
			pending = [];
		};
		for (const event of this.#events) {
			// A bit is taken from the byte of flags in hand, which is written before the bytes it asks for.
			if (undefined !== event.bit) {
				if (8 === held) flush();
				if (event.bit) flags |= 0x80 >> held;
				held += 1;
			}
			if (undefined !== event.byte) pending.push(event.byte);
		}
		if (held > 0 || pending.length > 0) flush();
		return Buffer.from(out);
	}
}

/** A packed picture: the pixels' section says how its bytes are packed. */
function packedFile(
	width: number,
	height: number,
	bitsPerPixel: number,
	body: Buffer,
	format: number,
): Buffer {
	const pixelSize = bitsPerPixel >> 3;
	const stride = (width * pixelSize + 3) & ~3;
	return pictureFile([
		{ id: 0x10, body: pictureHead(width, height, bitsPerPixel) },
		// The section says how large the picture it unfolds to is, which is not the length of its bytes.
		{
			id: 0x11,
			body,
			format,
			unpackedSize: stride * height,
			packedSize: body.length,
		},
	]);
}

describe("Wild Bug WBM packed walk", () => {
	it("reads a packed picture whose bytes are all literals", () => {
		// Three pixels of three bytes, less the one the walk copies as it stands.
		const first = Buffer.from([1, 2, 3]);
		// The picture is eight bytes to a row over four rows, so twenty nine bytes follow the first pixel.
		const rest = Buffer.from(
			Array.from({ length: 29 }, (_, index) => 4 + index),
		);
		const bits = new PackedBits();
		for (const value of rest) bits.literal(1, value);
		const body = Buffer.concat([first, Buffer.alloc(1, 0x00), bits.toBuffer()]);
		// The first pixel stands whole in the section, padded to four bytes, and the flags begin behind it.
		expect(body.subarray(0, 4)).toEqual(Buffer.from([1, 2, 3, 0x00]));
		expect(body[4]).toBe(0xff);
		expect(body[5]).toBe(4);
		const file = packedFile(2, 4, 24, body, 0x00);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.stride).toBe(8);
		const picture = decodeWbmPicture(file, layout);
		// The rows are two pixels wide, so the last of the literals fills the picture and the rest is
		// padded away.
		expect(picture.pixels.subarray(0, 8)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
		);
		expect(picture.pixels.subarray(8, 16)).toEqual(
			Buffer.from([9, 10, 11, 12, 13, 14, 15, 16]),
		);
	});

	it("reads a packed picture with a back reference", () => {
		const first = Buffer.from([1, 2, 3]);
		const bits = new PackedBits();
		// Enough literals to reach the offset the first index names, then a copy of the first byte.
		for (let index = 0; index < 12; index += 1) bits.literal(1, 0x40 + index);
		bits.backReference(1, 0);
		const body = Buffer.concat([first, Buffer.alloc(1, 0x00), bits.toBuffer()]);
		const file = packedFile(5, 1, 24, body, 0x00);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.stride).toBe(16);
		const picture = decodeWbmPicture(file, layout);
		// The first index of the later table names three bytes on a row of sixteen, so the copy at the last
		// byte of the picture takes the byte three behind it, which is the tenth literal.
		expect(picture.pixels[15]).toBe(0x40 + 9);
		expect(picture.pixels[15]).toBe(picture.pixels[12]);
	});

	it("reads a picture of the 0x01 way whose bytes are all literals", () => {
		const first = Buffer.from([7, 8, 9]);
		// A row of four pixels is twelve bytes with nothing to pad, so nine bytes follow the first.
		const rest = Buffer.from(
			Array.from({ length: 9 }, (_, index) => 1 + index),
		);
		const bits = new PackedBits();
		for (const value of rest) bits.literal(1, value);
		const body = Buffer.concat([first, Buffer.alloc(1, 0x00), bits.toBuffer()]);
		const file = packedFile(4, 1, 24, body, 0x01);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.stride).toBe(12);
		const picture = decodeWbmPicture(file, layout);
		expect(picture.pixels.subarray(0, 12)).toEqual(
			Buffer.from([7, 8, 9, 1, 2, 3, 4, 5, 6, 7, 8, 9]),
		);
	});

	it("reads a back reference of the first attempt's byte form", () => {
		const first = Buffer.from([0x11, 0x22, 0x33]);
		const bits = new PackedBits();
		// The bit that is not the walk's ends the literals; then the two bits that name the first attempt's
		// byte form, the distance itself, and a set bit that leaves the run at its shortest.
		bits.bit(0);
		bits.bit(1);
		bits.bit(1);
		bits.byte(0);
		bits.bit(1);
		for (const value of [4, 5, 6, 7, 8, 9, 10]) bits.literal(1, value);
		const body = Buffer.concat([first, Buffer.alloc(1, 0x00), bits.toBuffer()]);
		const file = packedFile(4, 1, 24, body, 0x01);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.stride).toBe(12);
		const picture = decodeWbmPicture(file, layout);
		// A distance of nothing names the byte just before the place written to, so the run copies that
		// byte and then itself, twice over.
		expect(picture.pixels.subarray(0, 12)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x33, 0x33, 4, 5, 6, 7, 8, 9, 10]),
		);
	});

	it("reads a picture of the 0x02 way through the table of codes it carries", () => {
		const first = Buffer.from([0x51, 0x52, 0x53]);
		// A row of four pixels is twelve bytes with nothing to pad, so nine bytes follow the first.
		// The table gives the first four symbols a code of two bits each, and their codes are 0, 1, 2, 3 -
		// one byte of bits, its lowest two bits last.
		// Two symbols to a byte, and the lower nibble is the earlier one, so a length of two for the first
		// four symbols is 0x22 twice over.
		const lengths = Buffer.alloc(0x80, 0x00);
		lengths[0] = 0x22;
		lengths[1] = 0x22;
		const codes = Buffer.from([0x1b]);
		const bits = new PackedBits();
		for (const value of [0, 1, 2, 3, 0, 1, 2, 3, 0]) {
			// A literal is flagged, and then the two bits of its code.
			bits.bit(1);
			bits.bit((value >> 1) & 1);
			bits.bit(value & 1);
		}
		const body = Buffer.concat([
			first,
			Buffer.alloc(1, 0x00),
			lengths,
			codes,
			bits.toBuffer(),
		]);
		const file = packedFile(4, 1, 24, body, 0x02);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.stride).toBe(12);
		const picture = decodeWbmPicture(file, layout);
		expect(picture.pixels.subarray(0, 12)).toEqual(
			Buffer.from([0x51, 0x52, 0x53, 0, 1, 2, 3, 0, 1, 2, 3, 0]),
		);
	});

	it("reads a picture of the 0x03 way through its table and a counted run", () => {
		const first = Buffer.from([0x61, 0x62, 0x63]);
		// The first four symbols take a two bit code each, and their codes are 0, 1, 2, 3.
		const lengths = Buffer.alloc(0x80, 0x00);
		lengths[0] = 0x22;
		lengths[1] = 0x22;
		const codes = Buffer.from([0x1b]);
		const bits = new PackedBits();
		// A literal of this way is a flag and the bits of its code, and no byte of its own: the symbol the
		// code stands for is the byte the walk writes.
		const literal = (value: number): void => {
			bits.bit(1);
			bits.bit((value >> 1) & 1);
			bits.bit(value & 1);
		};
		for (const value of [0, 1, 2, 3]) literal(value);
		// The bit that is not the walk's ends the literals; the two bits that follow name the first
		// attempt's byte form; a distance of nothing names the byte before the place written to; a clear bit
		// adds a counted run to the run of two that form already stands for, and the run itself is one.
		bits.bit(0);
		bits.bit(1);
		bits.bit(1);
		bits.byte(0);
		bits.bit(0);
		bits.bit(1);
		bits.bit(0);
		// The two bytes the picture still has room for.
		literal(2);
		literal(3);
		const body = Buffer.concat([
			first,
			Buffer.alloc(1, 0x00),
			lengths,
			codes,
			bits.toBuffer(),
		]);
		const file = packedFile(4, 1, 24, body, 0x03);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.stride).toBe(12);
		const picture = decodeWbmPicture(file, layout);
		// Four literals follow the first pixel, and then a run of three copies the byte before the place
		// written to - the last literal - and then itself, twice over. Two more literals fill the row.
		expect(picture.pixels.subarray(0, 12)).toEqual(
			Buffer.from([0x61, 0x62, 0x63, 0, 1, 2, 3, 3, 3, 3, 2, 3]),
		);
	});

	it("tries its other tables and its other bit when a walk finds nothing", () => {
		// A stream of nothing but clear bits: the first two attempts read them as back references and run
		// out of bytes, and only the third attempt, whose own bit is a clear one, reads them as literals.
		const first = Buffer.from([9, 9, 9]);
		// Twelve bytes to a row over two rows, so twenty one bytes follow the first pixel.
		const rest = Buffer.from(
			Array.from({ length: 21 }, (_, index) => 1 + index),
		);
		const bits = new PackedBits();
		for (const value of rest) bits.literal(0, value);
		const body = Buffer.concat([first, Buffer.alloc(1, 0x00), bits.toBuffer()]);
		const file = packedFile(3, 2, 24, body, 0x00);
		const layout = readWbmLayout(file);
		if (!layout) throw new Error("the fixture is not a WBM picture");
		expect(layout.stride).toBe(12);
		const picture = decodeWbmPicture(file, layout);
		expect(picture.pixels.subarray(0, 9)).toEqual(
			Buffer.from([9, 9, 9, 1, 2, 3, 4, 5, 6]),
		);
	});
});

describe("Wild Bug WBM packed reader", () => {
	it("hands its flags and its literal bytes out the way the walk reads them", () => {
		const bits = new PackedBits();
		bits.literal(1, 4);
		bits.literal(1, 5);
		bits.literal(1, 6);
		const body = Buffer.concat([Buffer.from([1, 2, 3, 0x00]), bits.toBuffer()]);
		// Three set bits in one byte of flags, and then the three bytes they stand for.
		expect(body).toEqual(Buffer.from([1, 2, 3, 0x00, 0xe0, 4, 5, 6]));
		const reader = new WbmPackedReader(body, body.length, 32);
		expect(reader.begin()).toBe(body.length);
		reader.copyFromBuffer(reader.output, 0, 3);
		expect(reader.output.subarray(0, 3)).toEqual(Buffer.from([1, 2, 3]));
		reader.beginBitsAt(4);
		// A set bit is a literal, and the literal byte follows behind the flags.
		expect(reader.nextBit()).toBe(1);
		expect(reader.readNext()).toBe(4);
		expect(reader.nextBit()).toBe(1);
		expect(reader.readNext()).toBe(5);
		expect(reader.nextBit()).toBe(1);
		expect(reader.readNext()).toBe(6);
		// The fourth bit is clear, and the walk would read a back reference from here on.
		expect(reader.nextBit()).toBe(0);
	});
});
