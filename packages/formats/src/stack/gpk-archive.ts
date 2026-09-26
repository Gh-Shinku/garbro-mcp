// Port of GARbro "ArcFormats/Stack/ArcGPK.cs" (tag "GPK/STACK", class GpkOpener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. An archive of the Stack script engine: the index
// of the archive stands at its end, exclusive-ored with a cipher the engine keeps in a resource of a
// neighbouring executable, and the pictures and scripts of the archive stand in front of it.
//
// The reference takes the cipher out of the resource `CODE` of the kind `CIPHERCODE` of an executable of the
// directory above the archive and then of the archive's own directory, in that order (`GpkOpener.QueryKey`
// through `ExeFile.ResourceAccessor`), and refuses the whole archive where it holds none. This port walks
// the same two directories (`packages/formats/src/entis/noa-keys.ts` does the same for its engine) and reads
// the same resource out of a portable executable (`packages/formats/src/shared/exe.ts`).

import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { readdir, readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { findExecutableResource } from "../shared/exe.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";
/** The word of the index of the archive, and the word of the places of the pictures of it. */
export const GPK_INDEX_MARK = "STKFile0PIDX";
export const GPK_PACK_MARK = "STKFile0PACKFILE";
/** How much of the file the two words and the count of the index stand of, at its end. */
export const GPK_FOOTER_SIZE = 32;
/** The count of the places of the file the count of the index stands at, of the foot of the file. */
const INDEX_SIZE_AT = 12;
/** The resource of the executable of the engine the cipher of the index stands in. */
export const GPK_KEY_RESOURCE = { type: "CIPHERCODE", name: "CODE" } as const;
/** The most bytes one executable may be, which this port reads at all. */
const EXECUTABLE_LIMIT = 0x2000000;
/** The count of the places of the cipher the reference stands of the count of twenty of the resource. */
const SHORT_KEY_SIZE = 20;
const SHORT_KEY_AT = 4;

/** A picture or a script of the engine: where its places stand, of what count, and its own head. */
export interface GpkRecord {
	name: string;
	offset: number;
	size: number;
	unpacked: number;
	header: Buffer;
}

/** `ByteStringEncryptedStream`: every place of the file stands exclusive-ored with a place of the cipher. */
export function decryptGpk(data: Buffer, key: Buffer): Buffer {
	const out = Buffer.from(data);
	if (0 === key.length) return out;
	for (let at = 0; at < out.length; at += 1) {
		out[at] = (out[at] ?? 0) ^ (key[at % key.length] ?? 0);
	}
	return out;
}

/**
 * `GpkOpener.TryOpen`: the two words of the foot of the file, the count of the index in front of them, and
 * the index itself behind them. `fileSize` is the count of the places of the whole file, which the places
 * of a picture of the engine are checked against.
 */
export async function parseGpkIndex(
	file: Buffer,
	key: Buffer,
): Promise<GpkRecord[] | undefined> {
	const fileSize = file.length;
	let indexOffset = fileSize - GPK_FOOTER_SIZE;
	if (indexOffset <= 0) return undefined;
	if (
		file.toString(
			"latin1",
			indexOffset,
			indexOffset + GPK_INDEX_MARK.length,
		) !== GPK_INDEX_MARK
	) {
		return undefined;
	}
	if (
		file.toString(
			"latin1",
			indexOffset + 16,
			indexOffset + 16 + GPK_PACK_MARK.length,
		) !== GPK_PACK_MARK
	) {
		return undefined;
	}
	const indexSize = file.readUInt32LE(indexOffset + INDEX_SIZE_AT);
	if (indexSize > indexOffset) return undefined;
	indexOffset -= indexSize;
	const body = decryptGpk(
		file.subarray(indexOffset, indexOffset + indexSize),
		key,
	);
	let index: Buffer;
	try {
		index = await inflateZlibBuffer(body.subarray(4));
	} catch {
		return undefined;
	}
	return readGpkRecords(index, fileSize);
}

/** The records of the index, of the places of the file they stand of. */
function readGpkRecords(
	index: Buffer,
	fileSize: number,
): GpkRecord[] | undefined {
	const records: GpkRecord[] = [];
	let at = 0;
	while (at + 2 <= index.length) {
		const nameLength = index.readUInt16LE(at) * 2;
		if (0 === nameLength) break;
		at += 2;
		// The reference grows its own buffer of a name where a name stands beyond the places of it, so a
		// name of any count may stand here as well.
		if (at + nameLength + 19 > index.length) return undefined;
		const name = index.toString("utf16le", at, at + nameLength);
		at += nameLength;
		at += 4; // the places of the file the reference stands of no use of
		at += 2; // the places of the file the reference stands of no use of
		const offset = index.readUInt32LE(at);
		const size = index.readUInt32LE(at + 4);
		at += 8;
		if (offset + size > fileSize) return undefined;
		at += 4; // the places of the file the reference stands of no use of
		const unpacked = index.readUInt32LE(at);
		at += 4;
		const headerLength = index.readUInt8(at);
		at += 1;
		if (at + headerLength > index.length) return undefined;
		const header = Buffer.from(index.subarray(at, at + headerLength));
		at += headerLength;
		records.push({ name, offset, size, unpacked, header });
	}
	if (0 === records.length) return undefined;
	return records;
}

/** The executables of a directory, sorted, with the ones too long to hold a resource left out. */
async function listExecutables(directory: string): Promise<string[]> {
	try {
		const names = await readdir(directory);
		return names
			.filter((name) => name.toLowerCase().endsWith(".exe"))
			.sort()
			.map((name) => resolve(directory, name));
	} catch {
		return [];
	}
}

/**
 * `GpkOpener.QueryKey`: the cipher of the index out of the executables of the directory above the archive and
 * then of the archive's own directory, in that order.
 */
export async function findGpkKey(
	sourcePath: string,
): Promise<Buffer | undefined> {
	const directory = dirname(sourcePath);
	const above = dirname(directory);
	const candidates = [
		...(above === directory ? [] : await listExecutables(above)),
		...(await listExecutables(directory)),
	];
	for (const candidate of candidates) {
		let data: Buffer;
		try {
			data = await readFile(candidate);
		} catch {
			continue;
		}
		if (data.length > EXECUTABLE_LIMIT) continue;
		const code = findExecutableResource(data, {
			type: GPK_KEY_RESOURCE.type,
			name: GPK_KEY_RESOURCE.name,
		});
		if (!code || 0 === code.length) continue;
		// The reference stands of the places of the resource behind the first four of them where the
		// resource stands of twenty places, and of the whole of it otherwise.
		return SHORT_KEY_SIZE === code.length
			? Buffer.from(code.subarray(SHORT_KEY_AT))
			: Buffer.from(code);
	}
	return undefined;
}

export const stackGpkDescriptor: FormatDescriptor = {
	id: "stack-gpk-archive",
	name: "Stack script engine resource archive",
	extensions: [],
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
			source: "ArcFormats/Stack/ArcGPK.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

export const stackGpkEntryOpener: FixedEntryOpener = async (
	source,
	entry,
	_sourcePath,
) => {
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const header = entry.metadata?.header;
	const prefix =
		header instanceof Buffer && header.length > 0
			? Buffer.concat([header, data])
			: data;
	if (true !== entry.metadata?.packed) return Readable.from([prefix]);
	// The reference stands of the head of a picture of the engine in front of the places of it and then of
	// the walk of the places of the file over the whole of the two, so the head stands of the walk as well.
	return Readable.from([inflateZlibBuffer(prefix)]);
};

export const stackGpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: stackGpkDescriptor,
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (source.size <= BigInt(GPK_FOOTER_SIZE)) return false;
		if (!sourcePath) return false;
		const key = await findGpkKey(sourcePath);
		if (!key) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return (await parseGpkIndex(data, key)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const key = await findGpkKey(sourcePath);
		if (!key)
			throw invalidArchive("The cipher of the archive stands of no executable");
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const records = await parseGpkIndex(data, key);
		if (!records)
			throw invalidArchive("Not an archive of the Stack script engine");
		const entries: FixedEntry[] = records.map(
			(record, id) =>
				({
					...createFixedEntry({
						id,
						path: record.name,
						offset: BigInt(record.offset),
						size: BigInt(record.size),
						compressed: 0 !== record.unpacked,
						metadata: {
							type: "file",
							unpackedSize:
								0 !== record.unpacked ? record.unpacked : record.size,
							packed: 0 !== record.unpacked,
							header: record.header,
						} as Record<string, unknown>,
					}),
					sizeKnown: true,
				}) as FixedEntry,
		);
		return {
			entries,
			metadata: { keys: ["cipher-of-the-executable"], count: entries.length },
		};
	},
	openEntry: stackGpkEntryOpener,
});

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}
