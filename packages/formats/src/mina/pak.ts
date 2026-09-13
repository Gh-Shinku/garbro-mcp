// Format reference: GARbro "Legacy/Mina/ArcPAK.cs", classes `BmpPakOpener`, `WavPakOpener` and
// `ScriptPakOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MAX_NAME_LENGTH = 0x10;
const BMP_HEADER_SIZE = 9;
const BMP_PROBE_LIMIT = 0x10;
const BMP_PROBE_FROM = 0;
const WAV_PROBE_FROM = 4;
const WAV_PROBE_LIMIT = 0x14;
const MIN_FMT_SIZE = 0x10;
const SCRIPT_NAME = "script.pak";
const RIFF_TAG = 0x46464952;
const WAVE_TAG = 0x45564157;
const FMT_TAG = 0x20746d66;
const DATA_TAG = 0x61746164;

interface MinaEntry {
	name: string;
	offset: bigint;
	size: number;
	/** Value of the size word that follows the name, when the layout has one. */
	dataSize?: number;
}

function baseNameOf(sourcePath: string): string {
	return (sourcePath.split(/[\\/]/).pop() ?? "").toLowerCase();
}

/** Reads a NUL terminated name and reports its byte length inside the file. */
function decodeName(
	bytes: Buffer,
	offset: number,
): { name: string; byteLength: number } | undefined {
	const end = bytes.indexOf(0, offset);
	if (end === -1) return undefined;
	return {
		name: decodeCStringField(bytes, offset, end - offset),
		byteLength: end - offset,
	};
}

/**
 * The shared header probe: a NUL terminated string inside a limited window whose last four characters
 * are a known extension.
 */
function probeHeader(
	file: Buffer,
	from: number,
	limit: number,
	extension: string,
): boolean {
	let position = from;
	while (position < limit && position < file.length) {
		if (file[position] === 0) break;
		position += 1;
	}
	if (position >= limit || position <= from + 4) return false;
	return file.toString("latin1", position - 4, position) === extension;
}

/** `BmpPakOpener.TryOpen`: a run of named bitmap entries, each with a nine byte header. */
async function buildBmpEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<MinaEntry[] | undefined> {
	if (sourceExtension(sourcePath).toLowerCase() !== "pak") return undefined;
	if (source.size < BigInt(BMP_PROBE_LIMIT)) return undefined;
	const head = Buffer.from(await source.readAt(0n, BMP_PROBE_LIMIT));
	if (!probeHeader(head, BMP_PROBE_FROM, BMP_PROBE_LIMIT, ".BMP"))
		return undefined;
	const entries: MinaEntry[] = [];
	let position = 0;
	const total = Number(source.size);
	while (position < total) {
		const available = Math.min(0x40, total - position);
		const window = Buffer.from(
			await source.readAt(BigInt(position), available),
		);
		const decoded = decodeName(window, 0);
		if (!decoded) return undefined;
		const { name, byteLength } = decoded;
		if (name.length > MAX_NAME_LENGTH) return undefined;
		const offset = position + byteLength + 1;
		if (offset + BMP_HEADER_SIZE > total) return undefined;
		const sizeWord = Buffer.from(await source.readAt(BigInt(offset + 5), 4));
		const size = sizeWord.readUInt32LE(0) + BMP_HEADER_SIZE;
		const entry = { name, offset: BigInt(offset), size };
		if (!checkPlacement(entry.offset, BigInt(entry.size), source.size))
			return undefined;
		entries.push(entry);
		position = offset + size;
	}
	return entries;
}

/** `WavPakOpener.TryOpen`: a size, a name and a format chunk followed by the audio data. */
async function buildWavEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<MinaEntry[] | undefined> {
	if (sourceExtension(sourcePath).toLowerCase() !== "pak") return undefined;
	if (source.size < BigInt(WAV_PROBE_LIMIT)) return undefined;
	const head = Buffer.from(await source.readAt(0n, WAV_PROBE_LIMIT));
	if (!probeHeader(head, WAV_PROBE_FROM, WAV_PROBE_LIMIT, ".WAV"))
		return undefined;
	const entries: MinaEntry[] = [];
	let position = 0;
	const total = Number(source.size);
	while (position < total) {
		if (position + 4 > total) return undefined;
		const sizeWord = Buffer.from(await source.readAt(BigInt(position), 4));
		const dataSize = sizeWord.readUInt32LE(0);
		const window = Buffer.from(
			await source.readAt(
				BigInt(position + 4),
				Math.min(0x40, total - position - 4),
			),
		);
		const decoded = decodeName(window, 0);
		if (!decoded) return undefined;
		const { name, byteLength } = decoded;
		if (name.length > MAX_NAME_LENGTH) return undefined;
		const offset = position + 4 + byteLength + 1;
		if (offset + 4 > total) return undefined;
		const fmtWord = Buffer.from(await source.readAt(BigInt(offset), 4));
		const fmtSize = fmtWord.readUInt32LE(0);
		if (fmtSize < MIN_FMT_SIZE) return undefined;
		const size = dataSize + fmtSize + 4;
		const entry = {
			name,
			offset: BigInt(offset),
			size,
			dataSize,
		};
		if (!checkPlacement(entry.offset, BigInt(entry.size), source.size))
			return undefined;
		entries.push(entry);
		position = offset + size;
	}
	return entries;
}

/** `ScriptPakOpener.TryOpen`: a name and a size for every script unit. */
async function buildScriptEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<MinaEntry[] | undefined> {
	if (baseNameOf(sourcePath) !== SCRIPT_NAME) return undefined;
	const entries: MinaEntry[] = [];
	let position = 0;
	const total = Number(source.size);
	while (position < total) {
		const window = Buffer.from(
			await source.readAt(BigInt(position), Math.min(0x40, total - position)),
		);
		const decoded = decodeName(window, 0);
		if (!decoded) return undefined;
		const { name, byteLength } = decoded;
		if (name.length > MAX_NAME_LENGTH) return undefined;
		const offset = position + byteLength + 1;
		if (offset + 4 > total) return undefined;
		const sizeWord = Buffer.from(await source.readAt(BigInt(offset), 4));
		const size = sizeWord.readUInt32LE(0);
		const entry = { name, offset: BigInt(offset + 4), size };
		if (!checkPlacement(entry.offset, BigInt(entry.size), source.size))
			return undefined;
		entries.push(entry);
		position = offset + 4 + size;
	}
	return entries;
}

const BMP_DESCRIPTOR: FormatDescriptor = {
	id: "mina-pak-bmp",
	name: "Mina bitmap archive",
	extensions: ["pak"],
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
			source: "Legacy/Mina/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const WAV_DESCRIPTOR: FormatDescriptor = {
	id: "mina-pak-wav",
	name: "Mina audio archive",
	extensions: ["pak"],
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
			source: "Legacy/Mina/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const SCRIPT_DESCRIPTOR: FormatDescriptor = {
	id: "mina-pak-spt",
	name: "Mina scripts archive",
	extensions: ["pak"],
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
			source: "Legacy/Mina/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const minaBmpPakDescriptor = BMP_DESCRIPTOR;
export const minaWavPakDescriptor = WAV_DESCRIPTOR;
export const minaScriptPakDescriptor = SCRIPT_DESCRIPTOR;

/** A byte rotate right inside the byte, mirroring `Binary.RotByteR (value, 4)`. */
function rotateByteRight4(value: number): number {
	return (((value >>> 4) | (value << 4)) & 0xff) >>> 0;
}

export const minaBmpPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: BMP_DESCRIPTOR,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await buildBmpEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await buildBmpEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mina bitmap index");
		const fixed: FixedEntry[] = entries.map((entry, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.size),
			}),
		);
		return { entries: fixed, metadata: { entryCount: fixed.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (entry.size === 0n) return Readable.from([]);
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset ?? 0n, Number(entry.size))),
		]);
	},
});

export const minaWavPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: WAV_DESCRIPTOR,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await buildWavEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await buildWavEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mina audio index");
		const fixed: FixedEntry[] = entries.map((entry, id) => {
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.size),
			});
			// Extraction wraps the format chunk and the payload in a RIFF container.
			return { ...created, sizeKnown: false };
		});
		return { entries: fixed, metadata: { entryCount: fixed.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const offset = entry.offset ?? 0n;
		const size = Number(entry.size);
		if (size < 4) return Readable.from([]);
		const fmtSize = Buffer.from(await source.readAt(offset, 4)).readUInt32LE(0);
		const pcmSize = size - 4 - fmtSize;
		const fmt = Buffer.from(await source.readAt(offset + 4n, fmtSize));
		const data = Buffer.from(
			await source.readAt(offset + 4n + BigInt(fmtSize), pcmSize),
		);
		const header = Buffer.alloc(20);
		header.writeUInt32LE(RIFF_TAG, 0);
		header.writeUInt32LE((size + 0x10) >>> 0, 4);
		header.writeUInt32LE(WAVE_TAG, 8);
		header.writeUInt32LE(FMT_TAG, 0xc);
		header.writeUInt32LE(fmtSize, 0x10);
		const tail = Buffer.alloc(8);
		tail.writeUInt32LE(DATA_TAG, 0);
		tail.writeUInt32LE(pcmSize >>> 0, 4);
		return Readable.from([Buffer.concat([header, fmt, tail, data])]);
	},
});

export const minaScriptPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: SCRIPT_DESCRIPTOR,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await buildScriptEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await buildScriptEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mina script index");
		const fixed: FixedEntry[] = entries.map((entry, id) => {
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.size),
			});
			// Extraction inserts a line break after every script line.
			return { ...created, sizeKnown: false };
		});
		return { entries: fixed, metadata: { entryCount: fixed.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (entry.size === 0n) return Readable.from([]);
		const data = Buffer.from(
			await source.readAt(entry.offset ?? 0n, Number(entry.size)),
		);
		const parts: Buffer[] = [];
		let position = 0;
		while (position < data.length) {
			if (position + 3 > data.length) break;
			const length = (data[position] ?? 0) + 1;
			position += 3;
			if (position + length > data.length) break;
			const line = Buffer.from(data.subarray(position, position + length));
			for (let index = 0; index < line.length; index += 1)
				line[index] = rotateByteRight4(line[index] ?? 0);
			parts.push(line, Buffer.from([0x0d, 0x0a]));
			position += length;
		}
		return Readable.from([Buffer.concat(parts)]);
	},
});
