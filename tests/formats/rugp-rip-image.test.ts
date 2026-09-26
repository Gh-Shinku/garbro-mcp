// The picture of the newer rUGP engine (`ImageRIP.cs`), against streams built in the test: the mark of an
// object of the engine, the class `CRip` behind it, the head of that class (the places of the picture, the
// flags of the walk of it and the count of the run), and the two walks that stand of the places of the run
// rather than of the bits of it (a run of a picture of a grey, and a walk of a place of a colour over the
// bits). Every picture is read back with the reader of the project, and the places of the classes the port
// does not walk are pinned beside them.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { ripFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { expectArchive } from "../helpers/archive.js";

const OBJECT_SIGNATURE = Buffer.from("a4cbf629", "hex");

/** A count of sixteen places, a count of thirty two, and the tag of a class of the stream. */
function u16(value: number): Buffer {
	const out = Buffer.alloc(2, 0x00);
	out.writeUInt16LE(value & 0xffff, 0);
	return out;
}

function i32(value: number): Buffer {
	const out = Buffer.alloc(4, 0x00);
	out.writeInt32LE(value | 0, 0);
	return out;
}

/** The head of an object of the engine: the mark, the count of the walk of it, and the class of the picture. */
function objectHead(className: string): Buffer {
	const name = Buffer.from(className, "latin1");
	const body = Buffer.alloc(4 + name.length, 0x00);
	body.writeUInt16LE(0, 0);
	body.writeUInt16LE(name.length, 2);
	name.copy(body, 4);
	return Buffer.concat([OBJECT_SIGNATURE, u16(0xffff), body]);
}

/** A picture of the class `CRip`: the head of the class, and the run of the walk behind it. */
function ripRun(input: {
	width: number;
	height: number;
	placeWidth?: number;
	placeHeight?: number;
	kind: number;
	subKind?: number;
	run: Buffer;
}): Buffer {
	const placeWidth = input.placeWidth ?? input.width;
	const placeHeight = input.placeHeight ?? input.height;
	const flags = (input.kind | ((input.subKind ?? 0) << 16)) >>> 0;
	return Buffer.concat([
		objectHead("CRip"),
		i32(1),
		u16(0),
		u16(0),
		u16(placeWidth),
		u16(placeHeight),
		u16(input.width),
		u16(input.height),
		i32(flags),
		i32(input.run.length),
		i32(0),
		input.run,
	]);
}

/** A writer of the bits of the walk of the engine: the highest place of a place first. */
class MsbWriter {
	readonly #bits: number[] = [];

	bits(values: readonly number[]): this {
		this.#bits.push(...values);
		return this;
	}

	value(value: number, count: number): this {
		for (let place = count - 1; place >= 0; place -= 1) {
			this.#bits.push((value >> place) & 1);
		}
		return this;
	}

	toBuffer(): Buffer {
		const out = Buffer.alloc(Math.ceil(this.#bits.length / 8), 0x00);
		this.#bits.forEach((bit, at) => {
			if (bit !== 0) {
				const place = Math.floor(at / 8);
				out[place] = (out[place] ?? 0) | (1 << (7 - (at % 8)));
			}
		});
		return out;
	}
}

/**
 * The picture of the walk of the bits: a place of a colour, and then the places of it, of the places of the
 * one in front of them (`ReadLong`). The place of the colour of the walk stands of the **row behind it** as
 * well, so the second row of the picture stands of the colour the first one left behind: the places of it are
 * the deltas to that colour rather than its places of their own.
 */
function rgb1Run(): Buffer {
	const writer = new MsbWriter();
	// The first row, of no colour in front of it: a place of a blue of four, of a green of eight, of a red of
	// twelve, and then a place that stands of the colour behind it.
	writer.bits([1]);
	for (const colour of [4, 8, 12]) writer.bits([1, 0]).value(colour >> 2, 6);
	writer.bits([0]);
	// The second row, of that colour in front of it: every place of it stands of the places of the one in
	// front of it, so a place of a blue of four is of the seeds `0, 1`, and the other two of `0, 0`.
	writer.bits([1, 0, 1, 0, 0, 0, 0, 0]);
	return writer.toBuffer();
}

/** A picture of the class `CRip007`: the counts of the class, the seven places of its walk, and the run. */
function rip007Run(input: {
	width: number;
	height: number;
	placeWidth?: number;
	placeHeight?: number;
	flags: number;
	compressInfo: readonly number[];
	run: Buffer;
}): Buffer {
	const placeWidth = input.placeWidth ?? input.width;
	const placeHeight = input.placeHeight ?? input.height;
	return Buffer.concat([
		objectHead("CRip007"),
		i32(1),
		u16(input.width),
		u16(input.height),
		u16(0),
		u16(0),
		u16(placeWidth),
		u16(placeHeight),
		i32(input.flags),
		Buffer.from(input.compressInfo),
		i32(input.run.length),
		i32(0),
		input.run,
	]);
}

it("reads a picture of the walk of the places of an alpha of the class", async () => {
	// The walk of the kind 3 (`UncompressRgba`) stands of a count of the places of the run in front of it
	// and of a run of counts behind it: a count of the places of one alpha behind every count, and the
	// places of the colour of the alpha behind it. The places of the picture of this walk stand of the
	// **second** pair of the counts of the head of the class, where the places of the picture of the
	// walks of the bits stand of the first pair: the two pairs of the fixture stand apart, so the
	// picture of the walk is held to the pair of it.
	const writer = new MsbWriter();
	// A place of an alpha of one (seven places of the count of it of nothing behind the flag of it), and
	// then a place of a colour of the places of a blue, of a green and of a red of three.
	writer.bits([1]);
	writer.bits([0, 0, 0, 0, 0, 0, 0]);
	writer.bits([1, 0, 0, 0, 0, 0, 0]);
	const bits = writer.toBuffer();
	// The run of the counts of the walk: a count of one place of the picture of no alpha, and a count of
	// one place of the alpha of it.
	const run = Buffer.concat([i32(4 + bits.length), bits, Buffer.from([1, 1])]);
	const archive = new BufferByteSource(
		ripRun({
			width: 2,
			height: 1,
			placeWidth: 3,
			placeHeight: 1,
			kind: 3,
			subKind: 2,
			run,
		}),
	);
	const opened = await ripFormat.open(archive, "sample.rip");
	try {
		expect(opened.metadata).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
		const extracted = await consumeBuffer(
			await opened.openEntry(opened.entries[0]?.id ?? ""),
		);
		const read = readBmpImage(extracted);
		if (!read) throw new Error("no picture of the walk of the project");
		// The first place of the row stands of no place of a colour at all (a picture of nothing), and the
		// second of the place of the colour of three of an alpha of one.
		expect([...read.pixels]).toEqual([0, 0, 0, 0, 3, 3, 3, 1]);
	} finally {
		await opened.close();
	}
});

it("reads a picture of the walk of the bits of the kind 3 of the class", async () => {
	// The third walk of the bits (`UncompressRgb3`): the same places of the run as the walk of the kind 1,
	// of a count of three places of a blue and of a red and of one of a green stood on every place of it.
	const writer = new MsbWriter();
	// A place of a colour of the picture: the flag of it, a count of twelve places of a blue, a count of
	// no place of a green, and a count of twelve places of a red.
	writer.bits([1]);
	writer.bits([1, 1, 1, 1]);
	writer.bits([0, 0]);
	writer.bits([1, 1, 1, 1]);
	const archive = new BufferByteSource(
		ripRun({
			width: 1,
			height: 1,
			kind: 2,
			subKind: 3,
			run: writer.toBuffer(),
		}),
	);
	const opened = await ripFormat.open(archive, "sample.rip");
	try {
		const extracted = await consumeBuffer(
			await opened.openEntry(opened.entries[0]?.id ?? ""),
		);
		const read = readBmpImage(extracted);
		if (!read) throw new Error("no picture of the walk of the project");
		// The places of the walk of the class stand of the places of it: three of a blue, of a red and of
		// a green of the walk of the kind 3 behind the walk of the kind 1 of a count of one.
		expect([...read.pixels]).toEqual([15, 1, 15, 0]);
	} finally {
		await opened.close();
	}
});

describe("rUGP picture of a CRip007 object", () => {
	it("reads a picture of the walk of the class, of the places of a colour", async () => {
		// A walk of two rows of two places: the counts of the places of the walk stand of a count of their own
		// (`GetInt`), the first row stands of the places of a colour of the engine, and the second of the places
		// of the row behind it. The counts of the walk of the class are the places of a colour of the engine
		// itself, of the eight places of each of them, so the places of the colour stand as they are read.
		const writer = new MsbWriter();
		// The first row: a count of two places, and then a place of a green of one and a place of no change.
		writer.bits([1, 0, 0]);
		// A place of a green of one: no place of the colour behind it, a place of a green of the sign of
		// nothing and of the count of one, and no place of a blue and of a red of its own.
		writer.bits([0, 1, 0, 0, 0, 0]);
		writer.bits([0, 0, 0, 0]);
		// The second row: a count of two places, of the colour of the row behind it.
		writer.bits([1, 0, 0]);
		writer.bits([1]);
		writer.bits([1]);
		const archive = new BufferByteSource(
			rip007Run({
				width: 2,
				height: 2,
				flags: 2,
				compressInfo: [0, 0, 0, 0, 8, 8, 8],
				run: writer.toBuffer(),
			}),
		);
		const opened = await ripFormat.open(archive, "sample.rip");
		try {
			expect(opened.metadata).toMatchObject({
				width: 2,
				height: 2,
				bitsPerPixel: 32,
				className: "CRip007",
			});
			const extracted = await consumeBuffer(
				await opened.openEntry(opened.entries[0]?.id ?? ""),
			);
			const read = readBmpImage(extracted);
			if (!read) throw new Error("no picture of the walk of the project");
			expect(read.width).toBe(2);
			expect(read.height).toBe(2);
			// The place of a green of one stands of the places of a blue and of a red of the same count as
			// well, and every place of the picture behind it stands of the place in front of it.
			// The places of the colour of nothing of the class stand of the place of a colour of the head of
			// the file, and of the walk of the reference that place holds the highest place of a colour as
			// well: the places of the picture stand of the places of it as they are.
			expect([...read.pixels]).toEqual([
				1, 1, 1, 255, 1, 1, 1, 255, 1, 1, 1, 255, 1, 1, 1, 255,
			]);
		} finally {
			await opened.close();
		}
	});

	it("reads a picture of the walk of a place of an alpha of the class", async () => {
		// A picture of one row of two places of an alpha of the class (`m_flags & 0xFF` reads three). The walk
		// stands of the places of a colour where the places of an alpha stand of none, of a count of the places
		// of the class behind them: the colour of the second place of the row stands of the colour in front of
		// it where the counts of a repeat hold it.
		const writer = new MsbWriter();
		// A place of an alpha of thirty one of this engine: the count of the walk (`GetInt`) reads a place of
		// a bit of it and a place of a bit of a count behind every one of them, of a place of a bit of nothing
		// behind the last of them.
		writer.bits([1]);
		writer.bits([0]);
		writer.bits([1, 1, 1, 1, 1, 1, 1, 1, 0]);
		// A count of the places of the row of one, of a place of a colour in front of it of nothing, and a
		// place of a green of one of the place of the colour of nothing.
		writer.bits([0, 0, 0, 1, 0, 0, 0, 0]);
		// The second place: a place of an alpha of no change, a count of the places of the row of one, and no
		// place of a colour of its own.
		writer.bits([0, 0, 0]);
		const archive = new BufferByteSource(
			rip007Run({
				width: 2,
				height: 1,
				flags: 3,
				compressInfo: [0, 0, 0, 0, 8, 8, 8],
				run: writer.toBuffer(),
			}),
		);
		const opened = await ripFormat.open(archive, "sample.rip");
		try {
			expect(opened.metadata).toMatchObject({
				width: 2,
				height: 1,
				bitsPerPixel: 32,
				className: "CRip007",
			});
			const extracted = await consumeBuffer(
				await opened.openEntry(opened.entries[0]?.id ?? ""),
			);
			const read = readBmpImage(extracted);
			if (!read) throw new Error("no picture of the walk of the project");
			expect([...read.pixels]).toEqual([1, 1, 1, 255, 1, 1, 1, 255]);
		} finally {
			await opened.close();
		}
	});

	it("holds the picture of the class to the counts of the walk of it", async () => {
		// A picture of the class of a count of the places of it of nothing is not a picture of this engine, and
		// a run of no places at all stands of a picture of the places of nothing rather than of a failure: the
		// walk of the reference reads a stream that ends as a place of no places.
		await expectArchive({
			format: ripFormat,
			archive: rip007Run({
				width: 2,
				height: 2,
				placeWidth: 0,
				flags: 2,
				compressInfo: [0, 0, 0, 0, 8, 8, 8],
				run: Buffer.alloc(2, 0x00),
			}),
			sourcePath: "sample.rip",
			entries: [],
			detected: false,
		});
		const source = new BufferByteSource(
			rip007Run({
				width: 2,
				height: 2,
				flags: 2,
				compressInfo: [0, 0, 0, 0, 8, 8, 8],
				run: Buffer.alloc(2, 0x00),
			}),
		);
		const opened = await ripFormat.open(source, "sample.rip");
		try {
			const extracted = await consumeBuffer(
				await opened.openEntry(opened.entries[0]?.id ?? ""),
			);
			const read = readBmpImage(extracted);
			if (!read) throw new Error("no picture of the walk of the project");
			expect([...read.pixels].every((place) => 0 === place)).toBe(true);
		} finally {
			await opened.close();
		}
	});
});

describe("rUGP picture of a CRip object", () => {
	it("reads a picture of a run of places of a grey", async () => {
		// Every place of the picture stands of a count of the places of a colour and of the colour behind that
		// count: the first row of the picture stands of one count of four places, and the second of a count of
		// two places of the colour of nothing and then of two places of the colour 0x7F.
		const run = Buffer.from([4, 2, 0x7f, 2]);
		const archive = new BufferByteSource(
			ripRun({ width: 4, height: 2, kind: 1, run }),
		);
		const opened = await ripFormat.open(archive, "sample.sia");
		try {
			expect(opened.metadata).toMatchObject({
				width: 4,
				height: 2,
				bitsPerPixel: 8,
				kind: 1,
			});
			const extracted = await consumeBuffer(
				await opened.openEntry(opened.entries[0]?.id ?? ""),
			);
			const read = readBmpImage(extracted);
			if (!read) throw new Error("no picture of the walk of the project");
			expect(read.width).toBe(4);
			expect(read.height).toBe(2);
			expect([...read.pixels]).toEqual([0, 0, 0, 0, 0, 0, 0x7f, 0x7f]);
		} finally {
			await opened.close();
		}
	});

	it("reads a picture of the walk of the bits", async () => {
		const archive = new BufferByteSource(
			ripRun({ width: 2, height: 2, kind: 2, subKind: 1, run: rgb1Run() }),
		);
		const opened = await ripFormat.open(archive, "sample.rip");
		try {
			expect(opened.metadata).toMatchObject({
				width: 2,
				height: 2,
				bitsPerPixel: 32,
				kind: 2,
				subKind: 1,
			});
			const extracted = await consumeBuffer(
				await opened.openEntry(opened.entries[0]?.id ?? ""),
			);
			const read = readBmpImage(extracted);
			if (!read) throw new Error("no picture of the walk of the project");
			// The places of the walk stand of the top of the picture down, of a place of a blue, of a green
			// and of a red of the colour the first place of every row names.
			expect(read.width).toBe(2);
			expect(read.height).toBe(2);
			expect([...read.pixels]).toEqual([
				4, 8, 12, 0, 4, 8, 12, 0, 4, 8, 12, 0, 4, 8, 12, 0,
			]);
		} finally {
			await opened.close();
		}
	});

	it("names the pictures of the walks this port does not carry", async () => {
		// The class `CRip007` and the kind 2 of the bit walks stand unported: both are named as the piece that
		// does not stand rather than read of a guess.
		const unknown = ripRun({
			width: 2,
			height: 2,
			kind: 2,
			subKind: 2,
			run: Buffer.alloc(4, 0x00),
		});
		const source = new BufferByteSource(unknown);
		expect(await ripFormat.detect(source, "sample.rip")).toBe(true);
		const opened = await ripFormat.open(source, "sample.rip");
		try {
			await expect(
				opened.openEntry(opened.entries[0]?.id ?? ""),
			).rejects.toThrow(/stands unported/);
		} finally {
			await opened.close();
		}
	});

	it("holds the picture to the mark and the class of the engine", async () => {
		await expectArchive({
			format: ripFormat,
			archive: Buffer.concat([
				Buffer.alloc(4, 0x11),
				ripRun({
					width: 2,
					height: 2,
					kind: 1,
					run: Buffer.from([2, 2]),
				}),
			]),
			sourcePath: "sample.rip",
			entries: [],
			detected: false,
		});
		await expectArchive({
			format: ripFormat,
			archive: Buffer.concat([
				objectHead("CNothing"),
				Buffer.alloc(0x20, 0x00),
			]),
			sourcePath: "sample.rip",
			entries: [],
			detected: false,
		});
		// A run of a count of the places of the picture of nothing, and a run of the places of no walk at all.
		await expectArchive({
			format: ripFormat,
			archive: ripRun({ width: 0, height: 2, kind: 1, run: Buffer.alloc(2) }),
			sourcePath: "sample.rip",
			entries: [],
			detected: false,
		});
		await expectArchive({
			format: ripFormat,
			archive: ripRun({
				width: 2,
				height: 2,
				kind: 4,
				run: Buffer.alloc(2),
			}),
			sourcePath: "sample.rip",
			entries: [],
			detected: false,
		});
	});
});
