// Format reference: GARbro ArcFormats/StudioEgo/ArcPAK0.cs, classes `Pak0Opener` and `Pak0Reader`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	decodeCp932,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'PAK0', the format signature. */
const SIGNATURE = 0x304b4150;
/** The header holds the data offset and two counts. */
const HEADER_SIZE = 0x10;
const DATA_OFFSET_FIELD = 4;
const DIR_COUNT_FIELD = 8;
const COUNT_FIELD = 0xc;
const MIN_DATA_OFFSET = 0x14;
/** Directory records hold a parent index and the last file index of the directory. */
const DIR_RECORD_SIZE = 8;
const ROOT_DIR = -1;
/** File records hold an offset and a size. */
const FILE_RECORD_SIZE = 0x10;
/** Script payloads start with this marker and decrypt their body with one of two key schedules. */
const SCRIPT_MARKER = "SCR ";
const SCRIPT_MIN_SIZE = 0x1c;
const SCRIPT_VERSION_FIELD = 4;
const SCRIPT_METHOD_FIELD = 8;
const SCRIPT_KEY_FIELD = 0xc;
const SCRIPT_LENGTH_FIELD = 0x10;
const SCRIPT_DATA_OFFSET = 0x14;
const SCRIPT_METHOD_FIRST = 1;
const SCRIPT_METHOD_SECOND = 2;
const KEY_STEP = 0x7654321;
const KEY_PERIOD = 0xff;

interface Pak0Dir {
	parent: number;
	lastIndex: number;
	name?: string;
}

interface Pak0Entry {
	path: string;
	offset: bigint;
	size: bigint;
}

/** Reads one length prefixed name straight from the file, as the reference does. */
async function readName(
	source: ByteSource,
	position: number,
): Promise<{ name: string; position: number } | undefined> {
	if (BigInt(position) >= source.size) return undefined;
	const first = Buffer.from(await source.readAt(BigInt(position), 1));
	const length = first[0] ?? 0;
	const start = position + 1;
	if (BigInt(start + length) > source.size) return undefined;
	const bytes = Buffer.from(await source.readAt(BigInt(start), length));
	return { name: decodeCp932(bytes), position: start + length };
}

/** GARbro `Pak0Reader.GetPath`: walks the parent chain upwards and reverses the collected names. */
function directoryPath(dirs: readonly Pak0Dir[], index: number): string {
	const parts: (string | undefined)[] = [];
	for (let i = index; (dirs[i]?.parent ?? ROOT_DIR) !== ROOT_DIR; ) {
		if (i < 0 || i >= dirs.length) break;
		parts.push(dirs[i]?.name);
		i = dirs[i]?.parent ?? ROOT_DIR;
	}
	parts.reverse();
	return parts.filter((part) => part !== undefined).join("/");
}

async function readPak0(source: ByteSource): Promise<Pak0Entry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	const dataOffset = header.readUInt32LE(DATA_OFFSET_FIELD);
	if (dataOffset <= MIN_DATA_OFFSET || BigInt(dataOffset) >= source.size)
		return undefined;
	const dirCount = header.readInt32LE(DIR_COUNT_FIELD);
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(dirCount) || !isSaneCount(count)) return undefined;
	// Directories and file records come first, then every name, so the index block ends where the names begin.
	const recordsSize =
		HEADER_SIZE + dirCount * DIR_RECORD_SIZE + count * FILE_RECORD_SIZE;
	if (BigInt(recordsSize) > source.size) return undefined;
	const index = Buffer.from(await source.readAt(0n, recordsSize));
	let namePosition = recordsSize;
	const dirs: Pak0Dir[] = [];
	for (let i = 0; i < dirCount; i += 1) {
		const cursor = HEADER_SIZE + i * DIR_RECORD_SIZE;
		const parent = index.readInt32LE(cursor);
		const lastIndex = index.readInt32LE(cursor + 4);
		if (parent >= dirCount || parent === i) return undefined;
		const dir: Pak0Dir = { parent, lastIndex };
		if (parent !== ROOT_DIR) {
			const named = await readName(source, namePosition);
			if (!named) return undefined;
			dir.name = named.name;
			namePosition = named.position;
		}
		dirs.push(dir);
	}
	const entries: Pak0Entry[] = [];
	let recordPosition = HEADER_SIZE + dirCount * DIR_RECORD_SIZE;
	let current = 0;
	for (let i = 0; i < dirCount; i += 1) {
		const parent = directoryPath(dirs, i);
		while (current < (dirs[i]?.lastIndex ?? 0)) {
			const named = await readName(source, namePosition);
			if (!named) return undefined;
			namePosition = named.position;
			if (recordPosition + FILE_RECORD_SIZE > recordsSize) return undefined;
			const offset = BigInt(index.readUInt32LE(recordPosition));
			const size = BigInt(index.readUInt32LE(recordPosition + 4));
			recordPosition += FILE_RECORD_SIZE;
			entries.push({
				path: parent === "" ? named.name : `${parent}/${named.name}`,
				offset,
				size,
			});
			current += 1;
		}
	}
	return entries;
}

/**
 * GARbro `Pak0Opener.DecryptScript`: a key schedule over thirty-two bit words. Every 256 words the key is
 * either toggled between zero and one or complemented, then the constant step is added and the word is xored.
 */
export function decryptEgoScript(
	method: number,
	body: Buffer,
	key: number,
): void {
	for (let i = 0; i < body.length / 4; i += 1) {
		if ((i & KEY_PERIOD) === 0)
			key = method === SCRIPT_METHOD_FIRST ? (key === 0 ? 1 : 0) : ~key >>> 0;
		key = (key + KEY_STEP) >>> 0;
		const cursor = i * 4;
		body.writeUInt32LE((body.readUInt32LE(cursor) ^ key) >>> 0, cursor);
	}
}

/**
 * GARbro `Pak0Opener.OpenEntry`: a payload longer than 0x1C bytes that starts with `SCR `, declares a version
 * and uses method one or two has its body decrypted in place. Everything else is handed out as stored.
 */
async function openPak0Entry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const isScript =
		stored.length > SCRIPT_MIN_SIZE &&
		stored.subarray(0, SCRIPT_MARKER.length).toString("latin1") ===
			SCRIPT_MARKER;
	if (!isScript) return Readable.from([stored]);
	const version = stored.readUInt32LE(SCRIPT_VERSION_FIELD);
	const method = stored.readUInt32LE(SCRIPT_METHOD_FIELD);
	if (
		version === 0 ||
		(method !== SCRIPT_METHOD_FIRST && method !== SCRIPT_METHOD_SECOND)
	)
		return Readable.from([stored]);
	const length = stored.readInt32LE(SCRIPT_LENGTH_FIELD);
	if (length < 4 || length > stored.length + SCRIPT_DATA_OFFSET)
		return Readable.from([stored]);
	decryptEgoScript(
		method,
		stored.subarray(SCRIPT_DATA_OFFSET, SCRIPT_DATA_OFFSET + (length & ~3)),
		stored.readUInt32LE(SCRIPT_KEY_FIELD),
	);
	return Readable.from([stored]);
}

export const studioEgoPak0Descriptor: FormatDescriptor = {
	id: "studio-ego-pak0",
	name: "Studio e.go! resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/StudioEgo/ArcPAK0.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const studioEgoPak0Format = defineFixedArchive({
	descriptor: studioEgoPak0Descriptor,
	detection: { signatures: [{ bytes: Buffer.from("PAK0", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readPak0(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entries = await readPak0(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Studio e.go! layout");
		return {
			entries: entries.map((entry, id) => {
				const normalized = normalizeEntryPath(entry.path);
				return createFixedEntry({
					id,
					path: normalized.path,
					...(normalized.rawPath === undefined
						? {}
						: { rawPath: normalized.rawPath }),
					offset: entry.offset,
					size: entry.size,
					packedSize: entry.size,
					metadata: { type: "data" },
				});
			}),
			metadata: { entryCount: entries.length },
		};
	},
	openEntry: openPak0Entry,
});
