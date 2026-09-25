// The walk of the places of a Paprika NP picture, against a fixture written the way the format reads it:
// every token of the walk is a prefix of four places of the stream and then the code of the pair that
// prefix names, so a picture of known places is written out of the tables the reference carries itself.
// The places the walk has to turn out are known from the tokens, and the ring a run reaches back into
// starts with the places of the picture, so the copy a run makes is a value the fixture asks for.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { crc32 } from "@garbro-mcp/codecs";
import { BufferByteSource } from "@garbro-mcp/core";
import { paprikaNpImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	readNpLayout,
	unpackNpPicture,
} from "../../packages/formats/src/paprika/np-image.js";
import {
	NP_BIT_MAP,
	NP_RUN_COUNTS,
	NP_RUN_PLACES,
	NP_WORD_LIST,
} from "../../packages/formats/src/paprika/np-tables.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** A bit writer of the stream the reader of the reference takes: most significant bit first. */
class BitWriter {
	readonly bits: number[] = [];

	put(value: number, width: number): void {
		for (let i = width - 1; i >= 0; i -= 1) this.bits.push((value >> i) & 1);
	}

	bytes(): Buffer {
		const out = Buffer.alloc(Math.ceil(this.bits.length / 8), 0);
		for (const [index, bit] of this.bits.entries()) {
			if (0 === bit) continue;
			const at = index >> 3;
			out[at] = (out[at] ?? 0) | (0x80 >> (index & 7));
		}
		return out;
	}
}

/** The pair of `bitMap` and the place within it that name a word of `wordList`. */
function wordIndex(value: number): {
	pair: number;
	code: number;
	width: number;
} {
	for (let pair = 0; pair < 16; pair += 1) {
		const width = NP_BIT_MAP[2 * pair] ?? 0;
		const base = NP_BIT_MAP[2 * pair + 1] ?? 0;
		for (let code = 0; code < 1 << width; code += 1) {
			if (NP_WORD_LIST[base + code] === value) return { pair, code, width };
		}
	}
	throw new Error(`the word ${value.toString(16)} stands in no pair`);
}

/** The prefix and the code of a word of the list. */
function word(writer: BitWriter, value: number): void {
	const found = wordIndex(value);
	writer.put(found.pair, 4);
	writer.put(found.code, found.width);
}

/** The place of a run: three places name a pair of the table, then the two halves of the distance. */
function runPlace(
	writer: BitWriter,
	place: number,
	high: number,
	low: number,
): void {
	writer.put(place, 3);
	const width = (NP_RUN_PLACES[2 * place] ?? 0) + 9;
	if (width > 8) writer.put(high, 8);
	writer.put(low, width > 8 ? width - 8 : width);
}

/** The three hundred and twelve places of the fixture, then a short run and a long one. */
function npFixtureStream(): Buffer {
	const writer = new BitWriter();
	for (let i = 0; i < 512; i += 1) {
		word(writer, [0x41, 0x42, 0x43][i % 3] ?? 0x41);
	}
	// A run of four places, five hundred and twelve places back: the start of the ring, the places of
	// the picture itself.
	word(writer, 0x100);
	runPlace(writer, 1, 0, 0);
	// A run of twelve places, ten hundred and twenty four places back, which is before the ring's
	// start and therefore reaches places that were never written.
	word(writer, 264);
	writer.put(0, NP_RUN_COUNTS[0] ?? 0);
	runPlace(writer, 2, 0, 0);
	word(writer, 273);
	return writer.bytes();
}

/** The token that rebuilds the codes of the two tables, and the counts of its sixteen pairs. */
function resetToken(writer: BitWriter, counts: readonly number[]): void {
	word(writer, 272);
	for (const count of counts) {
		writer.put(0, count);
		writer.put(1, 1);
	}
}

/** A token of a pair the reset has rebuilt: a prefix of four places and then the code of the pair. */
function pairCode(
	writer: BitWriter,
	pair: number,
	code: number,
	width: number,
): void {
	writer.put(pair, 4);
	writer.put(code, width);
}

/**
 * The stream of a picture whose walk rebuilds its tables: two places of their own, then the token 272
 * with the first of its sixteen counts at eight places and the rest of them at none, and then two places
 * of the list the sorts have rebuilt - which stand at the places nineteen and twenty of it, the places
 * 0xFF and 0xFE of a picture.
 */
function npResetFixtureStream(): Buffer {
	const writer = new BitWriter();
	word(writer, 0x41);
	word(writer, 0x42);
	resetToken(writer, [8, ...new Array(15).fill(0)]);
	// Thirty places of the list the sorts have rebuilt, of the two places nineteen and twenty of it.
	for (let i = 0; i < 30; i += 1) {
		pairCode(writer, 0, 0 === i % 2 ? 19 : 20, 8);
	}
	word(writer, 273);
	return writer.bytes();
}

/** `NpFormat.ReadMetaData`: the mark, a count of the frames and the head of the walk. */
function buildNp(spec: {
	stream: Buffer;
	width?: number;
	height?: number;
	count?: number;
	places?: number;
}): Buffer {
	const head = Buffer.alloc(0x10, 0);
	head.write("NP", 0, "latin1");
	head[2] = 0x01;
	head[3] = 0x00;
	head.writeUInt16LE(spec.count ?? 1, 2);
	head.writeUInt32LE(spec.width ?? 16, 4);
	head.writeUInt32LE(spec.height ?? 11, 8);
	head.writeUInt32LE(0x10, 12);
	const walk = Buffer.alloc(8, 0);
	walk.writeInt32LE(spec.places ?? 0x1c + 560, 0);
	walk.writeInt32LE(spec.stream.length, 4);
	return Buffer.concat([head, walk, spec.stream]);
}

const PATTERN = (() => {
	const places = Buffer.alloc(512, 0);
	for (let i = 0; i < places.length; i += 1) {
		places[i] = [0x41, 0x42, 0x43][i % 3] ?? 0x41;
	}
	return places;
})();

/** The places of the picture the fixture asks for, behind the twenty eight of the walk's head. */
const PIXELS = (() => {
	const pixels = Buffer.alloc(560, 0);
	PATTERN.copy(pixels, 0, 0x1c);
	// The run of four places that reaches the start of the ring.
	pixels.write("ABCA", 512 - 0x1c, "latin1");
	return pixels;
})();

describe("Paprika NP picture", () => {
	it("reads the head of the picture", () => {
		const layout = readNpLayout(buildNp({ stream: npFixtureStream() }));
		expect(layout?.frameCount).toBe(1);
		expect(layout?.width).toBe(16);
		expect(layout?.height).toBe(11);
		expect(layout?.dataOffset).toBe(0x10);
	});

	it("walks the places of the picture", () => {
		const file = buildNp({ stream: npFixtureStream() });
		const layout = readNpLayout(file);
		if (!layout) throw new Error("no layout");
		const pixels = unpackNpPicture(file, layout);
		expect(pixels.length).toBe(560);
		expect(crc32(pixels) >>> 0).toBe(3692781184);
		expect(pixels).toEqual(PIXELS);
		// The places the picture itself holds stand in the ring as well, so the run of four places five
		// hundred and twelve back turns the start of them over.
		expect(pixels.subarray(512 - 0x1c, 512 - 0x1c + 4).toString("latin1")).toBe(
			"ABCA",
		);
		// The walk moves four places on behind a run, and those places stand at nothing.
		expect(pixels.subarray(516 - 0x1c, 516 - 0x1c + 4)).toEqual(
			Buffer.alloc(4, 0),
		);
		expect(pixels[520 - 0x1c]).toBe(0);
	});

	it("rebuilds the codes of its tables when the stream asks it to", () => {
		// The two sorts of the reference halve every count they take and leave the words of the list in
		// the order they find, which no fixture can ask for in the words of the format alone: the places
		// below are what the sorts of the reference leave at the places nineteen and twenty.
		const stream = npResetFixtureStream();
		expect(stream.subarray(0, 10).toString("hex")).toBe("6e6ffe007fff80980a00");
		expect(crc32(stream) >>> 0).toBe(2182526574);
		const file = buildNp({ stream, places: 0x1c + 16 });
		const layout = readNpLayout(file);
		if (!layout) throw new Error("no layout");
		const pixels = unpackNpPicture(file, layout);
		// The two places of the picture itself stand in front of the head the walk keeps, so the places
		// of this picture are the places the rebuilt codes ask for.
		expect(crc32(pixels) >>> 0).toBe(2610101650);
		expect([...pixels]).toEqual([
			0xff,
			0xfe,
			0xff,
			0xfe,
			...(new Array(12).fill(0) as number[]),
		]);
	});

	it("reads the picture through the format", async () => {
		const handle = await paprikaNpImageFormat.open(
			new BufferByteSource(buildNp({ stream: npFixtureStream() })),
			"sample.np",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.readInt32LE(18)).toBe(16);
		expect(bmp.readInt32LE(22)).toBe(-11);
		expect(bmp.readUInt16LE(28)).toBe(24);
		const read = readBmpImage(bmp);
		if (!read) throw new Error("no bitmap");
		expect(read.width).toBe(16);
		expect(read.height).toBe(11);
		// The bitmap holds the rows of the picture alone, three places to a place and no padding to a row.
		expect(read.pixels).toEqual(PIXELS.subarray(0, 16 * 11 * 3));
	});

	it("turns away what is not one of its pictures", async () => {
		const other = buildNp({ stream: npFixtureStream() });
		other[0] = 0x4d;
		expect(await paprikaNpImageFormat.detect(new BufferByteSource(other))).toBe(
			false,
		);
		const none = buildNp({ stream: npFixtureStream(), count: 0 });
		expect(await paprikaNpImageFormat.detect(new BufferByteSource(none))).toBe(
			false,
		);
		const flat = buildNp({ stream: npFixtureStream(), width: 0 });
		expect(await paprikaNpImageFormat.detect(new BufferByteSource(flat))).toBe(
			false,
		);
		const short = buildNp({ stream: npFixtureStream(), places: 0x10 });
		const shortLayout = readNpLayout(short);
		if (!shortLayout) throw new Error("no layout");
		expect(() => unpackNpPicture(short, shortLayout)).toThrow();
		expect(
			await paprikaNpImageFormat.detect(
				new BufferByteSource(buildNp({ stream: npFixtureStream() })),
			),
		).toBe(true);
	});
});
