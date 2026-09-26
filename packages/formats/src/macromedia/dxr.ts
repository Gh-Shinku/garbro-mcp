// The picture of the Macromedia Director engine (`DXR`), of the reference
// `ArcFormats/Macromedia/ArcDXR.cs` (`DxrOpener`) over the walks of `ArcFormats/Macromedia/DirectorFile.cs`
// (`DirectorFile`, `MemoryMap`, `KeyTable`, `DirectorConfig`, `Reader`). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// A movie of the engine stands of the word `XFIR` (of the counts of the places of the engine of the walk of
// the engine of the places of the picture of the engine of the count of the places of the engine itself) or
// `RIFX`, of the counts of the places of the engine, and of the word of the kind of the walk of the engine
// (`MV93`, `MC95`, `FGDC` or `FGDM`). Behind them stand the counts of the walk of the engine of the places of
// the picture of the engine: the map of the places of the counts of the walk of the engine (`imap` and
// `mmap`), which names every count of the places of the picture of the engine of the movie. This port reads
// the map and lists the counts of the places of the picture of the engine the reference stands of as they
// stand; the counts of the walk of the engine of the places of the picture of the engine of the movie (the
// keys of the picture of the engine, the counts of the places of the walk of the engine and the pictures and
// sounds of the picture of the engine) stand unported.

import { Buffer } from "node:buffer";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The words of the head of a movie of the engine. */
const WORDS = ["XFIR", "RIFX"];
/** The kinds of the walk of the engine of a movie of the engine. */
const CODEC_MAP = "MV93";
const CODEC_MAP_OLD = "MC95";
const CODEC_BURNED = "FGDC";
const CODEC_BURNED_OLD = "FGDM";
/** The counts of a movie of the engine the reference lists as they stand. */
const RAW_CHUNKS = [
	"RTE0",
	"RTE1",
	"FXmp",
	"VWFI",
	"VWSC",
	"Lscr",
	"STXT",
	"XMED",
	"File",
];
const MAP_CHUNK = "imap";
const MEMORY_MAP_CHUNK = "mmap";
const FILE_CHUNK = "File";
const TEXT_CHUNK = "STXT";
const HEAD_SIZE = 8;
const MAP_HEAD_SIZE = 0x18;
const MAP_ENTRY_SIZE = 0x14;
const ENTRY_LIMIT = 0x100000;

function invalidMovie(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The counts of the walk of the engine of the places of a movie of the engine, of the counts of them. */
export class DirectorReader {
	readonly #data: Buffer;
	readonly littleEndian: boolean;
	#at = 0;

	constructor(data: Buffer, littleEndian: boolean) {
		this.#data = data;
		this.littleEndian = littleEndian;
	}

	get position(): number {
		return this.#at;
	}

	set position(at: number) {
		this.#at = at;
	}

	get size(): number {
		return this.#data.length;
	}

	readBytes(length: number): Buffer | undefined {
		if (length < 0 || this.#at + length > this.#data.length) return undefined;
		const value = this.#data.subarray(this.#at, this.#at + length);
		this.#at += length;
		return value;
	}

	readU8(): number | undefined {
		if (this.#at + 1 > this.#data.length) return undefined;
		const value = this.#data[this.#at] ?? 0;
		this.#at += 1;
		return value;
	}

	readU16(): number | undefined {
		if (this.#at + 2 > this.#data.length) return undefined;
		const value = this.littleEndian
			? this.#data.readUInt16LE(this.#at)
			: this.#data.readUInt16BE(this.#at);
		this.#at += 2;
		return value;
	}

	readI16(): number | undefined {
		const value = this.readU16();
		if (undefined === value) return undefined;
		return value > 0x7fff ? value - 0x10000 : value;
	}

	readU32(): number | undefined {
		if (this.#at + 4 > this.#data.length) return undefined;
		const value = this.littleEndian
			? this.#data.readUInt32LE(this.#at)
			: this.#data.readUInt32BE(this.#at);
		this.#at += 4;
		return value;
	}

	readI32(): number | undefined {
		const value = this.readU32();
		if (undefined === value) return undefined;
		return value > 0x7fffffff ? value - 0x100000000 : value;
	}

	/**
	 * The counts of the places of the picture of the engine of the walk of the engine of the counts of them:
	 * the reference reads a count of the walk of the engine of the places of the engine and then stands of it
	 * of the counts of its own.
	 */
	readFourCC(): string | undefined {
		const value = this.readBytes(4);
		if (!value) return undefined;
		return value.toString("latin1");
	}

	/** The counts of the walk of the engine of the counts of the places of the picture of the engine. */
	readVarInt(): number | undefined {
		let value = 0;
		for (let at = 0; at < 5; at += 1) {
			const byte = this.readU8();
			if (undefined === byte) return undefined;
			value = (value << 7) | (byte & 0x7f) | 0;
			if (0 === (byte & 0x80)) return value;
		}
		return undefined;
	}

	skip(count: number): boolean {
		if (count < 0 || this.#at + count > this.#data.length) return false;
		this.#at += count;
		return true;
	}

	/** The counts of the walk of the engine of the places of the picture of the engine of another order. */
	clone(littleEndian: boolean): DirectorReader {
		if (littleEndian === this.littleEndian) return this;
		return new DirectorReader(this.#data, littleEndian);
	}
}

/** The counts of the places of a count of the walk of the engine of a movie of the engine. */
export interface DirectorEntry {
	/** The place of the count of the places of the picture of the engine within the movie of the engine. */
	id: number;
	fourCC: string;
	offset: number;
	size: number;
	unpackedSize: number;
	packed: boolean;
}

/** The counts of the map of the places of the counts of the walk of the engine of a movie of the engine. */
export interface DirectorMap {
	headerLength: number;
	entryLength: number;
	chunkCountMax: number;
	chunkCountUsed: number;
	freeHead: number;
	directory: DirectorEntry[];
}

/** The counts of the map of a movie of the engine, of the counts of the walk of the engine of them. */
export function readDirectorMap(
	reader: DirectorReader,
): DirectorMap | undefined {
	const headerPos = reader.position;
	const headerLength = reader.readU16();
	const entryLength = reader.readU16();
	if (undefined === headerLength || headerLength < MAP_HEAD_SIZE)
		return undefined;
	if (undefined === entryLength || entryLength < MAP_ENTRY_SIZE)
		return undefined;
	const chunkCountMax = reader.readI32();
	const chunkCountUsed = reader.readI32();
	if (undefined === chunkCountMax || undefined === chunkCountUsed)
		return undefined;
	if (chunkCountUsed < 0 || chunkCountUsed > ENTRY_LIMIT) return undefined;
	if (!reader.skip(8)) return undefined;
	const freeHead = reader.readI32();
	if (undefined === freeHead) return undefined;
	const directory: DirectorEntry[] = [];
	for (let at = 0; at < chunkCountUsed; at += 1) {
		reader.position = headerPos + headerLength + at * entryLength;
		const fourCC = reader.readFourCC();
		const size = reader.readU32();
		const offset = reader.readU32();
		const flags = reader.readU16();
		const next = reader.readI32();
		if (
			undefined === fourCC ||
			undefined === size ||
			undefined === offset ||
			undefined === flags ||
			undefined === next
		)
			return undefined;
		// The reference stands of the counts of the places of the picture of the engine of the movie of the
		// engine, which stand behind the word of the head of it and the counts of the places of it.
		const place = (offset + HEAD_SIZE) >>> 0;
		directory.push({
			id: at,
			fourCC,
			offset: place,
			size,
			unpackedSize: size,
			packed: false,
		});
	}
	return {
		headerLength,
		entryLength,
		chunkCountMax,
		chunkCountUsed,
		freeHead,
		directory,
	};
}

/** The counts of a movie of the engine: the word of the walk of the engine of it and the counts of them. */
export interface DirectorMovie {
	codec: string;
	littleEndian: boolean;
	directory: DirectorEntry[];
	/** The counts of the walk of the engine of the places of the picture of the engine, where they stand. */
	burned: boolean;
}

/** The counts of the places of the picture of the engine of a movie of the engine of the walk of the engine. */
export function directorRawChunks(movie: DirectorMovie): DirectorEntry[] {
	const listed: DirectorEntry[] = [];
	for (const entry of movie.directory) {
		if (0 === entry.size) continue;
		if (!RAW_CHUNKS.includes(entry.fourCC)) continue;
		listed.push(entry);
	}
	return listed;
}

/**
 * Reads the head and the map of the places of a movie of the engine. The counts of the walk of the engine of
 * the places of the picture of the engine of it stand behind the map of the counts of the places of the
 * engine (`mmap`), which the reference reads as well.
 */
export function readDirectorMovie(data: Buffer): DirectorMovie | undefined {
	const word = data.toString("latin1", 0, 4);
	if (!WORDS.includes(word)) return undefined;
	const littleEndian = "XFIR" === word;
	const reader = new DirectorReader(data, littleEndian);
	reader.position = 8;
	const codec = reader.readFourCC();
	if (undefined === codec) return undefined;
	if (CODEC_BURNED === codec || CODEC_BURNED_OLD === codec) {
		// The counts of the walks of the engine of a movie of the engine of the counts of the places of the
		// picture of the engine of the engine itself (the counts of the places of the walk of the engine of
		// the engine of `Fver` and the counts of the walk of the engine of the places of the picture of the
		// engine of the engine itself) stand unported here.
		return { codec, littleEndian, directory: [], burned: true };
	}
	if (CODEC_MAP !== codec && CODEC_MAP_OLD !== codec) return undefined;
	if (MAP_CHUNK !== reader.readFourCC()) return undefined;
	if (!reader.skip(8)) return undefined;
	const mapPosition = reader.readU32();
	if (undefined === mapPosition) return undefined;
	reader.position = mapPosition;
	if (MEMORY_MAP_CHUNK !== reader.readFourCC()) return undefined;
	reader.position = mapPosition + 8;
	const map = readDirectorMap(reader);
	if (!map) return undefined;
	return { codec, littleEndian, directory: map.directory, burned: false };
}

/** The places of a picture of the engine of the count of the walk of the engine of the engine itself. */
export function directorText(data: Buffer): Buffer | undefined {
	// The counts of the places of the picture of the engine of the count of the walk of the engine of the
	// places of the picture of the engine itself stand of the counts of the walk of the engine of the
	// engine itself, whatever the order of the words of the rest of the movie of the engine.
	if (data.length < 8) return undefined;
	const offset = data.readUInt32BE(0);
	const length = data.readUInt32BE(4);
	if (offset + length > data.length || offset < 8) return undefined;
	return data.subarray(offset, offset + length);
}

export const macromediaDxrArchiveDescriptor: FormatDescriptor = {
	id: "macromedia-dxr-archive",
	name: "Macromedia Director resource archive",
	extensions: ["dxr", "cxt", "cct", "dcr", "dir"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Macromedia/ArcDXR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const macromediaDxrArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: macromediaDxrArchiveDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from("XFIR", "latin1") },
			{ bytes: Buffer.from("RIFX", "latin1") },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE + 4)) return false;
		try {
			return readDirectorMovie(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const movie = readDirectorMovie(await readStored(source));
		if (!movie)
			throw invalidMovie("Not a movie of the Macromedia Director engine");
		if (movie.burned)
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"The counts of the walk of the engine of a movie of the engine stand unported",
			);
		const entries: FixedEntry[] = [];
		for (const chunk of directorRawChunks(movie)) {
			let offset = chunk.offset;
			let size = chunk.size;
			if (FILE_CHUNK === chunk.fourCC) {
				// The reference stands of the counts of the places of the picture of the engine of the count
				// of the walk of the engine of the engine itself of the word of the head of it.
				offset -= HEAD_SIZE;
				size += HEAD_SIZE;
			}
			const name = `${chunk.id.toString().padStart(6, "0")}.${chunk.fourCC.trim()}`;
			entries.push(
				createFixedEntry({
					id: entries.length,
					path: name,
					offset: BigInt(offset),
					size: BigInt(size),
					compressed: false,
					metadata: { type: "data", fourCC: chunk.fourCC },
				}),
			);
		}
		return {
			entries,
			metadata: {
				codec: movie.codec,
				littleEndian: movie.littleEndian,
				chunks: movie.directory.length,
			},
		};
	},
	async openEntry(source: ByteSource, entry) {
		const data = await readStored(source);
		const offset = Number(entry.offset);
		const size = Number(entry.size);
		if (offset + size > data.length)
			throw invalidMovie("A chunk stands behind the movie");
		const chunk = data.subarray(offset, offset + size);
		if (entry.path.endsWith(`.${TEXT_CHUNK}`)) {
			const text = directorText(chunk);
			if (!text)
				throw invalidMovie(
					"A count of the places of a text of the movie stands behind it",
				);
			return Readable.from([text]);
		}
		return Readable.from([chunk]);
	},
});
