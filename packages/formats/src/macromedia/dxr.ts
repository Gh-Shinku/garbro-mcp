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
import { inflateSync } from "node:zlib";
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
const KEY_CHUNK = "KEY*";
const CONFIG_CHUNK = "VWCF";
const CONFIG_CHUNK_OLD = "DRCF";
const CONFIG_VERSION_OFFSET = 0x24;
const CONFIG_PALETTE_OFFSET_OLD = 0x46;
const CONFIG_PALETTE_OFFSET_NEW = 0x4e;
const CONFIG_VERSION_NEW = 1200;

const AB_VERSION_MMAP = 0x400;
const AB_VERSION_STRING = 0x500;
const AB_ILS_ID = 2;
const ILS_ENTRY_LIMIT = 0x10000;

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

	/** The counts of the walk of the engine of the places of the picture of the engine behind a place. */
	slice(at: number): Buffer | undefined {
		if (at < 0 || at > this.#data.length) return undefined;
		return this.#data.subarray(at);
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

/** The counts of the places of the picture of the engine of a count of the walk of the engine of them. */
export interface DirectorKeyEntry {
	id: number;
	castId: number;
	fourCC: string;
}

/**
 * The counts of the keys of the picture of the engine of a movie of the engine (`KeyTable`): the counts of
 * the places of every count of them and of the counts of the places of the picture of the engine it stands of.
 *
 * The reference names the counts of the places of a count of the keys and the count of the keys the movie
 * stands of, and then stands of the *whole* of the table: the count of the keys the movie stands of is read
 * and stands of no place.
 */
export function readDirectorKeyTable(reader: DirectorReader):
	| {
			entrySize: number;
			totalCount: number;
			usedCount: number;
			table: DirectorKeyEntry[];
	  }
	| undefined {
	const entrySize = reader.readU16();
	if (undefined === entrySize || !reader.skip(2)) return undefined;
	const totalCount = reader.readI32();
	const usedCount = reader.readI32();
	if (undefined === totalCount || undefined === usedCount) return undefined;
	if (totalCount < 0 || totalCount > ENTRY_LIMIT) return undefined;
	const table: DirectorKeyEntry[] = [];
	for (let at = 0; at < totalCount; at += 1) {
		const id = reader.readI32();
		const castId = reader.readI32();
		const fourCC = reader.readFourCC();
		if (undefined === id || undefined === castId || undefined === fourCC)
			return undefined;
		table.push({ id, castId, fourCC });
	}
	return { entrySize, totalCount, usedCount, table };
}

/** The counts of the places of the picture of the engine of the movie of the engine (`DirectorConfig`). */
export interface DirectorConfig {
	fileVersion: number;
	version: number;
	stageTop: number;
	stageLeft: number;
	stageBottom: number;
	stageRight: number;
	minMember: number;
	maxMember: number;
	stageColor: number;
	bitDepth: number;
	frameRate: number;
	platform: number;
	protection: number;
	checkSum: number;
	defaultPalette: number;
}

/**
 * The counts of the places of the picture of the engine of a movie of the engine (`DirectorConfig`): the
 * counts of the places of the picture of the engine of the movie of the engine, of every word of the head of
 * it and of the counts of the places of the picture of the engine itself.
 */
export function readDirectorConfig(
	reader: DirectorReader,
): DirectorConfig | undefined {
	const base = reader.position;
	// The reference stands of the counts of the places of the picture of the engine of the movie of the
	// engine of the counts of the engine itself (`reader = reader.CloneUnless (ByteOrder.BigEndian)`), every
	// time the counts of the places of the picture of the engine of the movie of the engine of its own.
	const config = reader.clone(false);
	config.position = base + CONFIG_VERSION_OFFSET;
	const version = config.readU16();
	config.position = base;
	const length = config.readI16();
	const fileVersion = config.readI16();
	const stageTop = config.readI16();
	const stageLeft = config.readI16();
	const stageBottom = config.readI16();
	const stageRight = config.readI16();
	const minMember = config.readI16();
	const maxMember = config.readI16();
	if (!config.skip(0x0a)) return undefined;
	const stageColor = config.readU16();
	const bitDepth = config.readU16();
	if (!config.skip(0x18)) return undefined;
	const frameRate = config.readU16();
	const platform = config.readI16();
	const protection = config.readI16();
	if (!config.skip(4)) return undefined;
	const checkSum = config.readU32();
	const values = [
		version,
		length,
		fileVersion,
		stageTop,
		stageLeft,
		stageBottom,
		stageRight,
		minMember,
		maxMember,
		stageColor,
		bitDepth,
		frameRate,
		platform,
		protection,
		checkSum,
	];
	if (values.some((value) => undefined === value)) return undefined;
	config.position =
		base +
		((version ?? 0) > CONFIG_VERSION_NEW
			? CONFIG_PALETTE_OFFSET_NEW
			: CONFIG_PALETTE_OFFSET_OLD);
	const defaultPalette = config.readU16();
	if (undefined === defaultPalette) return undefined;
	return {
		version: version ?? 0,
		fileVersion: fileVersion ?? 0,
		stageTop: stageTop ?? 0,
		stageLeft: stageLeft ?? 0,
		stageBottom: stageBottom ?? 0,
		stageRight: stageRight ?? 0,
		minMember: minMember ?? 0,
		maxMember: maxMember ?? 0,
		stageColor: stageColor ?? 0,
		bitDepth: bitDepth ?? 0,
		frameRate: frameRate ?? 0,
		platform: platform ?? 0,
		protection: protection ?? 0,
		checkSum: checkSum ?? 0,
		defaultPalette,
	};
}

/** The counts of a movie of the engine: the word of the walk of the engine of it and the counts of them. */
export interface DirectorMovie {
	codec: string;
	littleEndian: boolean;
	directory: DirectorEntry[];
	/** The counts of the walk of the engine of the places of the picture of the engine, where they stand. */
	burned: boolean;
	/** The counts of the walk of the engine of the places of the picture of the engine of the engine itself. */
	ils?: Map<number, Buffer>;
	keyTable?: {
		entrySize: number;
		totalCount: number;
		usedCount: number;
		table: DirectorKeyEntry[];
	};
	config?: DirectorConfig;
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

/** The counts of the places of the picture of the engine of the counts of the walk of the engine of them. */
function varIntLength(value: number): number {
	let length = 1;
	let rest = value >>> 0;
	while (rest > 0x7f) {
		rest >>>= 7;
		length += 1;
	}
	return length;
}

/** The counts of the places of a count of the places of the picture of the engine of the engine itself. */
function readAfterBurnerEntry(
	reader: DirectorReader,
): DirectorEntry | undefined {
	const id = reader.readVarInt();
	const offset = reader.readVarInt();
	const size = reader.readVarInt();
	const unpackedSize = reader.readVarInt();
	const compMethod = reader.readVarInt();
	const fourCC = reader.readFourCC();
	if (
		undefined === id ||
		undefined === offset ||
		undefined === size ||
		undefined === unpackedSize ||
		undefined === compMethod ||
		undefined === fourCC
	)
		return undefined;
	return {
		id,
		fourCC,
		offset,
		size,
		unpackedSize,
		// The reference stands of the counts of the walk of the engine of the places of the picture of the
		// engine of the counts of the places of them where the counts of the places of the picture of the
		// engine and the counts of the walk of the engine of the places of the picture of the engine of them
		// stand of the counts of the engine itself.
		packed: size !== unpackedSize,
	};
}

/**
 * The counts of the walk of the engine of the places of the picture of the engine of a movie of the engine of
 * the counts of the places of the picture of the engine of the engine itself (`FGDC`, `FGDM`): the counts of
 * the walk of the engine of the engine itself (`Fver`), the counts of the walk of the engine of the places of
 * the picture of the engine of the engine itself (`Fcdr`), the counts of the places of the picture of the
 * engine of the movie of the engine (`ABMP`) and the counts of the walk of the engine of the places of the
 * picture of the engine of the counts of the walk of the engine of the places of them (`FGEI`), which stand
 * of the counts of the walk of the engine of the places of the picture of the engine of the engine itself
 * (`ils`) for every count of the places of the picture of the engine of the counts of the walk of the engine
 * of no count of the places of the picture of the engine at all.
 */
function readDirectorAfterBurner(
	reader: DirectorReader,
): { directory: DirectorEntry[]; ils: Map<number, Buffer> } | undefined {
	if ("Fver" !== reader.readFourCC()) return undefined;
	const length = reader.readVarInt();
	if (undefined === length) return undefined;
	const nextPos = reader.position + length;
	const version = reader.readVarInt();
	if (undefined === version) return undefined;
	if (version > AB_VERSION_MMAP) {
		// The counts of the walk of the engine of the places of the picture of the engine of the engine
		// itself and of the counts of the places of the picture of the engine of the engine itself.
		if (undefined === reader.readVarInt() || undefined === reader.readVarInt())
			return undefined;
	}
	if (version > AB_VERSION_STRING) {
		const stringLength = reader.readU8();
		if (undefined === stringLength || !reader.skip(stringLength))
			return undefined;
	}
	reader.position = nextPos;
	if ("Fcdr" !== reader.readFourCC()) return undefined;
	const skipLength = reader.readVarInt();
	if (undefined === skipLength || !reader.skip(skipLength)) return undefined;
	if ("ABMP" !== reader.readFourCC()) return undefined;
	const mapLength = reader.readVarInt();
	if (undefined === mapLength) return undefined;
	const mapEnd = reader.position + mapLength;
	// The counts of the walk of the engine of the places of the picture of the engine stand of the counts of
	// the engine itself: the reference stands of the counts of the places of the picture of the engine of the
	// engine itself and of the counts of their own, and then of the counts of the walk of the engine.
	if (undefined === reader.readVarInt() || undefined === reader.readVarInt())
		return undefined;
	let unpacked: Buffer;
	try {
		unpacked = inflateSync(reader.slice(reader.position) ?? Buffer.alloc(0));
	} catch {
		return undefined;
	}
	const mapReader = new DirectorReader(unpacked, reader.littleEndian);
	if (
		undefined === mapReader.readVarInt() ||
		undefined === mapReader.readVarInt()
	)
		return undefined;
	const count = mapReader.readVarInt();
	if (undefined === count || count < 0 || count > ENTRY_LIMIT) return undefined;
	const directory: DirectorEntry[] = [];
	for (let at = 0; at < count; at += 1) {
		const entry = readAfterBurnerEntry(mapReader);
		if (!entry) return undefined;
		directory.push(entry);
	}
	reader.position = mapEnd;
	if ("FGEI" !== reader.readFourCC()) return undefined;
	if (undefined === reader.readVarInt()) return undefined;
	// The counts of the places of the picture of the engine of every count of the walk of the engine of the
	// places of the picture of the engine of the movie of the engine stand of the counts of the walk of the
	// engine of the places of the picture of the engine that stand behind the counts of the walk of the
	// engine of the engine itself.
	const baseOffset = reader.position;
	for (const entry of directory)
		if (entry.offset >= 0) entry.offset += baseOffset;
	const ilsChunk = directory.find((entry) => AB_ILS_ID === entry.id);
	if (!ilsChunk) return undefined;
	let ilsBytes: Buffer;
	try {
		ilsBytes = inflateSync(reader.slice(reader.position) ?? Buffer.alloc(0));
	} catch {
		return undefined;
	}
	const ilsReader = new DirectorReader(ilsBytes, reader.littleEndian);
	const ils = new Map<number, Buffer>();
	let pos = 0;
	while (pos < ilsChunk.unpackedSize) {
		const id = ilsReader.readVarInt();
		const chunk = directory.find((entry) => entry.id === id);
		if (undefined === id || !chunk) return undefined;
		const bytes = ilsReader.readBytes(chunk.size);
		if (!bytes) return undefined;
		if (ils.size >= ILS_ENTRY_LIMIT) return undefined;
		ils.set(id, bytes);
		pos += varIntLength(id) + chunk.size;
	}
	return { directory, ils };
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
		const burned = readDirectorAfterBurner(reader);
		if (!burned) return undefined;
		return {
			codec,
			littleEndian,
			directory: burned.directory,
			burned: true,
			ils: burned.ils,
		};
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
	const movie: DirectorMovie = {
		codec,
		littleEndian,
		directory: map.directory,
		burned: false,
	};
	// The counts of the places of the picture of the engine of the movie of the engine stand of the counts of
	// the walk of the engine of the places of the picture of the engine of the map of the places of the
	// picture of the engine: the keys of the picture of the engine and the counts of the places of the movie
	// of the engine of it stand at the places the map of the counts of them names.
	const keyChunk = map.directory.find((entry) => KEY_CHUNK === entry.fourCC);
	if (keyChunk) {
		reader.position = keyChunk.offset;
		const keyTable = readDirectorKeyTable(reader);
		if (keyTable) movie.keyTable = keyTable;
	}
	const configChunk =
		map.directory.find((entry) => CONFIG_CHUNK === entry.fourCC) ??
		map.directory.find((entry) => CONFIG_CHUNK_OLD === entry.fourCC);
	if (configChunk) {
		reader.position = configChunk.offset;
		const config = readDirectorConfig(reader);
		if (config) movie.config = config;
	}
	return movie;
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
					// The counts of the places of the picture of the engine of a count of the walk of the
					// engine of the engine itself stand of the counts of the walk of the engine of the places
					// of the picture of the engine of the counts of the walk of the engine of the places of
					// the movie of the engine itself: this port stands of no counts of them at all.
					offset: offset >= 0 ? BigInt(offset) : 0n,
					size: BigInt(size),
					compressed: chunk.packed,
					metadata: { type: "data", fourCC: chunk.fourCC },
				}),
			);
		}
		const metadata: Record<string, unknown> = {
			codec: movie.codec,
			littleEndian: movie.littleEndian,
			chunks: movie.directory.length,
		};
		if (movie.config) {
			metadata.version = movie.config.version;
			metadata.frameRate = movie.config.frameRate;
			metadata.platform = movie.config.platform;
			metadata.bitDepth = movie.config.bitDepth;
			metadata.stageWidth = movie.config.stageRight - movie.config.stageLeft;
			metadata.stageHeight = movie.config.stageBottom - movie.config.stageTop;
		}
		if (movie.keyTable) metadata.keys = movie.keyTable.table.length;
		return { entries, metadata };
	},
	async openEntry(source: ByteSource, entry) {
		const data = await readStored(source);
		const movie = readDirectorMovie(data);
		if (!movie)
			throw invalidMovie("Not a movie of the Macromedia Director engine");
		const id = Number.parseInt(entry.path.slice(0, 6), 10);
		const chunk = movie.directory.find((candidate) => candidate.id === id);
		if (!chunk)
			throw invalidMovie(
				"A count of the walk of the engine of the movie stands behind it",
			);
		let offset = chunk.offset;
		let size = chunk.size;
		if (FILE_CHUNK === chunk.fourCC && offset >= 0) {
			offset -= HEAD_SIZE;
			size += HEAD_SIZE;
		}
		let bytes: Buffer | undefined;
		if (offset >= 0) {
			if (offset + size > data.length)
				throw invalidMovie(
					"A count of the walk of the engine stands behind the movie",
				);
			bytes = data.subarray(offset, offset + size);
		} else {
			// The counts of the walk of the engine of the places of the picture of the engine of the engine
			// itself stand where the counts of the walk of the engine of the places of the picture of the
			// engine stand of no counts of the places of the picture of the engine at all.
			bytes = movie.ils?.get(chunk.id);
		}
		if (!bytes)
			throw invalidMovie(
				"A count of the places of the picture of the engine stands of no counts of it",
			);
		if (chunk.packed) {
			try {
				bytes = inflateSync(bytes);
			} catch {
				throw invalidMovie(
					"The counts of the places of a count of the walk of the engine stand behind",
				);
			}
		}
		if (entry.path.endsWith(`.${TEXT_CHUNK}`)) {
			const text = directorText(bytes);
			if (!text)
				throw invalidMovie(
					"A count of the places of a text of the movie stands behind it",
				);
			return Readable.from([text]);
		}
		return Readable.from([bytes]);
	},
});
