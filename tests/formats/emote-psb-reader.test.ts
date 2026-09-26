// The PSB container of the Emote engine (GARbro "ArcFormats/Emote/ArcPSB.cs", classes `PsbOpener` and
// `PsbReader`), against archives built in the test. The engine stands of a head that names six tables, of
// two tables of names (the walk of a name stands of a table whose every place names the place of the walk
// behind it, and of a table that names the place behind every place of the first), of a table of the objects
// of the file, and of the cipher of its own.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import {
	emoteDrefFormat,
	emotePsbFormat,
	kirikiriTlgImageFormat,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	blendDrefLayer,
	readDrefLayers,
} from "../../packages/formats/src/emote/dref-image.js";
import {
	PsbCipher,
	PsbReader,
	readPsbHeader,
} from "../../packages/formats/src/emote/psb-reader.js";
import { decodePsbTexture } from "../../packages/formats/src/emote/psb-texture.js";
import { decodeEmotePicture } from "../../packages/formats/src/emote/psb-archive.js";
import {
	readBmpImage,
	writeBmp32,
} from "../../packages/formats/src/shared/bmp.js";
import { withCompanionFiles } from "../helpers/companion.js";

/** The places of the file of the tables of the fixture. */
const NAMES = 0x28;
const ENTRIES = 0x400;
const PARENTS = NAMES + 6 + ENTRIES * 4;
const CHUNKS = PARENTS + 6 + ENTRIES * 4;
const LENGTHS = CHUNKS + 0x20;
const OBJECT = LENGTHS + 0x20;
const ROOT = OBJECT + 0x20;
const CHUNK_DATA = ROOT + 0x40;

/** A table of the objects of the file, of the count of the places of the count of its objects. */
function table(values: number[]): Buffer {
	const out = Buffer.alloc(6 + values.length * 4, 0x00);
	out[0] = 0x10; // the kind of the count of the places of the objects of the table
	out.writeUInt32LE(values.length, 1);
	out[5] = 0x10; // the kind of one object of the table: a count of four places of the file
	for (const [index, value] of values.entries())
		out.writeInt32LE(value, 6 + index * 4);
	return out;
}

/**
 * An archive of the engine, of the one name `x`. The tables of the names stand of a place for the root of
 * the walk (nought), of a place for the place behind the root that the name `x` stands of, and of a place
 * for the place the walk of the name ends at, which stands of the place of the object the name names.
 */
function psbFile(input: {
	name: string;
	value: number;
	broken?: "table" | "root" | "cipher";
	cipher?: number;
	chunk?: { offset: number; length: number };
}): Buffer {
	const file = Buffer.alloc(CHUNK_DATA + 0x100, 0x00);
	file.write("PSB\0", 0, "latin1");
	file.writeUInt16LE(3, 4);
	file.writeUInt16LE(
		"cipher" === input.broken ? 1 : undefined === input.cipher ? 0 : 2,
		6,
	);
	const head = Buffer.alloc(0x20, 0x00);
	const place = (at: number, value: number): void => {
		head.writeInt32LE(value, at);
	};
	place(0x04, NAMES);
	place(0x08, NAMES); // the strings of the file stand of no use in this stage
	place(0x0c, NAMES);
	// The place of the places of the chunks ends the run of the file the cipher stands over, which begins
	// at the tables of the names.
	place(0x10, undefined === input.cipher ? CHUNKS : PARENTS + 6 + ENTRIES * 4);
	place(0x14, LENGTHS);
	place(0x18, "table" === input.broken ? 0x10 : CHUNK_DATA);
	place(0x1c, ROOT);
	head.copy(file, 8);

	// The two tables of the names: the first names the place of the walk of a name behind every place, the
	// second names the place of the file a place of the walk stood at.
	const names = Array.from<number>({ length: ENTRIES }).fill(0);
	const parents = Array.from<number>({ length: ENTRIES }).fill(0x7fffffff);
	const child = 1 + input.name.charCodeAt(0);
	const terminal = 0x200;
	names[0] = 1; // the places of the walk behind the root of the names
	names[child] = terminal; // the place the name stands of
	parents[child] = 0;
	names[terminal] = OBJECT; // the place of the file of the object the name stands of
	parents[terminal] = child;
	table(names).copy(file, NAMES);
	table(parents).copy(file, PARENTS);

	// The object the name stands of, and the root of the file, which is a dictionary of one name.
	file[OBJECT] = 0x08; // a count of four places of the file
	file.writeInt32LE(input.value, OBJECT + 1);
	const keys = table([OBJECT]);
	file[ROOT] = "root" === input.broken ? 0x20 : 0x21;
	keys.copy(file, ROOT + 1);
	const values = table([0]);
	values.copy(file, ROOT + 1 + keys.length);
	const valuePlace = ROOT + 1 + keys.length + values.length;
	if (undefined === input.chunk) {
		file[valuePlace] = 0x08;
		file.writeInt32LE(input.value, valuePlace + 1);
	} else {
		// The object of the dictionary stands of the places of a chunk of the engine instead: the count of
		// the places of the chunk of the engine stands of the kind 0x19 of the file.
		file[valuePlace] = 0x19;
		file.writeUInt32LE(0, valuePlace + 1);
		table([input.chunk.offset]).copy(file, CHUNKS);
		table([input.chunk.length]).copy(file, LENGTHS);
	}
	if (undefined !== input.cipher) {
		const end = PARENTS + 6 + ENTRIES * 4;
		new PsbCipher(input.cipher).xor(file, NAMES, end - NAMES);
	}
	return file;
}

describe("Emote PSB container", () => {
	it("reads the head of the archive and the places of its tables", () => {
		const data = psbFile({ name: "x", value: 0x0040abcd });
		const header = readPsbHeader(data, false);
		expect(header).toMatchObject({
			version: 3,
			flags: 0,
			names: NAMES,
			chunkData: CHUNK_DATA,
			root: ROOT,
		});
		expect(header?.extraOffsets).toBeUndefined();
		// A head whose table stands before the least place of a table of the engine stands refused.
		expect(
			readPsbHeader(psbFile({ name: "x", value: 1, broken: "table" }), false),
		).toBeUndefined();
		// A head that stands of the cipher of the engine stands in the stage behind this one.
		expect(
			readPsbHeader(psbFile({ name: "x", value: 1, broken: "cipher" }), false),
		).toBeUndefined();
	});

	it("reads a name of the file out of the two tables of the names", () => {
		const reader = PsbReader.parse(psbFile({ name: "x", value: 0x0040abcd }));
		if (!reader) throw new Error("no reader");
		expect(reader.offsetOf("x")).toBe(OBJECT);
		expect(reader.offsetOf("y")).toBeUndefined();
		expect(reader.offsetOf("")).toBeUndefined();
		expect([...reader.nameMap()]).toEqual([[OBJECT, "x"]]);
	});

	it("reads an object of the file out of a dictionary of the file", () => {
		const reader = PsbReader.parse(psbFile({ name: "x", value: 0x0040abcd }));
		if (!reader) throw new Error("no reader");
		const at = reader.key("x", ROOT);
		expect(at).toBeTypeOf("number");
		if (undefined === at) throw new Error("no place");
		expect(reader.object(at)).toBe(0x0040abcd);
		expect(reader.key("y", ROOT)).toBeUndefined();
		expect(reader.scalar(OBJECT)).toBe(0x0040abcd);
		// An object of no kind of the engine stands refused rather than read.
		expect(() => reader.object(OBJECT + 0x10)).toThrow();
	});

	it("reads the cipher of the engine, of the key of the game", () => {
		// The places of the file the cipher of the engine stands of, of the key 970396437 of the reference.
		// The counts below were worked out by an implementation of that walk written in another language
		// from the same lines of the reference, so they pin the port against a second reading of the
		// algorithm rather than against its own arithmetic.
		const stream = Buffer.alloc(12, 0x00);
		new PsbCipher(970396437).xor(stream, 0, stream.length);
		expect([...stream]).toEqual([
			0x5f, 0x42, 0x3d, 0xe0, 0xc0, 0x16, 0xcf, 0x27, 0x1f, 0x4e, 0x8e, 0xa9,
		]);
		// A file whose tables stand of the cipher of the engine stands read of the key of the game, and
		// stands of no read where no key, or another key, stands at hand.
		const data = psbFile({ name: "x", value: 0x0040abcd, cipher: 970396437 });
		const reader = PsbReader.parse(data, { key: 970396437 });
		if (!reader) throw new Error("no reader");
		expect(reader.header.flags).toBe(2);
		expect(reader.offsetOf("x")).toBe(OBJECT);
		expect([...reader.nameMap()]).toEqual([[OBJECT, "x"]]);
		// The head of the file stands of the tables of the cipher, so a walk of no key reads a head of its
		// own and stands of no name of the file at all.
		expect(PsbReader.parse(data)).toBeUndefined();
		const wrong = PsbReader.parse(data, { key: 1 });
		expect(() => wrong?.nameMap()).toThrow();
	});

	it("stands of no file of another object at the root of the file or of no head at all", () => {
		expect(
			PsbReader.parse(psbFile({ name: "x", value: 1, broken: "root" })),
		).toBeUndefined();
		expect(PsbReader.parse(Buffer.alloc(0x10, 0x00))).toBeUndefined();
	});
});

/** A picture of the fifth kind of the engine of the places of the file, of the one colour of a plane. */
function tlg5(colour: number): Buffer {
	const head = Buffer.alloc(20, 0x00);
	head.write("TLG5.0", 0, "latin1");
	head.write("\0raw\x1a", 6, "latin1");
	head[11] = 3;
	head.writeUInt32LE(2, 12); // the count of the places of a row
	head.writeUInt32LE(1, 16); // the count of the places of a column
	const start = Buffer.alloc(4, 0x00);
	start.writeInt32LE(1, 0); // the count of the places of a block
	const parts: Buffer[] = [head, start, Buffer.alloc(4, 0x00)];
	for (const grey of [colour, 0x20, 0x30]) {
		const plane = Buffer.from([grey, 0x20]);
		const word = Buffer.alloc(5, 0x00);
		word[0] = 1; // the places of the plane stand as they stand
		word.writeInt32LE(plane.length, 1);
		parts.push(word, plane);
	}
	const body = Buffer.concat(parts);
	return Buffer.concat([
		body,
		Buffer.alloc(Math.max(0, 0x26 - body.length), 0x00),
	]);
}

describe("Emote PSB picture of the engine", () => {
	it("reads a picture of the name of the walk of that name", async () => {
		const picture = decodeEmotePicture(
			{
				textureType: "TLG",
				width: 2,
				height: 1,
				truncatedWidth: 2,
				truncatedHeight: 1,
			},
			tlg5(0x10),
		);
		if (!picture) throw new Error("no picture");
		const read = readBmpImage(picture);
		if (!read) throw new Error("no picture read");
		expect([read.width, read.height, read.bitsPerPixel]).toEqual([2, 1, 32]);
		// The picture of the name stands of the walk of the places of the file of that name, of the same
		// walk the row of that name of this project stands of: a picture of the same places of the file
		// stands of the same places of a picture here as it does there.
		const stored = tlg5(0x10);
		const tlgSource = new BufferByteSource(stored);
		const tlgArchive = await kirikiriTlgImageFormat.open(
			tlgSource,
			"picture.tlg",
		);
		try {
			const tlgEntry = tlgArchive.entries[0];
			if (!tlgEntry) throw new Error("no picture of the name");
			const throughTheRow = await consumeBuffer(
				await tlgArchive.openEntry(tlgEntry.id),
			);
			expect(picture).toEqual(throughTheRow);
		} finally {
			await tlgArchive.close();
		}
		// A picture of the name that stands of no walk of that name stands of nothing.
		expect(
			decodeEmotePicture({ textureType: "TLG" }, Buffer.alloc(0x30, 0x00)),
		).toBeUndefined();
	});

	it("reads a picture of the places of a colour of the file, of the full count of a row", () => {
		// The picture of the engine stands of the count of the places of a row of the *full* picture, and
		// the places handed over stand of the count of the cut picture: the second row of the cut picture
		// stands of the places behind the full row of the file.
		const data = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
			22, 23, 24,
		]);
		const places = decodePsbTexture(data, {
			texType: "RGBA8",
			fullWidth: 3,
			fullHeight: 2,
			width: 2,
			height: 2,
		});
		if (!places) throw new Error("no picture");
		const picture = readBmpImage(places);
		if (!picture) throw new Error("no picture read");
		expect([picture.width, picture.height, picture.bitsPerPixel]).toEqual([
			2, 2, 32,
		]);
		expect([...picture.pixels]).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 13, 14, 15, 16, 17, 18, 19, 20,
		]);
	});

	it("reads the grey, the grey of a covering place and the four places of a colour of the engine", () => {
		const grey = decodePsbTexture(Buffer.from([0x40, 0x80]), {
			texType: "L8",
			fullWidth: 2,
			fullHeight: 1,
			width: 2,
			height: 1,
		});
		if (!grey) throw new Error("no picture");
		const greyPicture = readBmpImage(grey);
		expect([...(greyPicture?.pixels ?? [])]).toEqual([
			0x40, 0x40, 0x40, 0xff, 0x80, 0x80, 0x80, 0xff,
		]);
		const alpha = decodePsbTexture(Buffer.from([0x11, 0x22, 0x33, 0x44]), {
			texType: "A8L8",
			fullWidth: 2,
			fullHeight: 1,
			width: 2,
			height: 1,
		});
		if (!alpha) throw new Error("no picture");
		expect([...(readBmpImage(alpha)?.pixels ?? [])]).toEqual([
			0x11, 0x11, 0x11, 0x22, 0x33, 0x33, 0x33, 0x44,
		]);
		// A place of the file of four places of half a place each: the low half names the first place of a
		// colour of the picture, and the count of the places of a colour stands of the count itself.
		const half = decodePsbTexture(Buffer.from([0x21, 0xf0]), {
			texType: "RGBA4444",
			fullWidth: 1,
			fullHeight: 1,
			width: 1,
			height: 1,
		});
		if (!half) throw new Error("no picture");
		expect([...(readBmpImage(half)?.pixels ?? [])]).toEqual([
			0x11, 0x22, 0x00, 0xff,
		]);
	});

	it("reads a picture of the engine of the walk of its own places", () => {
		// A place of a count of the low place at nought stands of the places of the file themselves, and a
		// place of a count of the high place at one stands of one place of a colour, stood again and again.
		const data = Buffer.from([
			0x01, 1, 2, 3, 4, 5, 6, 7, 8, 0x80, 9, 10, 11, 12,
		]);
		const places = decodePsbTexture(data, {
			texType: "RL",
			fullWidth: 3,
			fullHeight: 1,
			width: 3,
			height: 1,
		});
		if (!places) throw new Error("no picture");
		expect([...(readBmpImage(places)?.pixels ?? [])]).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
		]);
		// A picture whose places stand short of the counts of its own places stands refused.
		expect(() =>
			decodePsbTexture(Buffer.from([0x02, 1, 2, 3, 4]), {
				texType: "RL",
				fullWidth: 3,
				fullHeight: 1,
				width: 3,
				height: 1,
			}),
		).toThrow();
		// A kind of picture the reference carries no walk of stands of nothing.
		expect(
			decodePsbTexture(Buffer.alloc(4), {
				texType: "RGBA1010102",
				fullWidth: 1,
				fullHeight: 1,
				width: 1,
				height: 1,
			}),
		).toBeUndefined();
	});

	it("reads a picture of the blocks of the file", () => {
		// One block of the fifth kind of four places by four, of one colour of no covering place at all.
		const block = Buffer.from([
			0x00, 0xff, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x00, 0x00, 0x00, 0x00,
		]);
		const places = decodePsbTexture(block, {
			texType: "DXT5",
			fullWidth: 4,
			fullHeight: 4,
			width: 4,
			height: 4,
		});
		if (!places) throw new Error("no picture");
		const picture = readBmpImage(places);
		expect([picture?.width, picture?.height]).toEqual([4, 4]);
	});
});

describe("Emote compound picture of the places of its layers", () => {
	/** A picture of the engine of two places by two, of one colour of the places of the file. */
	function pictureOf(colour: [number, number, number, number]): Buffer {
		const pixels = Buffer.alloc(2 * 2 * 4, 0x00);
		for (let at = 0; at < pixels.length; at += 4) {
			pixels[at] = colour[0];
			pixels[at + 1] = colour[1];
			pixels[at + 2] = colour[2];
			pixels[at + 3] = colour[3];
		}
		return writeBmp32(2, 2, pixels);
	}

	/** An archive of the engine of one object, whose places stand of the bitmap given. */
	function psbOf(picture: Buffer): Buffer {
		const chunk = { offset: 0x40, length: picture.length };
		const data = psbFile({ name: "x", value: 0, chunk });
		picture.copy(data, CHUNK_DATA + chunk.offset);
		return data;
	}

	it("reads the places of a picture of the engine out of the lines of its file", () => {
		const data = Buffer.concat([
			Buffer.from([0xef, 0xbb, 0xbf]),
			Buffer.from("psb://a.psb/x\r\npsb://b.psb/x\r\n", "utf8"),
		]);
		expect(readDrefLayers(data)).toEqual([
			{ archive: "a.psb", entry: "x" },
			{ archive: "b.psb", entry: "x" },
		]);
		// A file of no such line stands of no picture of the engine.
		expect(
			readDrefLayers(Buffer.from("psb://a.psb/x\r\nwhat\r\n", "utf16le")),
		).toBeUndefined();
		expect(readDrefLayers(Buffer.alloc(0))).toBeUndefined();
	});

	it("draws the places of a layer over the picture behind them", () => {
		const canvas = {
			width: 2,
			height: 2,
			pixels: Buffer.alloc(2 * 2 * 4, 0x00),
		};
		// The picture behind stands of the places of a colour of the first layer, and the covering place of
		// the layer stands of half of the whole of it: the counts stand of the counts of the places of the
		// file of the two of them, of the whole of the count of the places of a colour taken off.
		const first = pictureOf([0x00, 0x00, 0xff, 0xff]);
		const firstPicture = readBmpImage(first);
		if (!firstPicture) throw new Error("no picture");
		canvas.pixels = Buffer.from(firstPicture.pixels);
		const second = pictureOf([0x00, 0xff, 0x00, 0x80]);
		const secondPicture = readBmpImage(second);
		if (!secondPicture) throw new Error("no picture");
		blendDrefLayer(canvas, {
			width: secondPicture.width,
			height: secondPicture.height,
			offsetX: 1,
			offsetY: 1,
			pixels: secondPicture.pixels,
		});
		const at = (row: number, column: number): number[] => [
			...canvas.pixels.subarray(
				(row * 2 + column) * 4,
				(row * 2 + column) * 4 + 4,
			),
		];
		expect(at(0, 0)).toEqual([0x00, 0x00, 0xff, 0xff]);
		expect(at(0, 1)).toEqual([0x00, 0x00, 0xff, 0xff]);
		expect(at(1, 0)).toEqual([0x00, 0x00, 0xff, 0xff]);
		// The layer stands of one place of the file behind and to the right of the picture behind it, so
		// the second row of the layer, and the places of it behind the row of the picture, stand past the
		// foot and the side of it.
		expect(at(1, 1)).toEqual([0x00, 0x80, 0x7f, 0xff]);
	});

	it("reads a picture of the engine of the archives its file names", async () => {
		const first = psbOf(pictureOf([0x00, 0x00, 0xff, 0xff]));
		const second = psbOf(pictureOf([0x00, 0xff, 0x00, 0x00]));
		const text = Buffer.concat([
			Buffer.from([0xff, 0xfe]),
			Buffer.from("psb://first.psb/x\r\npsb://second.psb/x\r\n", "utf16le"),
		]);
		await withCompanionFiles(
			"sample.dref",
			{ "sample.dref": text, "first.psb": first, "second.psb": second },
			async (mainPath) => {
				const source = new BufferByteSource(text);
				expect(await emoteDrefFormat.detect(source, mainPath)).toBe(true);
				const archive = await emoteDrefFormat.open(source, mainPath);
				try {
					expect(archive.entries.map((entry) => entry.path)).toEqual([
						"picture.bmp",
					]);
					const entry = archive.entries[0];
					if (!entry) throw new Error("no entry");
					const places = await consumeBuffer(await archive.openEntry(entry.id));
					const picture = readBmpImage(places);
					if (!picture) throw new Error("no picture");
					expect([picture.width, picture.height, picture.bitsPerPixel]).toEqual(
						[2, 2, 32],
					);
					// The layer behind stands of the covering place of nought, so the places of the
					// picture behind it stand as they stand.
					expect([...picture.pixels]).toEqual([
						0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xff, 0xff, 0x00, 0x00, 0xff,
						0xff, 0x00, 0x00, 0xff, 0xff,
					]);
				} finally {
					await archive.close();
				}
			},
		);
	});
});

describe("Emote PSB archive", () => {
	it("lists the pictures and the chunks of the archive and hands their places over", async () => {
		const chunk = { offset: 0x40, length: 5 };
		const data = psbFile({ name: "x", value: 0x0040abcd, chunk });
		// The places of the chunk stand of the cipher of the engine behind the tables of the file: the two
		// tables of the names end at the place the head of the fixture names for the chunks.
		Buffer.from("hello", "latin1").copy(data, CHUNK_DATA + chunk.offset);
		const source = new BufferByteSource(data);
		expect(await emotePsbFormat.detect(source, "sample.psb")).toBe(true);
		const archive = await emotePsbFormat.open(source, "sample.psb");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["x"]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			expect(Number(entry.size)).toBe(5);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("hello", "latin1"),
			);
		} finally {
			await archive.close();
		}
		// A file of no such object at its root stands of no archive of the engine.
		const other = psbFile({ name: "x", value: 0x0040abcd });
		expect(
			await emotePsbFormat.detect(new BufferByteSource(other), "other.psb"),
		).toBe(false);
	});
});
