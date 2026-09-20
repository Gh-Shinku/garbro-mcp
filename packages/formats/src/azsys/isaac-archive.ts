import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Isaac64, inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 0x30;
const ARC_MARK = "ARC\0";
const ASB_MARK = "ASB\0";
const EXT_COUNT_AT = 4;
const COUNT_AT = 8;
const INDEX_LENGTH_AT = 0x0c;
const MOST_EXT = 8;
const RECORD_SIZE = 0x30;
const RECORD_NAME = 0x20;
const KEY_WORDS = 0x100;
const KEY_XOR = 0x1000193;
const ROTATE_MASK = 0x1f;
const KEYSTREAM_SIZE = 0x10000;
const ASB_HEAD = 0x10;
const ASB_MARK_AT = 4;
const ASB_UNPACKED_AT = 8;
const ASB_KEY = 0x9e370001;
const WORD = 4;
const CP932 = new TextDecoder("shift_jis");

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function rotateLeft(value: number, count: number): number {
	const at = count & ROTATE_MASK;
	return ((value << at) | (value >>> (32 - at))) >>> 0;
}

class AzIsaacEncryption {
	readonly #key = new Uint32Array(KEY_WORDS);
	readonly #keystream: Buffer;

	constructor(seed: number) {
		const isaac = new Isaac64(seed);
		for (let i = 0; i < KEY_WORDS; i += 1) this.#key[i] = isaac.nextUint32();
		this.#keystream = Buffer.alloc(KEYSTREAM_SIZE);
		for (let offset = 0; offset < KEYSTREAM_SIZE; offset += 1) {
			const word = ((this.#key[offset & 0xff] ?? 0) ^ KEY_XOR) >>> 0;
			this.#keystream[offset] = rotateLeft(word, offset >> 8) & 0xff;
		}
	}

	apply(data: Buffer, offset: number): void {
		for (let i = 0; i < data.length; i += 1) {
			const at = (offset + i) & 0xffff;
			data[i] = (data[i] ?? 0) ^ (this.#keystream[at] ?? 0);
		}
	}
}

export function decryptAsb(data: Buffer): boolean {
	const packedSize = data.readInt32LE(ASB_MARK_AT);
	if (packedSize <= WORD || packedSize > data.length - ASB_HEAD) return false;
	const unpackedSize = data.readUInt32LE(ASB_UNPACKED_AT);
	const key = (unpackedSize ^ ASB_KEY) >>> 0;
	for (
		let at = ASB_HEAD;
		at + WORD <= ASB_HEAD + (packedSize & ~3);
		at += WORD
	) {
		data.writeUInt32LE((data.readUInt32LE(at) - key) >>> 0, at);
	}
	return true;
}

export interface AzIsaacEntry {
	path: string;
	offset: number;
	size: number;
}

export function parseAzIndex(
	index: Buffer,
	count: number,
	baseOffset: number,
	maxOffset: number,
): AzIsaacEntry[] | undefined {
	const entries: AzIsaacEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const at = i * RECORD_SIZE;
		if (at + RECORD_SIZE > index.length) return undefined;
		const offset = index.readUInt32LE(at);
		const size = index.readUInt32LE(at + WORD);
		const nameBytes = index.subarray(
			at + 4 * WORD,
			at + 4 * WORD + RECORD_NAME,
		);
		const end = nameBytes.indexOf(0);
		const name = CP932.decode(end < 0 ? nameBytes : nameBytes.subarray(0, end));
		if (name.length === 0) return undefined;
		const placed = baseOffset + offset;
		if (!checkPlacement(BigInt(placed), BigInt(size), BigInt(maxOffset)))
			return undefined;
		entries.push({ ...normalizeEntryPath(name), offset: placed, size });
	}
	return entries;
}

export interface AzIsaacLayout {
	entries: AzIsaacEntry[];
	indexLength: number;
}

export async function readAzIsaacLayout(
	data: Buffer,
): Promise<AzIsaacLayout | undefined> {
	if (data.length < HEAD_SIZE) return undefined;
	const head = Buffer.from(data.subarray(0, HEAD_SIZE));
	const cipher = new AzIsaacEncryption(data.length >>> 0);
	cipher.apply(head, 0);
	if (head.subarray(0, ARC_MARK.length).toString("latin1") !== ARC_MARK)
		return undefined;
	const extCount = head.readInt32LE(EXT_COUNT_AT);
	const count = head.readInt32LE(COUNT_AT);
	const indexLength = head.readUInt32LE(INDEX_LENGTH_AT);
	if (
		extCount < 1 ||
		extCount > MOST_EXT ||
		count <= 0 ||
		HEAD_SIZE + indexLength > data.length
	)
		return undefined;
	const packed = Buffer.from(data.subarray(HEAD_SIZE, HEAD_SIZE + indexLength));
	cipher.apply(packed, HEAD_SIZE);
	let index: Buffer;
	try {
		index = Buffer.from(await inflateZlibBuffer(packed));
	} catch {
		return undefined;
	}
	const entries = parseAzIndex(
		index,
		count,
		HEAD_SIZE + indexLength,
		data.length,
	);
	if (!entries) return undefined;
	return { entries, indexLength };
}

export async function unpackAzIsaacEntry(
	data: Buffer,
	entry: AzIsaacEntry,
): Promise<Buffer> {
	const stored = Buffer.from(
		data.subarray(entry.offset, entry.offset + entry.size),
	);
	const cipher = new AzIsaacEncryption(entry.size >>> 0);
	cipher.apply(stored, 0);
	if (
		stored.length > 0x14 &&
		stored.subarray(0, ASB_MARK.length).toString("latin1") === ASB_MARK &&
		decryptAsb(stored)
	) {
		const header = Buffer.from(stored.subarray(0, ASB_HEAD));
		const body = await inflateZlibBuffer(stored.subarray(ASB_HEAD));
		return Buffer.concat([header, body]);
	}
	return stored;
}

export const azIsaacArchiveDescriptor: FormatDescriptor = {
	id: "azsys-isaac-archive",
	name: "AZ system encrypted resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/AZSys/ArcEncrypted.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const azIsaacArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: azIsaacArchiveDescriptor,
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return (await readAzIsaacLayout(data)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = await readAzIsaacLayout(data);
		if (!layout) throw invalidArchive("Not an archive of this kind");
		return {
			entries: layout.entries.map((entry, id) =>
				createFixedEntry({
					id,
					path: entry.path,
					offset: BigInt(entry.offset),
					size: BigInt(entry.size),
					encrypted: true,
				}),
			),
			metadata: { encrypted: true },
		};
	},
	async openEntry(source: ByteSource, entry) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = await readAzIsaacLayout(data);
		if (!layout) throw invalidArchive("Not an archive of this kind");
		const found = layout.entries.find(
			(candidate) =>
				candidate.path === entry.path &&
				BigInt(candidate.offset) === entry.offset,
		);
		if (!found) throw invalidArchive(`Archive entry not found: ${entry.path}`);
		return Readable.from([await unpackAzIsaacEntry(data, found)]);
	},
});
