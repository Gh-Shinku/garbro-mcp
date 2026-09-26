// The picture of the rUGP engine (`ImageS5I.cs`), against streams built in the test: the mark of an object of
// the engine, the class `CS5i` behind it, and the counts of the picture. Both counts of the head of the walk
// of the object stand here — the schema of nothing, which keeps the places of the picture right behind the
// head of the object, and a schema that names a count of the places of the picture — and the picture is read
// back with the reader of the project rather than held against a header of its own.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { s5iFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { expectArchive } from "../helpers/archive.js";

const OBJECT_SIGNATURE = Buffer.from("a4cbf629", "hex");
const WIDTH = 3;
const HEIGHT = 2;

/** The places of the picture of the test: a place of a colour of thirty two places. */
function pixels(): Buffer {
	return Buffer.from(
		[...Array(WIDTH * HEIGHT * 4).keys()].map((at) => (at * 17 + 3) & 0xff),
	);
}

/** A count of sixteen places. */
function u16(value: number): Buffer {
	const out = Buffer.alloc(2, 0x00);
	out.writeUInt16LE(value & 0xffff, 0);
	return out;
}

/** A count of thirty two places. */
function i32(value: number): Buffer {
	const out = Buffer.alloc(4, 0x00);
	out.writeInt32LE(value | 0, 0);
	return out;
}

/**
 * The class of the picture: the count of the places of the class, the count of the places of its name, and the
 * name itself. The tag in front of those counts is the count of the walk of the object where that count
 * stands of no schema, and a count of its own behind the two words of the head of the walk otherwise.
 */
function classOf(name: string, schema = 0x00): Buffer {
	const body = Buffer.alloc(4 + name.length, 0x00);
	body.writeUInt16LE(schema, 0);
	body.writeUInt16LE(name.length, 2);
	body.write(name, 4, "latin1");
	return body;
}

/**
 * An object of a picture: the mark of an object, the count of the places of the head of its walk, the class of
 * it, the places of the object behind the head (`+8` and `+0x0C` are the two counts of the picture and the
 * places the reference reads and stands of none), and then the picture itself.
 */
function pictureRun(input?: {
	version?: number;
	className?: string;
	declared?: number;
	sized?: boolean;
}): Buffer {
	// The word behind the mark of an object is the count of the places of the walk of it where that count
	// stands of a schema, and the tag of the class of the picture where it does not: the walk of the engine
	// reads that word twice, and stands of it again as the tag of the class.
	const version = input?.version ?? 0xffff;
	const body = pixels();
	const places = body.length;
	return Buffer.concat([
		OBJECT_SIGNATURE,
		u16(version),
		input?.sized === true ? u16(0x0000) : Buffer.alloc(0),
		input?.sized === true ? u16(0xffff) : Buffer.alloc(0),
		classOf(input?.className ?? "CS5i"),
		Buffer.alloc(8, 0x00),
		u16(WIDTH),
		u16(HEIGHT),
		Buffer.alloc(8, 0x00),
		input?.sized === true ? i32(input.declared ?? places) : Buffer.alloc(0),
		body,
	]);
}

describe("rUGP picture of a CS5i object", () => {
	it("reads the counts of a picture of no schema, and the places of it", async () => {
		// The count of the walk of the object stands of no schema, so the places of the picture stand right
		// behind the places of the object, and the picture is read back with the reader of the project.
		const source = new BufferByteSource(pictureRun());
		const archive = await s5iFormat.open(source, "sample.s5i");
		try {
			const extracted = await consumeBuffer(
				await archive.openEntry(archive.entries[0]?.id ?? ""),
			);
			const read = readBmpImage(extracted);
			if (!read) throw new Error("no picture of the walk of the project");
			expect(read.width).toBe(WIDTH);
			expect(read.height).toBe(HEIGHT);
			expect(read.pixels.equals(pixels())).toBe(true);
		} finally {
			await archive.close();
		}
		await expectArchive({
			format: s5iFormat,
			archive: pictureRun(),
			sourcePath: "sample.s5i",
			entries: [
				{
					path: "image.bmp",
					size: pictureRun().length,
				},
			],
			metadata: { width: WIDTH, height: HEIGHT, bitsPerPixel: 32, schema: 0 },
		});
	});

	it("reads the places of a picture of a schema that names a count of them", async () => {
		// The schema of the head of the walk names a count of the places of the picture, which stands of the
		// places of the picture itself rather than of the counts of it: a run longer than the picture is read
		// of the count of the picture alone, and a run shorter than it is turned away.
		const source = new BufferByteSource(
			pictureRun({ version: 0x11, sized: true, declared: pixels().length }),
		);
		const archive = await s5iFormat.open(source, "sample.s5i");
		try {
			expect(archive.metadata).toMatchObject({
				width: WIDTH,
				height: HEIGHT,
				schema: 0x11,
			});
			const extracted = await consumeBuffer(
				await archive.openEntry(archive.entries[0]?.id ?? ""),
			);
			const read = readBmpImage(extracted);
			if (!read) throw new Error("no picture of the walk of the project");
			expect(read.width).toBe(WIDTH);
			expect(read.height).toBe(HEIGHT);
			expect(read.pixels.equals(pixels())).toBe(true);
		} finally {
			await archive.close();
		}
		await expectArchive({
			format: s5iFormat,
			archive: pictureRun({ version: 0x11, sized: true, declared: 4 }),
			sourcePath: "sample.s5i",
			entries: [],
			detected: false,
		});
	});

	it("holds the picture to the mark and the class of the engine", async () => {
		// A file of another mark, of another class, and a picture of no places at all are turned away.
		const other = Buffer.concat([Buffer.alloc(4, 0x11), pictureRun()]);
		await expectArchive({
			format: s5iFormat,
			archive: other,
			sourcePath: "sample.s5i",
			entries: [],
			detected: false,
		});
		await expectArchive({
			format: s5iFormat,
			archive: pictureRun({ className: "CNothing" }),
			sourcePath: "sample.s5i",
			entries: [],
			detected: false,
		});
		const empty = Buffer.concat([
			OBJECT_SIGNATURE,
			u16(0xffff),
			classOf("CS5i"),
			Buffer.alloc(8, 0x00),
			u16(0),
			u16(HEIGHT),
			Buffer.alloc(8, 0x00),
			Buffer.alloc(0),
		]);
		await expectArchive({
			format: s5iFormat,
			archive: empty,
			sourcePath: "sample.s5i",
			entries: [],
			detected: false,
		});
	});
});
