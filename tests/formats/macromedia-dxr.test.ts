// The movie of the Macromedia Director engine, against movies built in the test: the word of the head of the
// movie of the engine (of the counts of the places of the engine of the walk of the engine of the places of
// the picture of the engine of the count of the places of the engine itself), the word of the kind of the
// walk of the engine, the counts of the places of the picture of the engine (`imap` and `mmap`), the counts
// of the walk of the engine of the places of the picture of the engine the reference lists as they stand, and
// the counts of the places of the picture of the engine of a text of the movie.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import {
	macromediaDxrArchiveFormat,
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
});
