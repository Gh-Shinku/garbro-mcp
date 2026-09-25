// Port of GARbro "ArcFormats/Tactics/ArcTactics.cs" (tag "ARC/Tactics", class ArcOpener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. An archive of the engine of Tactics, of an index
// of the words of the LZSS engine and of a password the index of the words of it carries.

import { inflateLzss, inflateLzssAll } from "@garbro-mcp/codecs";
import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";
const HEAD_SIZE = 0x20;
/** The mark of the engine at 0 and the words of the head of it at 4. */
const MARK = 0x54434154;
const HEAD_MARK = "ICS_ARC_FILE";
/** The counts of the places of a word of the index of a picture of the words of it. */
const ENTRY_SIZES = [0x18, 0x10] as const;
/** The count of the places of the file of a word of the index of the places of the picture. */
const TABLE_WORD = 0x10;
/** The count of the places of the file of a name of the index. */
const MAX_NAME_LENGTH = 0x100;

export interface TacticsLayout {
	packedSize: number;
	unpackedSize: number;
	count: number;
}

export interface TacticsRecord {
	name: string;
	offset: bigint;
	size: bigint;
	unpackedSize: bigint;
	packed: boolean;
}

export interface TacticsIndex {
	layout: TacticsLayout;
	records: TacticsRecord[];
	/** The password of the index of the words of the picture, of no password of the engine. */
	password?: Buffer;
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `ArcOpener.TryOpen` of the head of the picture and of the words of the index of it. */
export function readTacticsLayout(data: Buffer): TacticsLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (data.readUInt32LE(0) !== MARK) return undefined;
	if (data.toString("latin1", 4, 4 + HEAD_MARK.length) !== HEAD_MARK) {
		return undefined;
	}
	const packedSize = data.readUInt32LE(0x10);
	const unpackedSize = data.readUInt32LE(0x14);
	const count = data.readInt32LE(0x18);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(packedSize) + BigInt(HEAD_SIZE) > BigInt(data.length)) {
		return undefined;
	}
	// The reference stands of the words of the index of the file alone where the count of the places of
	// them stands of nought; a count of the places of the index of no count of them is refused here.
	if (0 === unpackedSize || unpackedSize > 0x10000000) return undefined;
	return { packedSize, unpackedSize, count };
}

/** `IndexReader.ReadV0`: the words of the index of the places of the file, of no password of them. */
function readIndexV0(
	data: Buffer,
	layout: TacticsLayout,
): TacticsRecord[] | undefined {
	const base = BigInt(HEAD_SIZE + layout.packedSize);
	const tableSize = layout.count * TABLE_WORD;
	if (base + BigInt(tableSize) > BigInt(data.length)) return undefined;
	let index: Buffer;
	try {
		index = inflateLzss(
			data.subarray(HEAD_SIZE, HEAD_SIZE + layout.packedSize),
			{
				outputLength: layout.unpackedSize,
			},
		);
	} catch {
		return undefined;
	}
	// The reference stands of the words of the index of the file alone where the walk of them stands
	// of the places of the file of it short.
	if (index.length !== layout.unpackedSize) return undefined;
	// `m_index[i] = ~m_index[i] - 5` of the reference: the places of the words of the index stand of the
	// places of the file the other way round, of five places less.
	for (let at = 0; at < index.length; at += 1) {
		index[at] = (~(index[at] ?? 0) - 5) & 0xff;
	}
	let at = index.indexOf(0);
	// The first words of the index stand of the password of the picture, which the reference reads and
	// lets stand: the words of the index of them stand of no password of them.
	if (at <= 0) return undefined;
	at += 1;
	const records: TacticsRecord[] = [];
	let table = base;
	for (let place = 0; place < layout.count && at < index.length; place += 1) {
		let end = index.indexOf(0, at);
		if (end < 0) end = index.length;
		if (at === end) return undefined;
		const offset = BigInt(data.readUInt32LE(Number(table)));
		const size = BigInt(data.readUInt32LE(Number(table) + 4));
		const unpackedSize = BigInt(data.readUInt32LE(Number(table) + 8));
		if (!checkPlacement(offset, size, BigInt(data.length))) return undefined;
		records.push({
			name: decodeCp932(index.subarray(at, end)),
			offset,
			size,
			unpackedSize: 0n !== unpackedSize ? unpackedSize : size,
			packed: 0n !== unpackedSize,
		});
		at = end + 1;
		table += BigInt(TABLE_WORD);
	}
	return records;
}

/** `IndexReader.ReadV1`: the words of the index of the words of the picture itself, of a password. */
function readIndexV1(
	data: Buffer,
	layout: TacticsLayout,
	entrySize: number,
): { records: TacticsRecord[]; password: Buffer } | undefined {
	const base = BigInt(HEAD_SIZE + layout.packedSize);
	let index: Buffer;
	try {
		// `InputCryptoStream` of `NotTransform`: every place of the words of the index stands of the
		// places of the file the other way round, of the words of the LZSS engine behind them.
		const inverted = Buffer.from(
			data.subarray(HEAD_SIZE, HEAD_SIZE + layout.packedSize),
		);
		for (let at = 0; at < inverted.length; at += 1) {
			inverted[at] = ~(inverted[at] ?? 0) & 0xff;
		}
		index = inflateLzss(inverted, { outputLength: layout.unpackedSize });
	} catch {
		return undefined;
	}
	if (index.length !== layout.unpackedSize) return undefined;
	let at = index.indexOf(0);
	if (at <= 0) return undefined;
	const password = Buffer.from(index.subarray(0, at));
	at += 1;
	const records: TacticsRecord[] = [];
	for (let place = 0; place < layout.count; place += 1) {
		if (at + entrySize + 4 > index.length) return undefined;
		const offset = BigInt(index.readUInt32LE(at)) + base;
		const size = BigInt(index.readUInt32LE(at + 4));
		const unpackedSize = BigInt(index.readUInt32LE(at + 8));
		const nameLength = index.readInt32LE(at + 0x0c);
		if (nameLength <= 0 || nameLength > MAX_NAME_LENGTH) return undefined;
		if (at + entrySize + nameLength > index.length) return undefined;
		if (!checkPlacement(offset, size, BigInt(data.length))) return undefined;
		records.push({
			name: decodeCp932(
				index.subarray(at + entrySize, at + entrySize + nameLength),
			),
			offset,
			size,
			unpackedSize: 0n !== unpackedSize ? unpackedSize : size,
			packed: 0n !== unpackedSize,
		});
		at += entrySize + nameLength;
	}
	return { records, password };
}

/** `IndexReader.ReadIndex`: the first walk of the words of the index the picture stands of. */
export function parseTacticsIndex(data: Buffer): TacticsIndex | undefined {
	const layout = readTacticsLayout(data);
	if (!layout) return undefined;
	const v0 = readIndexV0(data, layout);
	if (v0) return { layout, records: v0 };
	for (const entrySize of ENTRY_SIZES) {
		const v1 = readIndexV1(data, layout, entrySize);
		if (v1) {
			return { layout, records: v1.records, password: v1.password };
		}
	}
	return undefined;
}

export const tacticsArcDescriptor: FormatDescriptor = {
	id: "tactics-arc",
	name: "Tactics resource archive",
	extensions: ["arc", "adf"],
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
			source: "ArcFormats/Tactics/ArcTactics.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

async function parseTacticsSource(
	source: ByteSource,
): Promise<TacticsIndex | undefined> {
	const data = Buffer.from(await source.readAt(0n, Number(source.size)));
	return parseTacticsIndex(data);
}

/** `ArcOpener.OpenEntry`: the password of the index of the picture, then the LZSS engine of it. */
export const tacticsEntryOpener: FixedEntryOpener = async (source, entry) => {
	const index = await parseTacticsSource(source);
	if (!index) throw invalidArchive("Invalid Tactics archive layout");
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize ?? entry.size)),
	);
	const password = index.password;
	if (password && password.length > 0) {
		for (let at = 0; at < data.length; at += 1) {
			data[at] = (data[at] ?? 0) ^ (password[at % password.length] ?? 0);
		}
	}
	if (!entry.compressed) return Readable.from([data]);
	return Readable.from([inflateLzssAll(data)]);
};

export const tacticsArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tacticsArcDescriptor,
	detection: {
		signatures: [
			{
				bytes: Buffer.concat([
					Buffer.from("TACT", "latin1"),
					Buffer.from("ICS_ARC_FILE", "latin1"),
				]),
			},
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return (await parseTacticsSource(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const index = await parseTacticsSource(source);
		if (!index) throw invalidArchive("Invalid Tactics archive layout");
		const entries: FixedEntry[] = index.records.map((record, id) => {
			const { path, rawPath } = normalizeEntryPath(record.name);
			return createFixedEntry({
				id,
				path,
				...(rawPath === undefined ? {} : { rawPath }),
				offset: record.offset,
				size: record.packed ? record.unpackedSize : record.size,
				packedSize: record.size,
				compressed: record.packed,
				metadata: {
					unpackedSize: record.unpackedSize.toString(),
					encrypted: index.password !== undefined,
				},
			});
		});
		return {
			entries,
			metadata: {
				entryCount: index.layout.count,
				packedSize: index.layout.packedSize,
				unpackedSize: index.layout.unpackedSize,
				encrypted: index.password !== undefined,
			},
		};
	},
	openEntry: tacticsEntryOpener,
});
