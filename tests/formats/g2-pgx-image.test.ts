import { Buffer } from "node:buffer";
import {
	BufferByteSource,
	FileByteSource,
	GarbroError,
} from "@garbro-mcp/core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach } from "vitest";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { unpackGlibLzss } from "../../packages/formats/src/glib/glib-lzss.js";
import {
	g2PgxImageFormat,
	readPgxLayout,
	readStxLayer,
} from "../../packages/formats/src/g2/pgx-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const MARK = Buffer.from("PGX\0", "latin1");
const HEADER_SIZE = 0x18;
const DATA_START = 0x20;

/** One decision of a run: a byte that stands as it is, or a copy that names a place in the frame. */
type Decision =
	| { kind: "literal"; byte: number }
	| { kind: "copy"; low: number; high: number };

/**
 * A run written the way the walk reads it: a control word of one byte stands in front of every eight
 * decisions, and the bytes those decisions stand for follow it - so the control words and the bytes they
 * stand over take turns through the stream.
 */
function walk(decisions: Decision[]): Buffer {
	const out: number[] = [];
	for (let at = 0; at < decisions.length; at += 8) {
		const group = decisions.slice(at, at + 8);
		let control = 0;
		for (const [index, decision] of group.entries()) {
			if ("literal" === decision.kind) control |= 1 << index;
		}
		out.push(control);
		for (const decision of group) {
			if ("literal" === decision.kind) out.push(decision.byte);
			else out.push(decision.low, decision.high);
		}
	}
	return Buffer.from(out);
}

/** A copy that reads the frame from its own first byte and takes four bytes back. */
function copyOfFirst(): Decision {
	return { kind: "copy", low: 0xee, high: 0xfe };
}

/** A run of bytes that all stand as they are. */
function literals(bytes: number[]): Decision[] {
	return bytes.map((byte) => ({ kind: "literal" as const, byte }));
}

function buildPgx(options: {
	width: number;
	height: number;
	bits: number;
	flags?: number;
	body: Buffer;
}): Buffer {
	const head = Buffer.alloc(DATA_START, 0x00);
	MARK.copy(head, 0);
	head.writeUInt32LE(options.width, 8);
	head.writeUInt32LE(options.height, 12);
	head.writeInt16LE(options.bits, 0x10);
	head.writeUInt16LE(options.flags ?? 0, 0x12);
	head.writeInt32LE(options.body.length, 0x14);
	return Buffer.concat([head, options.body]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await g2PgxImageFormat.open(
		new BufferByteSource(data),
		"picture.pgx",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

function pixels(out: Buffer): Buffer {
	const image = readBmpImage(out);
	if (!image) throw new Error("the picture is not a bitmap");
	return image.pixels;
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

/** A directory of its own for a picture and the table of the layers beside it. */
async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(resolve(tmpdir(), "garbro-pgx-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

/**
 * The table of the layers of the engine, of one layer: a place of the table for the layer itself, the name of
 * the picture of the layer, and the place of the picture within its frame.
 */
function stxFile(options: {
	layer: string;
	picture: string;
	left: number;
	top: number;
	right: number;
	bottom: number;
}): Buffer {
	const names = Buffer.from(
		`${options.layer}\u0000filename\u0000rect\u0000`,
		"latin1",
	);
	const layerName = 0;
	const filenameName = options.layer.length + 1;
	const rectName = filenameName + "filename".length + 1;
	// The places of the file of the fields of the layer stand behind the whole of the places of the table.
	const filenameData = Buffer.alloc(4 + options.picture.length, 0x00);
	filenameData.writeUInt32LE(options.picture.length, 0);
	filenameData.write(options.picture, 4, "latin1");
	const rectData = Buffer.alloc(0x14, 0x00);
	rectData.writeInt32LE(options.left, 4);
	rectData.writeInt32LE(options.top, 8);
	rectData.writeInt32LE(options.right, 12);
	rectData.writeInt32LE(options.bottom, 16);
	const info = Buffer.concat([filenameData, rectData]);
	const count = 3;
	const entries = Buffer.alloc(count * 0x18, 0x00);
	entries.writeUInt32LE(layerName, 0x00);
	entries.writeInt32LE(-1, 0x08);
	entries.writeInt32LE(-1, 0x0c);
	entries.writeUInt32LE(filenameName, 0x18);
	entries.writeInt32LE(0, 0x20);
	entries.writeInt32LE(0, 0x24);
	entries.writeUInt32LE(0, 0x28);
	entries.writeUInt32LE(filenameData.length, 0x2c);
	entries.writeUInt32LE(rectName, 0x30);
	entries.writeInt32LE(0, 0x38);
	entries.writeInt32LE(0, 0x3c);
	entries.writeUInt32LE(filenameData.length, 0x40);
	entries.writeUInt32LE(rectData.length, 0x44);
	const head = Buffer.alloc(0x10, 0x00);
	head.write("CDBD", 0, "latin1");
	head.writeInt32LE(count, 4);
	// The count of the places of the file the table of the layers itself stands of: the places of the table
	// of it and then the names of the places of it, of the places of the fields of the layers behind them.
	head.writeUInt32LE(count * 0x18 + names.length, 8);
	head.writeUInt32LE(info.length, 12);
	return Buffer.concat([head, entries, names, info]);
}

/** A picture of the engine of four bytes a pixel, all of one colour. */
function plainPicture(width: number, height: number): Buffer {
	const body = walk(
		literals(Array.from({ length: width * height * 4 }, () => 0x33)),
	);
	return buildPgx({ width, height, bits: 32, body });
}

describe("Glib2 engine image format", () => {
	it("unpacks the run the Glib engine's own walk reads", () => {
		// Four bytes stand as they are, and a copy takes them back from the frame's own first byte.
		const stream = walk([...literals([0x41, 0x42, 0x43, 0x44]), copyOfFirst()]);
		expect([...stream]).toEqual([0x0f, 0x41, 0x42, 0x43, 0x44, 0xee, 0xfe]);
		const out = Buffer.alloc(8, 0x00);
		unpackGlibLzss(stream, 0, out, out.length);
		expect([...out]).toEqual([0x41, 0x42, 0x43, 0x44, 0x41, 0x42, 0x43, 0x44]);
	});

	it("wraps the frame the walk reads back from", () => {
		// Eighteen bytes stand as they are, so the frame's cursor passes its own end, and a copy then reads
		// the frame from its first byte - where the very first of those bytes still stands.
		const values = Array.from({ length: 18 }, (_, index) => index);
		const stream = walk([...literals(values), copyOfFirst()]);
		const out = Buffer.alloc(22, 0x00);
		unpackGlibLzss(stream, 0, out, out.length);
		expect([...out]).toEqual([...values, 0, 1, 2, 3]);
	});

	it("reads the head of the picture", () => {
		const body = Buffer.alloc(4, 0x00);
		expect(
			readPgxLayout(
				buildPgx({ width: 4, height: 3, bits: 0, flags: 0x1000, body }),
			),
		).toMatchObject({ width: 4, height: 3, bitsPerPixel: 24, flags: 0x1000 });
		expect(
			readPgxLayout(buildPgx({ width: 4, height: 3, bits: 1, body })),
		).toMatchObject({ bitsPerPixel: 32 });
	});

	it("unpacks a picture of four bytes a pixel", async () => {
		const body = walk(
			literals(Array.from({ length: 16 }, (_, index) => 0x10 + index)),
		);
		const out = await extract(buildPgx({ width: 2, height: 2, bits: 1, body }));
		expect(pixels(out)).toEqual(
			Buffer.from(Array.from({ length: 16 }, (_, index) => 0x10 + index)),
		);
	});

	it("draws a picture of three bytes a pixel together again", async () => {
		const body = walk(
			literals([0x01, 0x02, 0x03, 0xff, 0x04, 0x05, 0x06, 0xff]),
		);
		const out = await extract(buildPgx({ width: 2, height: 1, bits: 0, body }));
		// The fourth byte of every pixel is dropped, since the picture keeps three.
		expect(pixels(out)).toEqual(
			Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]),
		);
		const image = readBmpImage(out);
		expect(image).toMatchObject({ width: 2, height: 1, bitsPerPixel: 24 });
	});

	it("steps over the block of the engine's own information", async () => {
		// The information block stands in front of the picture: its own head, then a run of four bytes that
		// is unpacked and left aside, and only then the picture's own run.
		const info = Buffer.alloc(0x10, 0x00);
		info.writeInt32LE(4, 12);
		const out = await extract(
			buildPgx({
				width: 1,
				height: 1,
				bits: 1,
				flags: 0x1000,
				body: Buffer.concat([
					info,
					walk(literals([0xaa, 0xbb, 0xcc, 0xdd])),
					walk(literals([0x01, 0x02, 0x03, 0xff])),
				]),
			}),
		);
		expect(pixels(out)).toEqual(Buffer.from([0x01, 0x02, 0x03, 0xff]));
	});

	it("turns away a file that is not a picture of this engine", () => {
		const good = buildPgx({
			width: 2,
			height: 1,
			bits: 1,
			body: Buffer.alloc(4, 0x00),
		});
		const wrongWord = Buffer.from(good);
		wrongWord.write("XXX\0", 0, "latin1");
		expect(readPgxLayout(wrongWord)).toBeUndefined();
		const noSize = Buffer.from(good);
		noSize.writeUInt32LE(0, 8);
		expect(readPgxLayout(noSize)).toBeUndefined();
		expect(readPgxLayout(good.subarray(0, HEADER_SIZE - 1))).toBeUndefined();
	});

	it("reads the place of a picture of the table of the layers beside it", () => {
		const table = stxFile({
			layer: "cg",
			picture: "cg.pgx",
			left: 7,
			top: 9,
			right: 40,
			bottom: 30,
		});
		expect(readStxLayer(table, "cg.pgx")).toEqual({ offsetX: 7, offsetY: 9 });
		// A picture the table names no layer of stands of no place of its own.
		expect(readStxLayer(table, "other.pgx")).toBeUndefined();
		// A table that stands of no word of its own stands of no place at all.
		const wrong = Buffer.from(table);
		wrong.write("XXXX", 0, "latin1");
		expect(readStxLayer(wrong, "cg.pgx")).toBeUndefined();
	});

	it("reads a picture of the engine of the place the table of the layers names", async () => {
		const directory = await temporaryDirectory();
		const picturePath = resolve(directory, "cg.pgx");
		await writeFile(picturePath, plainPicture(2, 2));
		await writeFile(
			resolve(directory, "info"),
			stxFile({
				layer: "cg",
				picture: "cg.pgx",
				left: 11,
				top: 13,
				right: 30,
				bottom: 20,
			}),
		);
		const handle = await g2PgxImageFormat.open(
			await FileByteSource.open(picturePath),
			picturePath,
		);
		expect(handle.entries[0]?.metadata).toMatchObject({
			offsetX: 11,
			offsetY: 13,
		});
	});

	it("reads a picture of no table of the layers beside it of no place of its own", async () => {
		const directory = await temporaryDirectory();
		const picturePath = resolve(directory, "cg.pgx");
		await writeFile(picturePath, plainPicture(2, 2));
		const handle = await g2PgxImageFormat.open(
			await FileByteSource.open(picturePath),
			picturePath,
		);
		expect(handle.entries[0]?.metadata?.offsetX).toBeUndefined();
		expect(handle.entries[0]?.metadata?.offsetY).toBeUndefined();
	});

	it("is told by the word of the picture", async () => {
		expect(g2PgxImageFormat.descriptor.id).toBe("g2-pgx-image");
		const good = buildPgx({
			width: 1,
			height: 1,
			bits: 1,
			body: walk(literals([0, 0, 0, 0])),
		});
		expect(
			await g2PgxImageFormat.detect(new BufferByteSource(good), "picture.pgx"),
		).toBe(true);
		await expect(
			g2PgxImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"picture.pgx",
			),
		).rejects.toThrow(GarbroError);
	});
});
