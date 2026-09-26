// The movie of the Macromedia Director engine, against movies built in the test: the word of the head of the
// movie of the engine (of the counts of the places of the engine of the walk of the engine of the places of
// the picture of the engine of the count of the places of the engine itself), the word of the kind of the
// walk of the engine, the counts of the places of the picture of the engine (`imap` and `mmap`), the counts
// of the walk of the engine of the places of the picture of the engine the reference lists as they stand, and
// the counts of the places of the picture of the engine of a text of the movie.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { DirectorReader } from "@garbro-mcp/formats";
import {
	macromediaDxrArchiveFormat,
	readDirectorConfig,
	readDirectorKeyTable,
	readDirectorMovie,
} from "@garbro-mcp/formats";
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
		// picture of the engine of the engine itself stand unported here.
		const burned = dxrMovie({ codec: "FGDM", chunks: [] });
		expect(readDirectorMovie(burned)).toMatchObject({ burned: true });
		expect(
			await macromediaDxrArchiveFormat.detect(
				new BufferByteSource(burned),
				"movie.dxr",
			),
		).toBe(true);
		await expect(
			macromediaDxrArchiveFormat.open(
				new BufferByteSource(burned),
				"movie.dxr",
			),
		).rejects.toMatchObject({ code: "UNSUPPORTED_FEATURE" });
		// A movie of the engine of no counts of the places of the picture of the engine at all stands of no
		// movie at all.
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
});
