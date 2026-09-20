import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";
import { createG2Scheme, decryptG2, type G2Scheme } from "./scheme.js";

const SIGNATURE = 0x47d33310;
const HEAD_SIZE = 0x5c;
const HEAD_KEY = 0x8465b49b;
const HEAD_WORDS = "GLibArchiveData2.";
const VERSION_AT = 0x11;
const CLEAR_AT = 0x12;
const INDEX_OFFSET_AT = 0x54;
const INDEX_SIZE_AT = 0x58;
const KEY_AT = [0x44, 0x34, 0x24, 0x14];
const INDEX_MARK = "CDBD";
const INDEX_HEAD = 0x10;
const RECORD_SIZE = 0x18;
const INFO_NAME_AT = 0x00;
const INFO_PARENT_AT = 0x08;
const INFO_ATTR_AT = 0x0c;
const INFO_INFO_AT = 0x10;
const ATTR_FILE = 0x100;
const INFO_SIZE_AT = 0x08;
const INFO_OFFSET_AT = 0x0c;
const INFO_KEYS = 4;
const INFO_KEY_SIZE = 0x10;
const ENTRY_CHUNK = 0x20000;
const WORD = 4;
const BASE = 0x30;
const CP932 = new TextDecoder("shift_jis");

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export interface G2IndexEntry {
	path: string;
	offset: number;
	size: number;
	keys: number[];
}

export interface G2Layout {
	version: number;
	entries: G2IndexEntry[];
}

function readName(
	index: Buffer,
	at: number,
	limit: number,
): string | undefined {
	if (at < 0 || at >= index.length) return undefined;
	let end = at;
	const most = Math.min(at + limit, index.length);
	while (end < most && index[end] !== 0) end += 1;
	return CP932.decode(index.subarray(at, end));
}

export function readG2Layout(data: Buffer): G2Layout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (data.readUInt32LE(0) !== SIGNATURE) return undefined;
	const headScheme = createG2Scheme(HEAD_KEY);
	if (!headScheme) return undefined;
	const header = decryptG2(headScheme, data.subarray(0, HEAD_SIZE), HEAD_SIZE);
	if (
		header.subarray(0, HEAD_WORDS.length).toString("latin1") !== HEAD_WORDS ||
		header[CLEAR_AT] !== 0
	)
		return undefined;
	const version = (header[VERSION_AT] ?? 0) - BASE;
	if (version !== 0 && version !== 1) return undefined;
	const indexOffset = header.readUInt32LE(INDEX_OFFSET_AT);
	const indexSize = header.readUInt32LE(INDEX_SIZE_AT);
	if (indexSize === 0 || indexOffset + indexSize > data.length)
		return undefined;
	const keys = KEY_AT.map((at) => header.readUInt32LE(at));
	const buffers: Buffer[] = [
		Buffer.from(data.subarray(indexOffset, indexOffset + indexSize)),
		Buffer.alloc(indexSize),
	];
	let slot = 0;
	for (const key of keys) {
		const decoder = createG2Scheme(key);
		if (!decoder)
			throw invalidArchive(
				"The places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them of the places of the picture of the walk of them stand of the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of their own",
			);
		buffers[slot ^ 1] = decryptG2(
			decoder,
			buffers[slot] ?? Buffer.alloc(0),
			indexSize,
		);
		slot ^= 1;
	}
	const index = buffers[slot];
	if (!index) return undefined;
	if (index.subarray(0, INDEX_MARK.length).toString("latin1") !== INDEX_MARK)
		return undefined;
	const count = index.readInt32LE(WORD);
	if (count <= 0 || INDEX_HEAD + count * RECORD_SIZE > index.length)
		return undefined;
	const infoBase = INDEX_HEAD + index.readInt32LE(2 * WORD);
	const namesBase = INDEX_HEAD + count * RECORD_SIZE;
	const names: string[] = [];
	const entries: G2IndexEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const at = INDEX_HEAD + i * RECORD_SIZE;
		const nameOffset = namesBase + index.readInt32LE(at + INFO_NAME_AT);
		const parent = index.readInt32LE(at + INFO_PARENT_AT);
		const attr = index.readInt32LE(at + INFO_ATTR_AT);
		const name = readName(index, nameOffset, infoBase - nameOffset);
		if (name === undefined) return undefined;
		let path = name;
		if (parent !== -1) {
			const parentName = names[parent];
			if (parentName === undefined) return undefined;
			path = `${parentName}/${name}`;
		}
		names.push(path);
		if (attr !== ATTR_FILE) continue;
		const infoAt = infoBase + index.readInt32LE(at + INFO_INFO_AT);
		const keyAt = infoAt + INFO_KEYS * INFO_KEY_SIZE;
		if (keyAt > index.length) return undefined;
		const size = index.readUInt32LE(infoAt + INFO_SIZE_AT);
		const offset = index.readUInt32LE(infoAt + INFO_OFFSET_AT);
		if (!checkPlacement(BigInt(offset), BigInt(size), BigInt(data.length)))
			return undefined;
		const entryKeys: number[] = [];
		for (let j = 0; j < INFO_KEYS; j += 1)
			entryKeys.push(index.readUInt32LE(infoAt + (j + 1) * INFO_KEY_SIZE));
		entries.push({ path, offset, size, keys: entryKeys });
	}
	return { version, entries };
}

export function unpackG2Entry(data: Buffer, entry: G2IndexEntry): Buffer {
	const decoders: (G2Scheme | undefined)[] = [];
	let counted = 0;
	for (let i = 0; i < INFO_KEYS && counted < entry.size; i += 1) {
		decoders[i] = createG2Scheme(entry.keys[i] ?? 0);
		if (decoders[i]) counted += ENTRY_CHUNK;
	}
	const out = Buffer.alloc(entry.size);
	let current = 0;
	let offset = 0;
	while (offset < entry.size) {
		const chunk = Math.min(ENTRY_CHUNK, entry.size - offset);
		const stored = data.subarray(
			entry.offset + offset,
			entry.offset + offset + chunk,
		);
		const decoder = decoders[current];
		if (decoder) out.set(decryptG2(decoder, stored, chunk), offset);
		else out.set(stored, offset);
		current = (current + 1) & (INFO_KEYS - 1);
		offset += chunk;
	}
	return out;
}

export const g2ArchiveDescriptor: FormatDescriptor = {
	id: "g2-archive",
	name: "Glib2 game engine resource archive",
	extensions: ["g2", "stx"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Glib2/ArcG2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const g2ArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: g2ArchiveDescriptor,
	detection: {
		signatures: [{ bytes: Buffer.from([0x10, 0x33, 0xd3, 0x47]) }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return readG2Layout(data) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readG2Layout(data);
		if (!layout) throw invalidArchive("Not an archive of this kind");
		return {
			entries: layout.entries.map((entry, id) =>
				createFixedEntry({
					id,
					...normalizeEntryPath(entry.path),
					offset: BigInt(entry.offset),
					size: BigInt(entry.size),
					encrypted: true,
				}),
			),
			metadata: {
				version: layout.version,
				encrypted: true,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readG2Layout(data);
		if (!layout) throw invalidArchive("Not an archive of this kind");
		const found = layout.entries.find(
			(candidate) =>
				candidate.path === entry.path &&
				BigInt(candidate.offset) === entry.offset,
		);
		if (!found) throw invalidArchive(`Archive entry not found: ${entry.path}`);
		void sourcePath;
		return Readable.from([unpackG2Entry(data, found)]);
	},
});
