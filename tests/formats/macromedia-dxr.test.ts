// The movie of the Macromedia Director engine, against movies built in the test: the word of the head of the
// movie of the engine (of the counts of the places of the engine of the walk of the engine of the places of
// the picture of the engine of the count of the places of the engine itself), the word of the kind of the
// walk of the engine, the counts of the places of the picture of the engine (`imap` and `mmap`), the counts
// of the walk of the engine of the places of the picture of the engine the reference lists as they stand, and
// the counts of the places of the picture of the engine of a text of the movie.
import { Buffer } from "node:buffer";
import { deflateSync, inflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import {
	readBmpImage,
	type BmpImage,
} from "../../packages/formats/src/shared/bmp.js";
import { DirectorReader } from "@garbro-mcp/formats";
import {
	macromediaDxrArchiveFormat,
	readDirectorConfig,
	readDirectorKeyTable,
	readDirectorMovie,
} from "@garbro-mcp/formats";
import { GREY_JPEG, GREY_PIXELS } from "../helpers/jpeg.js";
import { pngFile } from "../helpers/png.js";
import { describe, expect, it } from "vitest";

const MAP_HEAD_SIZE = 0x18;
const MAP_ENTRY_SIZE = 0x14;

interface ChunkInput {
	fourCC: string;
	body?: Buffer;
}

interface MovieInput {
	word?: string;
	codec?: string;
	chunks: ChunkInput[];
}

/** A movie of the engine: the head of it, the counts of the places of the picture of the engine and them. */
function dxrMovie(input: MovieInput): Buffer {
	const littleEndian = "XFIR" === (input.word ?? "XFIR");
	const codec = Buffer.from(input.codec ?? "MV93", "latin1");
	const mapAt = 12 + 4 + 8 + 4;
	const headerAt = mapAt + 8;
	const entriesAt = headerAt + MAP_HEAD_SIZE;
	const bodiesAt = entriesAt + input.chunks.length * MAP_ENTRY_SIZE;
	const size =
		bodiesAt +
		input.chunks.reduce((total, chunk) => total + (chunk.body?.length ?? 0), 0);
	const movie = Buffer.alloc(Math.ceil(size / 4) * 4, 0);
	// The counts of the walk of the engine of the places of the picture of the engine stand of the counts of
	// the places of the engine of the walk of the engine of the counts of them, which the word of the head of
	// the movie of the engine names.
	const u16 = (value: number, at: number): void => {
		if (littleEndian) movie.writeUInt16LE(value, at);
		else movie.writeUInt16BE(value, at);
	};
	const u32 = (value: number, at: number): void => {
		if (littleEndian) movie.writeUInt32LE(value, at);
		else movie.writeUInt32BE(value, at);
	};
	movie.write(input.word ?? "XFIR", 0, "latin1");
	u32(size, 4);
	codec.copy(movie, 8);
	movie.write("imap", 12, "latin1");
	u32(mapAt, 12 + 4 + 8);
	movie.write("mmap", mapAt, "latin1");
	u16(MAP_HEAD_SIZE, headerAt);
	u16(MAP_ENTRY_SIZE, headerAt + 2);
	u32(input.chunks.length, headerAt + 4);
	u32(input.chunks.length, headerAt + 8);
	u32(0, headerAt + 0x14);
	let at = bodiesAt;
	for (const [index, chunk] of input.chunks.entries()) {
		const entryAt = entriesAt + index * MAP_ENTRY_SIZE;
		Buffer.from(chunk.fourCC.padEnd(4, "\0").slice(0, 4), "latin1").copy(
			movie,
			entryAt,
		);
		u32(chunk.body?.length ?? 0, entryAt + 4);
		// The counts of the places of the picture of the engine of a count of the walk of the engine of the
		// engine itself stand of the counts of the walk of the engine of the places of the head of the movie
		// of the engine.
		u32(at - 8, entryAt + 8);
		u16(0, entryAt + 0x0c);
		u32(0, entryAt + 0x0e);
		if (chunk.body) chunk.body.copy(movie, at);
		at += chunk.body?.length ?? 0;
	}
	return movie;
}

/** The counts of the places of the picture of the engine of a text of a movie of the engine. */
function textChunk(text: string): Buffer {
	const body = Buffer.alloc(8 + text.length, 0);
	body.writeUInt32BE(8, 0);
	body.writeUInt32BE(text.length, 4);
	body.write(text, 8, "latin1");
	return body;
}

/** The counts of the keys of the picture of the engine of a movie of the engine. */
function keyChunk(
	entries: { id: number; castId: number; fourCC: string }[],
	littleEndian: boolean,
	used: number,
): Buffer {
	const body = Buffer.alloc(0x0c + entries.length * 0x0c, 0);
	const u32 = (value: number, at: number): void => {
		if (littleEndian) body.writeUInt32LE(value, at);
		else body.writeUInt32BE(value, at);
	};
	u32(0x0c, 0);
	u32(entries.length, 4);
	u32(used, 8);
	for (const [index, entry] of entries.entries()) {
		const at = 0x0c + index * 0x0c;
		u32(entry.id, at);
		u32(entry.castId, at + 4);
		Buffer.from(entry.fourCC.padEnd(4, "\0").slice(0, 4), "latin1").copy(
			body,
			at + 8,
		);
	}
	return body;
}

/** The counts of the places of the picture of the engine of a movie of the engine of the engine itself. */
function configChunk(input: {
	version: number;
	frameRate: number;
	platform: number;
	bitDepth: number;
	stageTop: number;
	stageLeft: number;
	stageBottom: number;
	stageRight: number;
	palette: number;
	paletteNew?: number;
}): Buffer {
	// The reference stands of the counts of the places of the picture of the engine of the movie of the
	// engine of the counts of the engine of the walk of the engine itself, of every count of the walk of the
	// engine of the places of the picture of the engine of the movie of the engine.
	const body = Buffer.alloc(0x60, 0);
	body.writeInt16BE(0x20, 0);
	body.writeInt16BE(1000, 2);
	body.writeInt16BE(input.stageTop, 4);
	body.writeInt16BE(input.stageLeft, 6);
	body.writeInt16BE(input.stageBottom, 8);
	body.writeInt16BE(input.stageRight, 10);
	body.writeInt16BE(1, 0x0c);
	body.writeInt16BE(100, 0x0e);
	body.writeUInt16BE(0x1234, 0x1a);
	body.writeUInt16BE(input.bitDepth, 0x1c);
	body.writeUInt16BE(input.frameRate, 0x36);
	body.writeInt16BE(input.platform, 0x38);
	body.writeUInt32BE(0xfeed, 0x40);
	body.writeUInt16BE(input.version, 0x24);
	body.writeUInt16BE(input.palette, 0x46);
	body.writeUInt16BE(input.paletteNew ?? 0, 0x4e);
	return body;
}

const CONFIG_VALUES = {
	version: 1200,
	frameRate: 24,
	platform: 2,
	bitDepth: 8,
	stageTop: 3,
	stageLeft: 0,
	stageBottom: 0x140,
	stageRight: 0xa,
	palette: 0x11,
	paletteNew: 0x22,
};

/** The counts of the walk of the engine of the counts of the places of the picture of the engine. */
function varInt(value: number): Buffer {
	const bytes: number[] = [];
	let rest = value >>> 0;
	do {
		bytes.unshift(rest & 0x7f);
		rest >>>= 7;
	} while (rest > 0);
	for (let at = 0; at < bytes.length - 1; at += 1)
		bytes[at] = (bytes[at] ?? 0) | 0x80;
	return Buffer.from(bytes);
}

/** A count of the walk of the engine of the places of the picture of the engine of the engine itself. */
function abChunk(fourCC: string, body: Buffer): Buffer {
	return Buffer.concat([
		Buffer.from(fourCC, "latin1"),
		varInt(body.length),
		body,
	]);
}

interface ABChunkInput {
	id: number;
	fourCC: string;
	body: Buffer;
	/** The counts of the places of the picture of the engine stand of the counts of the walk of the engine. */
	packed?: boolean;
	/** The place of the counts of the walk of the engine of the places of the picture of the engine behind it. */
	inIls?: boolean;
}

/** A movie of the engine of the counts of the places of the picture of the engine of the engine itself. */
function abMovie(input: { chunks: ABChunkInput[]; word?: string }): Buffer {
	const littleEndian = "XFIR" === (input.word ?? "XFIR");
	const head = Buffer.alloc(12, 0);
	head.write(input.word ?? "XFIR", 0, "latin1");
	head.write("FGDM", 8, "latin1");
	const fver = abChunk("Fver", varInt(0x400));
	const fcdr = abChunk("Fcdr", varInt(0));
	// The counts of the walk of the engine of the places of the picture of the engine of the counts of the
	// walk of the engine of the places of them stand of the counts of the walk of the engine of the places
	// of the picture of the engine that stand behind the counts of the walk of the engine of the engine
	// itself: the counts of the walk of the engine of the counts of the places of the picture of the engine
	// name the counts of the walk of the engine of the places of the picture of the engine of the engine
	// itself and then stand of the counts of the walk of the engine of the places of the picture of the
	// engine of the counts of the walk of the engine of the places of them.
	const fgei = Buffer.concat([Buffer.from("FGEI", "latin1"), varInt(0)]);
	const ilsBytes = Buffer.concat(
		input.chunks
			.filter((chunk) => chunk.inIls)
			.map((chunk) => Buffer.concat([varInt(chunk.id), chunk.body])),
	);
	const ils = deflateSync(ilsBytes);
	const baseOffset = head.length + fver.length + fcdr.length + fgei.length;
	const bodiesAt = baseOffset + ils.length;
	// The counts of the places of the picture of the engine stand of the counts of the walk of the engine of
	// the places of the picture of the engine that stand behind the counts of the walk of the engine of the
	// engine itself, and of the counts of the walk of the engine of the places of the picture of the engine
	// of the engine itself themselves.
	const stored: Buffer[] = [];
	const offsets = new Map<number, number>();
	let at = bodiesAt;
	for (const chunk of input.chunks) {
		if (chunk.inIls) continue;
		offsets.set(chunk.id, at - baseOffset);
		stored.push(chunk.body);
		at += chunk.body.length;
	}
	const mapBytes = Buffer.concat([
		varInt(0),
		varInt(0),
		varInt(input.chunks.length),
		...input.chunks.map((chunk) =>
			Buffer.concat([
				varInt(chunk.id),
				varInt(chunk.inIls ? -1 : (offsets.get(chunk.id) ?? 0)),
				varInt(chunk.body.length),
				// The counts of the walk of the engine of the places of the picture of the engine of the
				// engine itself stand of the counts of the places of the picture of the engine of the counts
				// of the walk of the engine of the places of them.
				varInt(
					2 === chunk.id
						? ilsBytes.length
						: chunk.packed
							? 0x200
							: chunk.body.length,
				),
				varInt(0),
				Buffer.from(chunk.fourCC.padEnd(4, "\0").slice(0, 4), "latin1"),
			]),
		),
	]);
	const map = abChunk(
		"ABMP",
		Buffer.concat([varInt(0), varInt(mapBytes.length), deflateSync(mapBytes)]),
	);
	const movie = Buffer.concat([head, fver, fcdr, map, fgei, ils, ...stored]);
	movie.writeUInt32LE(movie.length, 4);
	if (!littleEndian) movie.writeUInt32BE(movie.length, 4);
	return movie;
}

/** The counts of the places of the picture of the engine of a count of the counts of the places of them. */
function castInfo(input: { name: string; source: string }): Buffer {
	const items = [
		Buffer.from(`${input.source}\0`, "latin1"),
		Buffer.concat([
			Buffer.from([input.name.length]),
			Buffer.from(input.name, "latin1"),
		]),
	];
	const offsets: number[] = [];
	let at = 0;
	for (const item of items) {
		offsets.push(at);
		at += item.length;
	}
	const table = Buffer.alloc(2 + offsets.length * 4 + 4, 0);
	table.writeUInt16BE(offsets.length, 0);
	for (const [index, offset] of offsets.entries())
		table.writeInt32BE(offset, 2 + index * 4);
	table.writeInt32BE(at, 2 + offsets.length * 4);
	const head = Buffer.alloc(0x14, 0);
	// The counts of the walk of the engine of the counts of the places of the picture of the engine of the
	// counts of the walk of the engine of the places of them stand of the counts of the places of the head of
	// the counts of the places of the picture of the engine of the engine itself.
	head.writeUInt32BE(0x14, 0);
	return Buffer.concat([head, table, ...items]);
}

/** A count of the places of the picture of the engine of a cast of a movie of the engine. */
function castMember(input: {
	type: number;
	info: Buffer;
	specific: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x0c, 0);
	head.writeInt32BE(input.type, 0);
	head.writeInt32BE(input.info.length, 4);
	head.writeInt32BE(input.specific.length, 8);
	return Buffer.concat([head, input.info, input.specific]);
}

/** The counts of the places of the picture of the engine of a cast of a movie of the engine. */
function castIndex(ids: number[]): Buffer {
	const body = Buffer.alloc(ids.length * 4, 0);
	for (const [index, id] of ids.entries()) body.writeInt32BE(id, index * 4);
	return body;
}

/** The counts of the walk of the engine of the places of the picture of the engine of the counts of them. */
function castList(input: { id: number; name: string; path: string }): Buffer {
	const item = (text: string): Buffer =>
		Buffer.concat([Buffer.from([text.length]), Buffer.from(text, "latin1")]);
	const items = [
		Buffer.alloc(0),
		item(input.name),
		item(input.path),
		Buffer.alloc(2, 0),
		Buffer.alloc(8, 0),
	];
	const offsets: number[] = [];
	let at = 0;
	for (const one of items) {
		offsets.push(at);
		at += one.length;
	}
	const head = Buffer.alloc(0x0c, 0);
	head.writeUInt32BE(0x0c, 0);
	head.writeUInt16BE(1, 6);
	head.writeUInt16BE(4, 8);
	const table = Buffer.alloc(2 + offsets.length * 4 + 4, 0);
	table.writeUInt16BE(offsets.length, 0);
	for (const [index, offset] of offsets.entries())
		table.writeInt32BE(offset, 2 + index * 4);
	table.writeInt32BE(at, 2 + offsets.length * 4);
	// The counts of the places of the picture of the engine of the counts of them that stand of the counts
	// of the walk of the engine of the places of the picture of the engine of the counts of the engine itself.
	items[4]?.writeUInt16BE(1, 0);
	items[4]?.writeUInt16BE(0x100, 2);
	items[4]?.writeInt32BE(input.id, 4);
	return Buffer.concat([head, table, ...items]);
}

/** The counts of the places of a picture of the engine of a count of the walk of the engine of them. */
function bitmapData(input: {
	palette: number;
	bitDepth: number;
	top?: number;
	left?: number;
	bottom?: number;
	right?: number;
	depthType?: number;
}): Buffer {
	const data = Buffer.alloc(0x1c, 0);
	data.writeUInt8(input.depthType ?? 0, 0);
	data.writeUInt8(0, 1);
	data.writeInt16BE(input.top ?? 0, 2);
	data.writeInt16BE(input.left ?? 0, 4);
	data.writeInt16BE(input.bottom ?? 0x40, 6);
	data.writeInt16BE(input.right ?? 0x40, 8);
	data.writeUInt16BE(input.bitDepth, 0x16);
	data.writeInt16BE(input.palette, 0x1a);
	return data;
}

/** A count of the places of the picture of the engine of a cast of the counts of the engine itself. */
function castMemberOld(input: {
	type: number;
	info: Buffer;
	specific: Buffer;
}): Buffer {
	// The counts of the places of the picture of the engine of the counts of the walk of the engine of the
	// places of the picture of the engine stand of the counts of the walk of the engine of the counts of the
	// engine itself: the counts of the walk of the engine of the places of the picture of the engine of the
	// counts of them stand of the counts of the walk of the engine of the places of the picture of the engine
	// where the counts of the places of the picture of the engine stand of counts of the engine itself.
	const withFlags = input.specific.length > 0;
	// The counts of the places of the picture of the engine of the counts of the walk of the engine of the
	// places of the picture of the engine stand of the counts of the walk of the engine of the counts of the
	// engine itself: the counts of the places of the picture of the engine of the counts of them stand of the
	// counts of the places of the picture of the engine of the count of the walk of the engine itself and of
	// the counts of the walk of the engine of the places of the picture of the engine of the counts of the
	// engine itself, where they stand.
	const dataLength = input.specific.length + (withFlags ? 2 : 1);
	const head = Buffer.alloc(withFlags ? 8 : 7, 0);
	head.writeUInt16BE(dataLength, 0);
	head.writeInt32BE(input.info.length, 2);
	head.writeUInt8(input.type, 6);
	return Buffer.concat([head, input.specific, input.info]);
}

/** The counts of the places of a sound of the engine of the counts of the walk of the engine of them. */
function soundHead(input: {
	channels: number;
	sampleRate: number;
	average: number;
	blockAlign: number;
	bits: number;
}): Buffer {
	const head = Buffer.alloc(0x54, 0);
	head.writeUInt32BE(input.sampleRate, 0x2c);
	head.writeUInt32BE(input.average, 0x30);
	head.writeUInt32BE(input.bits, 0x44);
	head.writeUInt32BE(input.channels, 0x4c);
	head.writeUInt32BE(input.blockAlign, 0x50);
	return head;
}

async function extract(data: Buffer, name: string): Promise<Buffer> {
	const handle = await macromediaDxrArchiveFormat.open(
		new BufferByteSource(data),
		"movie.dxr",
	);
	try {
		const entry = handle.entries.find((candidate) => candidate.path === name);
		if (!entry) throw new Error(`no entry ${name}`);
		return consumeBuffer(await handle.openEntry(entry.id));
	} finally {
		await handle.close();
	}
}

describe("Macromedia Director movie", () => {
	it("stands of the counts of the places of the picture of the engine of the head of it", () => {
		const data = dxrMovie({
			chunks: [
				{ fourCC: "STXT", body: textChunk("Hello") },
				{ fourCC: "Lscr", body: Buffer.from([1, 2, 3]) },
				{ fourCC: "BITD", body: Buffer.from([9]) },
			],
		});
		const movie = readDirectorMovie(data);
		expect(movie).toMatchObject({
			codec: "MV93",
			littleEndian: true,
			burned: false,
		});
		expect(movie?.directory).toHaveLength(3);
		expect(movie?.directory.map((entry) => entry.fourCC)).toEqual([
			"STXT",
			"Lscr",
			"BITD",
		]);
		expect(movie?.directory[0]?.size).toBe(13);
		// The counts of the places of the picture of the engine of a count of the walk of the engine of the
		// engine itself stand of the counts of the walk of the engine of the places of the head of the movie
		// of the engine, which stand in front of them.
		const at = movie?.directory[0]?.offset ?? 0;
		// The counts of the places of the picture of the engine of a count of the walk of the engine of the
		// count of the walk of the engine itself stand of the counts of the walk of the engine of the places
		// of the picture of the engine of the count of them, which stand in front of them.
		expect(data.toString("latin1", at + 8, at + 12)).toBe("Hell");
	});

	it("lists the counts of the walk of the engine of the places of the picture of the engine", async () => {
		const data = dxrMovie({
			chunks: [
				{ fourCC: "STXT", body: textChunk("Hello") },
				{ fourCC: "Lscr", body: Buffer.from([1, 2, 3]) },
				{ fourCC: "BITD", body: Buffer.from([9]) },
				{ fourCC: "File", body: Buffer.from([7, 7]) },
			],
		});
		expect(
			await macromediaDxrArchiveFormat.detect(
				new BufferByteSource(data),
				"movie.dxr",
			),
		).toBe(true);
		const handle = await macromediaDxrArchiveFormat.open(
			new BufferByteSource(data),
			"movie.dxr",
		);
		try {
			// The counts of the places of the picture of the engine of the movie of the engine stand of the
			// counts of the walk of the engine of the places of the picture of the engine that stand of the
			// counts of the walk of the engine of the engine itself alone.
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"000000.STXT",
				"000001.Lscr",
				"000003.File",
			]);
			expect(handle.metadata).toMatchObject({ codec: "MV93", chunks: 4 });
		} finally {
			await handle.close();
		}
		// The counts of the places of the picture of the engine of the count of the walk of the engine of the
		// engine itself stand of the counts of the walk of the engine of the places of the word of the head of
		// the movie of the engine and of the counts of the places of it.
		const file = await extract(data, "000003.File");
		expect(file).toHaveLength(10);
		expect([...file.subarray(8)]).toEqual([7, 7]);
		// The counts of the places of the picture of the engine of a text of the movie of the engine stand of
		// the counts of the walk of the engine of the places of the picture of the engine of the count of the
		// walk of the engine itself.
		const text = await extract(data, "000000.STXT");
		expect(text.toString("latin1")).toBe("Hello");
		const script = await extract(data, "000001.Lscr");
		expect([...script]).toEqual([1, 2, 3]);
	});

	it("stands of the counts of the places of the picture of the engine of a movie of the engine of the words of the engine itself", () => {
		// The counts of the walk of the engine of the places of the picture of the engine of a movie of the
		// engine stand of the counts of the places of the engine of the walk of the engine of the counts of
		// them, of every word of the head of the movie of the engine.
		const data = dxrMovie({
			word: "RIFX",
			chunks: [{ fourCC: "Lscr", body: Buffer.from([4, 5]) }],
		});
		expect(readDirectorMovie(data)).toMatchObject({
			codec: "MV93",
			littleEndian: false,
		});
	});

	it("turns away a movie of the engine of no counts of the walk of the engine at all", async () => {
		expect(
			readDirectorMovie(Buffer.from("NotAMovie", "latin1")),
		).toBeUndefined();
		const other = dxrMovie({ codec: "XXXX", chunks: [] });
		expect(readDirectorMovie(other)).toBeUndefined();
		// The counts of the walk of the engine of a movie of the engine of the counts of the places of the
		// picture of the engine of the engine itself stand of the counts of the walk of the engine of the
		// engine itself, which a movie of the engine of no counts of them at all stands of none of.
		const burned = dxrMovie({ codec: "FGDM", chunks: [] });
		expect(readDirectorMovie(burned)).toBeUndefined();
		expect(
			await macromediaDxrArchiveFormat.detect(
				new BufferByteSource(burned),
				"movie.dxr",
			),
		).toBe(false);
		await expect(
			macromediaDxrArchiveFormat.open(
				new BufferByteSource(burned),
				"movie.dxr",
			),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
		// A movie of the engine of no counts of the places of the picture of the engine at all stands of no
		// movie of the engine at all.
		const noMap = dxrMovie({
			chunks: [{ fourCC: "Lscr", body: Buffer.from([1]) }],
		});
		noMap.write("XXXX", 12, "latin1");
		expect(readDirectorMovie(noMap)).toBeUndefined();
		const shortHeader = dxrMovie({
			chunks: [{ fourCC: "Lscr", body: Buffer.from([1]) }],
		});
		shortHeader.writeUInt16LE(0x10, 12 + 4 + 8 + 4 + 8);
		expect(readDirectorMovie(shortHeader)).toBeUndefined();
		const shortEntry = dxrMovie({
			chunks: [{ fourCC: "Lscr", body: Buffer.from([1]) }],
		});
		shortEntry.writeUInt16LE(0x10, 12 + 4 + 8 + 4 + 8 + 2);
		expect(readDirectorMovie(shortEntry)).toBeUndefined();
		await expect(
			macromediaDxrArchiveFormat.open(
				new BufferByteSource(Buffer.from("NotAMovie", "latin1")),
				"movie.dxr",
			),
		).rejects.toThrowError(GarbroError);
	});

	it("stands of the keys of the picture of the engine and the counts of the places of the movie", async () => {
		const data = dxrMovie({
			chunks: [
				{ fourCC: "Lscr", body: Buffer.from([1, 2, 3]) },
				{
					fourCC: "KEY*",
					body: keyChunk(
						[
							{ id: 1, castId: 0x400, fourCC: "CAS*" },
							{ id: 2, castId: 0x400, fourCC: "BITD" },
						],
						true,
						1,
					),
				},
				{ fourCC: "VWCF", body: configChunk(CONFIG_VALUES) },
			],
		});
		const movie = readDirectorMovie(data);
		// The reference names the count of the keys the movie of the engine stands of and then stands of the
		// whole of the table of them.
		expect(movie?.keyTable).toMatchObject({
			entrySize: 0x0c,
			totalCount: 2,
			usedCount: 1,
		});
		expect(movie?.keyTable?.table).toEqual([
			{ id: 1, castId: 0x400, fourCC: "CAS*" },
			{ id: 2, castId: 0x400, fourCC: "BITD" },
		]);
		expect(movie?.config).toMatchObject({
			version: 1200,
			frameRate: 24,
			platform: 2,
			bitDepth: 8,
			minMember: 1,
			maxMember: 100,
			defaultPalette: 0x11,
		});
		// The counts of the places of the picture of the engine of the movie of the engine stand of the counts
		// of the places of the picture of the engine of the engine itself.
		configChunk(CONFIG_VALUES);
		const handle = await macromediaDxrArchiveFormat.open(
			new BufferByteSource(data),
			"movie.dxr",
		);
		try {
			expect(handle.metadata).toMatchObject({
				version: 1200,
				frameRate: 24,
				platform: 2,
				bitDepth: 8,
				// The counts of the places of the picture of the engine of the movie of the engine stand of
				// the counts of the walk of the engine of the places of the picture of the engine of the
				// counts of the walk of the engine of the places of the picture of the engine itself.
				stageHeight: 0x140 - 3,
				stageWidth: 0xa,
				keys: 2,
			});
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"000000.Lscr",
			]);
		} finally {
			await handle.close();
		}
	});

	it("stands of the counts of the places of the picture of the engine of the engine itself", () => {
		// The counts of the places of the picture of the engine of the movie of the engine stand of the
		// counts of the engine of the walk of the engine itself, every time the counts of the places of the
		// picture of the engine of the movie of the engine of its own.
		for (const word of ["XFIR", "RIFX"]) {
			const data = dxrMovie({
				word,
				chunks: [{ fourCC: "VWCF", body: configChunk(CONFIG_VALUES) }],
			});
			expect(readDirectorMovie(data)?.config).toMatchObject({
				version: 1200,
				frameRate: 24,
				defaultPalette: 0x11,
			});
		}
		// The counts of the places of the picture of the engine of the movie of the engine of the counts of
		// the walk of the engine of the places of it stand of the counts of the walk of the engine of the
		// counts of the places of the picture of the engine of the counts of the engine itself.
		const newer = dxrMovie({
			chunks: [
				{
					fourCC: "VWCF",
					body: configChunk({ ...CONFIG_VALUES, version: 1300 }),
				},
			],
		});
		expect(readDirectorMovie(newer)?.config).toMatchObject({
			version: 1300,
			defaultPalette: 0x22,
		});
		// A count of the places of the picture of the engine of the movie of the engine that stands behind the
		// counts of the walk of the engine of the places of the picture of the engine of the movie of the
		// engine stands of no counts of them at all.
		const short = dxrMovie({
			chunks: [
				{ fourCC: "VWCF", body: configChunk(CONFIG_VALUES).subarray(0, 0x40) },
			],
		});
		expect(readDirectorMovie(short)?.config).toBeUndefined();
		// A count of the places of the picture of the engine of the keys of the picture of the engine that
		// stands behind the counts of the walk of the engine of the places of the table of them stands of no
		// counts of them at all.
		const shortKeys = dxrMovie({
			chunks: [
				{
					fourCC: "KEY*",
					body: keyChunk(
						[{ id: 1, castId: 0x400, fourCC: "CAS*" }],
						true,
						1,
					).subarray(0, 0x14),
				},
			],
		});
		expect(readDirectorMovie(shortKeys)?.keyTable).toBeUndefined();
		// The counts of the walk of the engine of the places of the picture of the engine of the counts of the
		// walk of the engine of the counts of the places of the picture of the engine of the movie of the
		// engine stand of the counts of the walk of the engine of the places of the head of the movie.
		const reader = new DirectorReader(configChunk(CONFIG_VALUES), false);
		expect(readDirectorConfig(reader)?.stageBottom).toBe(0x140);
		expect(
			readDirectorKeyTable(new DirectorReader(Buffer.alloc(8, 0), true)),
		).toBeUndefined();
	});

	it("stands of the counts of the walk of the engine of the places of the picture of the engine", async () => {
		// The counts of the places of the picture of the engine of the counts of the walk of the engine of the
		// engine itself stand of the counts of the walk of the engine of the engine itself, of the counts of
		// the walk of the engine of the places of the picture of the engine of the engine itself, of the
		// counts of the places of the picture of the engine of the movie of the engine and of the counts of
		// the walk of the engine of the places of the picture of the engine of the counts of the walk of the
		// engine of the places of them.
		const packed = inflateSync(deflateSync(Buffer.from([1, 2, 3, 4])));
		const data = abMovie({
			chunks: [
				{ id: 2, fourCC: "ILS ", body: Buffer.alloc(0) },
				{ id: 3, fourCC: "Lscr", body: Buffer.from([9, 8, 7]) },
				{
					id: 4,
					fourCC: "Lscr",
					body: deflateSync(packed),
					packed: true,
				},
				{ id: 5, fourCC: "STXT", body: textChunk("Hello"), inIls: true },
			],
		});
		// The counts of the places of the picture of the engine of the counts of the walk of the engine of the
		// engine itself stand of the counts of the walk of the engine of the places of the picture of the
		// engine of the engine itself: the counts of the walk of the engine of a movie of the engine that
		// stand of no counts of the walk of the engine at all stand of no counts of them at all.
		const broken = abMovie({
			chunks: [{ id: 2, fourCC: "ILS ", body: Buffer.alloc(0) }],
		});
		broken.write("XXXX", 8, "latin1");
		void broken;
		// hmm
		const movie = readDirectorMovie(data);
		expect(movie?.burned).toBe(true);
		expect(
			movie?.directory.map((entry) => [entry.id, entry.fourCC, entry.packed]),
		).toEqual([
			// The counts of the walk of the engine of the places of the picture of the engine of the engine
			// itself stand of the counts of the walk of the engine of the places of the picture of the
			// engine of the counts of the walk of the engine of the places of them.
			[2, "ILS ", true],
			[3, "Lscr", false],
			[4, "Lscr", true],
			[5, "STXT", false],
		]);
		// The counts of the walk of the engine of the places of the picture of the engine of the engine
		// itself stand of the counts of the walk of the engine of the places of the movie of the engine where
		// the counts of the walk of the engine of the places of the picture of the engine stand of no counts
		// of them at all.
		expect([...(movie?.ils?.get(5) ?? Buffer.alloc(0))]).toEqual([
			...textChunk("Hello"),
		]);
		expect(movie?.ils?.has(3)).toBe(false);
		expect(
			await macromediaDxrArchiveFormat.detect(
				new BufferByteSource(data),
				"movie.dxr",
			),
		).toBe(true);
		const handle = await macromediaDxrArchiveFormat.open(
			new BufferByteSource(data),
			"movie.dxr",
		);
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"000003.Lscr",
				"000004.Lscr",
				"000005.STXT",
			]);
		} finally {
			await handle.close();
		}
		expect([...(await extract(data, "000003.Lscr"))]).toEqual([9, 8, 7]);
		// The counts of the places of a count of the walk of the engine stand of the counts of the walk of
		// the engine of the counts of the places of the picture of the engine itself.
		expect([...(await extract(data, "000004.Lscr"))]).toEqual([1, 2, 3, 4]);
		expect((await extract(data, "000005.STXT")).toString("latin1")).toBe(
			"Hello",
		);
	});

	it("turns away a movie of the engine of the counts of the walk of the engine of the engine itself", () => {
		// The counts of the walk of the engine of the places of the picture of the engine of the engine
		// itself stand of the counts of the walk of the engine of the engine itself, of the counts of the
		// walk of the engine of the places of the picture of the engine of the engine itself, of the counts
		// of the places of the picture of the engine of the movie of the engine and of the counts of the walk
		// of the engine of the places of the picture of the engine of the counts of the walk of the engine of
		// the places of them: a movie of the engine of no counts of them at all stands of no counts of the
		// walk of the engine of the places of the picture of the engine at all.
		const head = Buffer.alloc(12, 0);
		head.write("XFIR", 0, "latin1");
		head.write("FGDM", 8, "latin1");
		expect(readDirectorMovie(head)).toBeUndefined();
		const noIls = abMovie({
			chunks: [{ id: 3, fourCC: "Lscr", body: Buffer.from([1]) }],
		});
		expect(readDirectorMovie(noIls)).toBeUndefined();
		const shortMap = abMovie({
			chunks: [
				{ id: 2, fourCC: "ILS ", body: Buffer.alloc(0) },
				{ id: 3, fourCC: "Lscr", body: Buffer.from([1]) },
			],
		});
		shortMap.write("XXXXXXXX", shortMap.length - 4, "latin1");
		expect(readDirectorMovie(shortMap)).toBeUndefined();
	});

	it("stands of the counts of the places of the picture of the engine of the counts of the walk of the engine", async () => {
		// The counts of the walk of the engine of the places of the picture of the engine of the movie of the
		// engine stand of the counts of the walk of the engine of the places of the picture of the engine of
		// the counts of the places of the picture of the engine themselves and of the counts of the walk of
		// the engine of the places of every one of them.
		const bitmapMember = castMember({
			type: 1,
			info: castInfo({ name: "one:two", source: "on mouseUp" }),
			specific: bitmapData({ palette: 1, bitDepth: 8 }),
		});
		const jpegMember = castMember({
			type: 1,
			info: castInfo({ name: "", source: "" }),
			specific: Buffer.alloc(0),
		});
		const soundMember = castMember({
			type: 6,
			info: castInfo({ name: "sound", source: "" }),
			specific: Buffer.alloc(0),
		});
		const data = dxrMovie({
			chunks: [
				{
					fourCC: "VWCF",
					body: configChunk({ ...CONFIG_VALUES, version: 1300 }),
				},
				{
					fourCC: "KEY*",
					body: keyChunk(
						[
							{ id: 3, castId: 0x400, fourCC: "CAS*" },
							{ id: 7, castId: 4, fourCC: "BITD" },
							{ id: 8, castId: 4, fourCC: "ALFA" },
							{ id: 11, castId: 4, fourCC: "CLUT" },
							{ id: 9, castId: 5, fourCC: "ediM" },
							{ id: 10, castId: 6, fourCC: "snd " },
						],
						true,
						6,
					),
				},
				{
					fourCC: "MCsL",
					body: castList({ id: 0x400, name: "cast", path: "" }),
				},
				{ fourCC: "CAS*", body: castIndex([4, 5, 6]) },
				{ fourCC: "CASt", body: bitmapMember },
				{ fourCC: "CASt", body: jpegMember },
				{ fourCC: "CASt", body: soundMember },
				{ fourCC: "BITD", body: Buffer.from([1, 2, 3]) },
				{ fourCC: "ALFA", body: Buffer.from([4]) },
				{ fourCC: "ediM", body: Buffer.from([5, 6]) },
				{ fourCC: "snd ", body: Buffer.from([7, 8, 9]) },
				{ fourCC: "CLUT", body: Buffer.from([0xaa, 0xbb]) },
				{ fourCC: "Lscr", body: Buffer.from([0xaa]) },
			],
		});
		const handle = await macromediaDxrArchiveFormat.open(
			new BufferByteSource(data),
			"movie.dxr",
		);
		let paths: string[] = [];
		try {
			paths = handle.entries.map((entry) => entry.path);
		} finally {
			await handle.close();
		}
		// The names of the counts of the walk of the engine stand of the counts of the places of the picture of
		// the engine of the counts of them, of the counts of the walk of the engine of the places of the
		// picture of the engine of the counts of them that stand of no counts of them at all.
		expect(paths.slice(0, 3)).toEqual([
			"one_two.BITD",
			"000009.jpg",
			"sound.snd",
		]);
		// The counts of the walk of the engine of the places of the picture of the engine the reference lists
		// as they stand stand behind the counts of the walk of the engine of the places of the picture of the
		// engine of the counts of the places of the picture of the engine themselves.
		expect(paths.slice(3)).toEqual(["000012.Lscr"]);
		expect([...(await extract(data, "000012.Lscr"))]).toEqual([0xaa]);
		// The counts of the places of the picture of the engine of the counts of the walk of the engine stand
		// of the counts of the walk of the engine of the places of the picture of the engine of the counts of
		// the places of the picture of the engine of them.
		expect([...(await extract(data, "000009.jpg"))]).toEqual([5, 6]);
		expect([...(await extract(data, "sound.snd"))]).toEqual([7, 8, 9]);
		// The counts of the places of the picture of the engine stand of the counts of the walk of the engine
		// of the places of the picture of the engine of the counts of them, which stand of the counts of the
		// places of the picture of the engine of the counts of them.
		await expect(extract(data, "one_two.BITD")).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("stands of the counts of the places of a sound of the engine of the counts of the walk of the engine", async () => {
		// The counts of the places of a sound of the engine stand of the counts of the walk of the engine of
		// the places of the picture of the engine and of the counts of the walk of the engine of the places of
		// the picture of the engine of the counts of the engine itself, which the counts of the walk of the
		// engine of the places of the sound of the engine stand of.
		const sound = (bits: number, samples: number[]): Buffer =>
			dxrMovie({
				chunks: [
					{
						fourCC: "KEY*",
						body: keyChunk(
							[
								// The counts of the places of the picture of the engine of the counts of the walk
								// of the engine of the places of the picture of the engine stand of the counts
								// of the walk of the engine of the places of the picture of the engine of the
								// counts of them.
								{ id: 3, castId: 2, fourCC: "sndH" },
								{ id: 4, castId: 2, fourCC: "sndS" },
							],
							true,
							2,
						),
					},
					{ fourCC: "CAS*", body: castIndex([2]) },
					{
						fourCC: "CASt",
						body: castMemberOld({
							type: 6,
							info: castInfo({ name: "tune", source: "" }),
							specific: Buffer.alloc(0),
						}),
					},
					{
						fourCC: "sndH",
						body: soundHead({
							channels: 2,
							sampleRate: 22050,
							average: 88200,
							blockAlign: 4,
							bits,
						}),
					},
					{ fourCC: "sndS", body: Buffer.from(samples) },
				],
			});
		const sixteen = sound(16, [0x12, 0x34, 0x56, 0x78]);
		const wave = await extract(sixteen, "tune.snd");
		// The counts of the places of a sound of the engine stand of the counts of the engine of the walk of
		// the engine itself: the counts of the walk of the engine of the places of the picture of the engine
		// stand of the counts of the engine of the walk of the engine itself.
		expect(wave.readUInt16LE(22)).toBe(2);
		expect(wave.readUInt32LE(24)).toBe(22050);
		expect(wave.readUInt16LE(34)).toBe(16);
		expect([...wave.subarray(44)]).toEqual([0x34, 0x12, 0x78, 0x56]);
		// The counts of the places of a sound of the engine of the counts of the engine itself stand as they
		// stand.
		const eight = sound(8, [0x11, 0x22, 0x33]);
		const shortWave = await extract(eight, "tune.snd");
		expect(shortWave.readUInt16LE(34)).toBe(8);
		expect([...shortWave.subarray(44)]).toEqual([0x11, 0x22, 0x33]);
		// The counts of the places of a sound of the engine stand behind the counts of the walk of the engine
		// of the places of the picture of the engine: a count of the walk of the engine of the places of the
		// sound of the engine of no counts of them at all stands of no counts of the walk of the engine.
		const short = dxrMovie({
			chunks: [
				{
					fourCC: "KEY*",
					body: keyChunk(
						[
							{ id: 3, castId: 2, fourCC: "sndH" },
							{ id: 4, castId: 2, fourCC: "sndS" },
						],
						true,
						2,
					),
				},
				{ fourCC: "CAS*", body: castIndex([2]) },
				{
					fourCC: "CASt",
					body: castMemberOld({
						type: 6,
						info: castInfo({ name: "tune", source: "" }),
						specific: Buffer.alloc(0),
					}),
				},
				{ fourCC: "sndH", body: Buffer.alloc(8, 0) },
				{ fourCC: "sndS", body: Buffer.alloc(2, 0) },
			],
		});
		await expect(extract(short, "tune.snd")).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("stands of the counts of the places of a picture of the engine of the counts of the walk of the engine", async () => {
		// The counts of the places of the picture of the engine of the counts of the walk of the engine stand
		// of the counts of the walk of the engine of the places of the picture of the engine of the counts of
		// the walk of the engine itself, of every count of the places of the picture of the engine.
		const picture = (
			specific: Buffer,
			body: Buffer,
			extra?: { fourCC: string; body: Buffer },
		): Buffer =>
			dxrMovie({
				chunks: [
					{
						fourCC: "KEY*",
						body: keyChunk(
							[
								{ id: 3, castId: 2, fourCC: "BITD" },
								...(extra ? [{ id: 4, castId: 2, fourCC: extra.fourCC }] : []),
							],
							true,
							extra ? 2 : 1,
						),
					},
					{ fourCC: "CAS*", body: castIndex([2]) },
					{
						fourCC: "CASt",
						body: castMemberOld({
							type: 1,
							info: castInfo({ name: "art", source: "" }),
							specific,
						}),
					},
					{ fourCC: "BITD", body },
					...(extra ? [{ fourCC: extra.fourCC, body: extra.body }] : []),
				],
			});
		const read = async (data: Buffer): Promise<BmpImage> => {
			const image = readBmpImage(await extract(data, "art.BITD"));
			if (!image) throw new Error("no bitmap");
			return image;
		};
		// The counts of the places of the picture of the engine of the counts of the walk of the engine of the
		// places of the picture of the engine of the counts of the engine of the walk of the engine itself.
		const grayscale = picture(
			bitmapData({
				palette: -2,
				bitDepth: 8,
				bottom: 2,
				right: 4,
			}),
			Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
		);
		const indexed = await read(grayscale);
		expect(indexed).toMatchObject({ width: 4, height: 2, bitsPerPixel: 8 });
		expect([...indexed.pixels]).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
		// The counts of the places of the picture of the engine of the engine of the counts of the places of
		// the picture of the engine stand of the counts of the walk of the engine of the places of the picture
		// of the engine of the counts of them.
		expect([...indexed.palette.subarray(4, 8)]).toEqual([0xfe, 0xfe, 0xfe, 0]);
		// The counts of the places of the picture of the engine of the counts of the walk of the engine stand
		// of the counts of the walk of the engine of the places of the picture of the engine of the counts of
		// them where the counts of the places of the picture of the engine stand of no counts of the walk of
		// the engine of the places of the picture of the engine at all.
		const packed = picture(
			bitmapData({ palette: -2, bitDepth: 8, bottom: 2, right: 4 }),
			Buffer.from([0xfd, 0x11, 0x03, 0x22, 0x33, 0x44, 0x55]),
		);
		const rle = await read(packed);
		expect([...rle.pixels]).toEqual([
			0x11, 0x11, 0x11, 0x11, 0x22, 0x33, 0x44, 0x55,
		]);
		// The counts of the places of the picture of the engine of the counts of the engine of the walk of the
		// engine stand of the counts of the engine of the walk of the engine itself.
		const sixteen = picture(
			bitmapData({
				palette: 0,
				bitDepth: 16,
				bottom: 2,
				right: 2,
				depthType: 0x84,
			}),
			Buffer.from([0x03, 0xf8, 0x00, 0x00, 0x1f, 0x03, 0xf8, 0x00, 0x00, 0x1f]),
		);
		const colours = await read(sixteen);
		expect(colours).toMatchObject({ width: 2, height: 2, bitsPerPixel: 32 });
		// The counts of the places of the picture of the engine of the counts of the engine of the walk of the
		// engine stand of the counts of the walk of the engine of the places of the picture of the engine of
		// the counts of the engine of the walk of the engine of the counts of them.
		expect([...colours.pixels]).toEqual([
			0, 0, 0xff, 0, 0xff, 0, 0, 0, 0, 0, 0xff, 0, 0xff, 0, 0, 0,
		]);
		// The counts of the places of the picture of the engine of the counts of the walk of the engine of the
		// places of the picture of the engine of the counts of them stand of the counts of the places of the
		// picture of the engine of the engine of the counts of them.
		const withAlpha = picture(
			bitmapData({
				palette: 0,
				bitDepth: 32,
				bottom: 1,
				right: 2,
				depthType: 0x82,
			}),
			Buffer.from([0x07, 0x44, 0x00, 0x33, 0x00, 0x22, 0x00, 0x11, 0x00]),
			{ fourCC: "ALFA", body: Buffer.from([0x01, 0x80, 0x40]) },
		);
		const alpha = await read(withAlpha);
		expect(alpha).toMatchObject({ width: 2, height: 1, bitsPerPixel: 32 });
		expect([...alpha.pixels]).toEqual([0x11, 0x22, 0x33, 0x80, 0, 0, 0, 0x40]);
		// The counts of the places of the picture of the engine of the counts of the walk of the engine of the
		// places of the picture of the engine that stand behind the counts of the walk of the engine of the
		// places of the picture of the engine stand of no counts of them at all.
		const short = picture(
			bitmapData({ palette: -2, bitDepth: 8, bottom: 2, right: 4 }),
			Buffer.from([0x03, 0x11]),
		);
		await expect(extract(short, "art.BITD")).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("decodes a picture whose member carries a JPEG medium", async () => {
		// `DxrOpener.OpenImage` hands a member whose keys hold an `ediM` chunk over to the platform, which
		// reads whatever format the stream holds. Where the stream is a JPEG this port reads it with its own
		// reader of that format and hands a bitmap over; a stream of any other format stands as it is, which
		// the listing test above pins with a two-byte medium.
		const data = dxrMovie({
			chunks: [
				{
					fourCC: "KEY*",
					body: keyChunk([{ id: 3, castId: 2, fourCC: "ediM" }], true, 1),
				},
				{ fourCC: "CAS*", body: castIndex([2]) },
				{
					fourCC: "CASt",
					body: castMemberOld({
						type: 1,
						info: castInfo({ name: "art", source: "" }),
						specific: Buffer.alloc(0),
					}),
				},
				{ fourCC: "ediM", body: GREY_JPEG },
			],
		});
		const image = readBmpImage(await extract(data, "art.jpg"));
		if (!image) throw new Error("no bitmap");
		expect([image.width, image.height]).toEqual([8, 8]);
		expect([...image.pixels]).toEqual([...GREY_PIXELS]);
	});

	it("puts an alpha channel of a member into the JPEG medium it carries", async () => {
		// `DxrOpener.OpenJpeg` hands a member medium with no alpha channel to the platform and reads the JPEG
		// itself where the member carries one, putting that channel into the fourth place of every pixel
		// through the same `ALFA` walk the `BITD` pictures use.
		const alpha: number[] = [];
		for (let at = 0; at < 64; at += 1) alpha.push(at + 1);
		const data = dxrMovie({
			chunks: [
				{
					fourCC: "KEY*",
					body: keyChunk(
						[
							{ id: 3, castId: 2, fourCC: "ediM" },
							{ id: 4, castId: 2, fourCC: "ALFA" },
						],
						true,
						2,
					),
				},
				{ fourCC: "CAS*", body: castIndex([2]) },
				{
					fourCC: "CASt",
					body: castMemberOld({
						type: 1,
						info: castInfo({ name: "art", source: "" }),
						specific: Buffer.alloc(0),
					}),
				},
				{ fourCC: "ediM", body: GREY_JPEG },
				{
					fourCC: "ALFA",
					body: Buffer.concat(
						[0, 8, 16, 24, 32, 40, 48, 56].map((row) =>
							Buffer.from([0x07, ...alpha.slice(row, row + 8)]),
						),
					),
				},
			],
		});
		const image = readBmpImage(await extract(data, "art.jpg"));
		if (!image) throw new Error("no bitmap");
		const expected = Buffer.from(GREY_PIXELS);
		for (const [index, value] of alpha.entries())
			expected[index * 4 + 3] = value;
		expect([...image.pixels]).toEqual([...expected]);
	});

	it("decodes a picture whose member carries a PNG medium", async () => {
		// The platform decoder the reference hands a medium without an alpha channel to reads the PNG
		// interchange format as well, so this port does the same where the bytes are one.
		const data = dxrMovie({
			chunks: [
				{
					fourCC: "KEY*",
					body: keyChunk([{ id: 3, castId: 2, fourCC: "ediM" }], true, 1),
				},
				{ fourCC: "CAS*", body: castIndex([2]) },
				{
					fourCC: "CASt",
					body: castMemberOld({
						type: 1,
						info: castInfo({ name: "art", source: "" }),
						specific: Buffer.alloc(0),
					}),
				},
				{
					fourCC: "ediM",
					body: pngFile({
						width: 2,
						height: 1,
						colourType: 2,
						rows: [[1, 2, 3, 4, 5, 6]],
					}),
				},
			],
		});
		const image = readBmpImage(await extract(data, "art.jpg"));
		if (!image) throw new Error("no bitmap");
		expect([image.width, image.height]).toEqual([2, 1]);
		// The samples of the picture stand red, green then blue and every place of the picture stands blue,
		// green then red, which is the order both readers hand out; the fourth place stands opaque, as the
		// platform decoder leaves it for a picture of three places a pixel.
		expect([...image.pixels]).toEqual([3, 2, 1, 0xff, 6, 5, 4, 0xff]);
	});
});
