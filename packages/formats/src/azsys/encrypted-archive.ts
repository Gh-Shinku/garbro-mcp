import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import {
	adler32,
	crc32Update,
	FastMersenneTwister,
	inflateZlibBuffer,
} from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";
import { readCompanionFile } from "../shared/companion.js";

import {
	decryptAsb,
	parseAzIndex,
	type AzIsaacEntry,
} from "./isaac-archive.js";

const HEAD_SIZE = 0x30;
const ARC_MARK = "ARC\0";
const ASB_MARK = "ASB\0";
const EXT_COUNT_AT = 4;
const COUNT_AT = 8;
const INDEX_LENGTH_AT = 0x0c;
const MOST_EXT = 8;
const CHECKSUM_AT = 0;
const CHECKSUM_HEAD = 4;
const ASB_HEAD = 0x10;
const ADLER_HEAD = 4;
const WORD = 4;
export const AZ_DEFAULT_SEED = [0x2f4d7dfe, 0x47345292, 0x1ba5fe82, 0x7bc04525];
const SEED_WORDS = 4;
const SEED_BYTES = 0x10;
const ASB_KEY = 0x9e370001;
const ROTATE_BITS = 64;
const ROTATE_MASK = 0x3f;
const MASK64 = 0xffffffffffffffffn;
const SYSENV_NAME = "sysenv.tbl";
const SYSTEM_NAME = "system.arc";

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function rotateLeft64(value: bigint, count: number): bigint {
	const at = BigInt(count & ROTATE_MASK);
	return BigInt.asUintN(64, (value << at) | (value >> (64n - at)));
}

export function generateAzIndexKey(seed: number[]): number {
	const bytes = Buffer.alloc(SEED_BYTES, 0x00);
	for (let i = 0; i < SEED_WORDS; i += 1)
		bytes.writeUInt32LE((seed[i] ?? 0) >>> 0, i * WORD);
	const first = seed[0] ?? 0;
	const second = seed[1] ?? 0;
	let combined = crc32Update(bytes, ~first >>> 0);
	combined ^= crc32Update(bytes, ~(second & 0xffff) >>> 0);
	combined ^= crc32Update(bytes, ~(second >>> 16) >>> 0);
	combined ^= crc32Update(bytes, ~(seed[2] ?? 0) >>> 0);
	combined ^= crc32Update(bytes, ~(seed[3] ?? 0) >>> 0);
	return (first ^ (~combined >>> 0)) >>> 0;
}

export function generateAzContentKey(environment: Buffer): number {
	const seed = new Array<number>(SEED_WORDS).fill(0);
	const twister = new FastMersenneTwister(
		adler32(environment.subarray(0, SEED_BYTES)),
	);
	seed[0] = twister.nextUint32();
	seed[1] = (twister.nextUint32() & 0xffff) | (twister.nextUint32() << 16);
	seed[2] = twister.nextUint32();
	seed[3] = twister.nextUint32();
	return generateAzIndexKey(seed);
}

export function decryptAz(data: Buffer, offset: number, key: number): void {
	let hash = (BigInt(key >>> 0) * BigInt(ASB_KEY)) & MASK64;
	if ((offset & ROTATE_MASK) !== 0) hash = rotateLeft64(hash, offset);
	const cycle = Buffer.alloc(ROTATE_BITS, 0x00);
	for (let i = 0; i < ROTATE_BITS; i += 1) {
		cycle[i] = Number(hash & 0xffn);
		hash = rotateLeft64(hash, 1);
	}
	for (let i = 0; i < data.length; i += 1)
		data[i] = (data[i] ?? 0) ^ (cycle[(offset + i) % ROTATE_BITS] ?? 0);
}

async function unpackAzData(data: Buffer, at: number): Promise<Buffer> {
	const length = data.length - at;
	if (length <= ADLER_HEAD) return Buffer.from(data.subarray(at));
	const checksum = data.readUInt32LE(at);
	if (checksum !== adler32(data.subarray(at + ADLER_HEAD))) {
		return Buffer.from(data.subarray(at));
	}
	return Buffer.from(await inflateZlibBuffer(data.subarray(at + ADLER_HEAD)));
}

export interface AzEncryptedLayout {
	entries: AzIsaacEntry[];
	indexKey: number;
	contentKey: number;
}

export interface AzEncryptedEntry extends AzIsaacEntry {
	sysenv: boolean;
}

async function readIndex(
	data: Buffer,
	head: Buffer,
	indexKey: number,
): Promise<AzIsaacEntry[] | undefined> {
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
	decryptAz(packed, HEAD_SIZE, indexKey);
	const checksum = packed.readUInt32LE(CHECKSUM_AT);
	const body = packed.subarray(CHECKSUM_HEAD);
	if (
		checksum !== adler32(body) &&
		checksum !== (crc32Update(body, 0xffffffff) ^ 0xffffffff) >>> 0
	)
		throw invalidArchive(
			"The places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of the walk of them stand beside the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the places of the picture of the walk of the places of the picture of their own",
		);
	let index: Buffer;
	try {
		index = Buffer.from(await inflateZlibBuffer(body));
	} catch {
		return undefined;
	}
	return parseAzIndex(index, count, HEAD_SIZE + indexLength, data.length);
}

async function readSysenvSeed(
	data: Buffer,
	entries: AzIsaacEntry[],
	indexKey: number,
): Promise<number> {
	const found = entries.find(
		(entry) => entry.path.toLowerCase() === SYSENV_NAME,
	);
	if (!found) return indexKey;
	const stored = Buffer.from(
		data.subarray(found.offset, found.offset + found.size),
	);
	if (stored.length <= WORD) throw invalidArchive("Invalid sysenv.tbl size");
	decryptAz(stored, found.offset, indexKey);
	const checksum = stored.readUInt32LE(0);
	if (checksum !== adler32(stored.subarray(ADLER_HEAD)))
		throw invalidArchive("Invalid encryption scheme");
	const seed = Buffer.from(
		await inflateZlibBuffer(stored.subarray(ADLER_HEAD)),
	);
	return generateAzContentKey(seed.subarray(0, SEED_BYTES));
}

export async function readAzEncryptedLayout(
	data: Buffer,
	sourcePath?: string,
): Promise<AzEncryptedLayout | undefined> {
	if (data.length < HEAD_SIZE) return undefined;
	const indexKey = generateAzIndexKey(AZ_DEFAULT_SEED);
	const head = Buffer.from(data.subarray(0, HEAD_SIZE));
	decryptAz(head, 0, indexKey);
	if (head.subarray(0, ARC_MARK.length).toString("latin1") !== ARC_MARK)
		return undefined;
	const entries = await readIndex(data, head, indexKey);
	if (!entries) return undefined;
	let contentKey = indexKey;
	const own = (sourcePath ?? "").replace(/^.*[/\\]/, "").toLowerCase();
	if (own === SYSTEM_NAME) {
		contentKey = await readSysenvSeed(data, entries, indexKey);
	} else if (sourcePath !== undefined) {
		const companion = await readCompanionFile(sourcePath, SYSTEM_NAME);
		if (companion) {
			const companionHead = Buffer.from(companion.subarray(0, HEAD_SIZE));
			if (companionHead.length === HEAD_SIZE) {
				decryptAz(companionHead, 0, indexKey);
				const companionEntries = await readIndex(
					companion,
					companionHead,
					indexKey,
				);
				if (companionEntries)
					contentKey = await readSysenvSeed(
						companion,
						companionEntries,
						indexKey,
					);
			}
		}
	}
	return { entries, indexKey, contentKey };
}

export async function unpackAzEncryptedEntry(
	data: Buffer,
	layout: AzEncryptedLayout,
	entry: AzIsaacEntry,
): Promise<Buffer> {
	const stored = Buffer.from(
		data.subarray(entry.offset, entry.offset + entry.size),
	);
	const sysenv = entry.path.toLowerCase() === SYSENV_NAME;
	decryptAz(stored, entry.offset, sysenv ? layout.indexKey : layout.contentKey);
	if (sysenv) return unpackAzData(stored, 0);
	if (
		stored.length > 0x14 &&
		stored.subarray(0, ASB_MARK.length).toString("latin1") === ASB_MARK &&
		decryptAsb(stored)
	) {
		const header = Buffer.from(stored.subarray(0, ASB_HEAD));
		const body = await unpackAzData(stored, ASB_HEAD);
		return Buffer.concat([header, body]);
	}
	return unpackAzData(stored, 0);
}

export const azEncryptedArchiveDescriptor: FormatDescriptor = {
	id: "azsys-encrypted-archive",
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

export const azEncryptedArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: azEncryptedArchiveDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from([0xeb, 0x06, 0xea, 0x53]) },
			{ bytes: Buffer.from([0x2f, 0x8f, 0xf9, 0x74]) },
		],
	},
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return (await readAzEncryptedLayout(data, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = await readAzEncryptedLayout(data, sourcePath);
		if (!layout) throw invalidArchive("Not an archive of this kind");
		return {
			entries: layout.entries.map((entry, id) => {
				const placed: AzEncryptedEntry = {
					...normalizeEntryPath(entry.path),
					offset: entry.offset,
					size: entry.size,
					sysenv: entry.path.toLowerCase() === SYSENV_NAME,
				};
				return createFixedEntry({
					id,
					path: placed.path,
					offset: BigInt(placed.offset),
					size: BigInt(placed.size),
					encrypted: true,
					compressed: !placed.sysenv,
				});
			}),
			metadata: { encrypted: true },
		};
	},
	async openEntry(source: ByteSource, entry, sourcePath) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = await readAzEncryptedLayout(data, sourcePath);
		if (!layout) throw invalidArchive("Not an archive of this kind");
		const found = layout.entries.find(
			(candidate) =>
				candidate.path === entry.path &&
				BigInt(candidate.offset) === entry.offset,
		);
		if (!found) throw invalidArchive(`Archive entry not found: ${entry.path}`);
		return Readable.from([await unpackAzEncryptedEntry(data, layout, found)]);
	},
});
