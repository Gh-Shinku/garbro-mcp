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
