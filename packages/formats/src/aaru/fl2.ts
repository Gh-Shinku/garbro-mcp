// Format reference: GARbro Legacy/Aaru/ArcFL2.cs, ArcFL3.cs and ArcFL4.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
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
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { inflateAaruRle } from "./rle.js";

const ABSENT_SIZE = 0xffffffffn;
const MAXIMUM_NAME_LENGTH = 0x100;
const PD_TAG = Buffer.from("PD", "ascii");
const PD2A_TAG = Buffer.from("PD2A", "ascii");
const RD_TAG = Buffer.from("RD1.0", "ascii");

const AARU_ATTRIBUTION = [
	{
		project: "GARbro",
		source: "Legacy/Aaru/ArcFL2.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
	{
		project: "GARbro",
		source: "Legacy/Aaru/ArcFL3.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
	{
		project: "GARbro",
		source: "Legacy/Aaru/ArcFL4.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
];

export const fl2Descriptor: FormatDescriptor = {
	id: "aaru-fl2",
	name: "Aaru resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: AARU_ATTRIBUTION,
};

export const fl3Descriptor: FormatDescriptor = {
	id: "aaru-fl3",
	name: "Aaru resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: AARU_ATTRIBUTION,
};

function compressionKind(entry: FixedEntry): "pd2a" | "pd" | "rle" | "raw" {
	const kind = entry.metadata?.kind;
	if (kind === "pd2a" || kind === "pd" || kind === "rle") return kind;
	return "raw";
}

/** Mirrors FL4Opener.OpenEntry: PD2A/PD use LZSS, RD1.0 uses the Aaru RLE stream. */
const aaruEntryOpener: FixedEntryOpener = async (source, entry) => {
	const kind = compressionKind(entry);
	if (kind === "raw") return source.createReadStream(entry.offset, entry.size);
	if (kind === "pd2a" || kind === "pd") {
		const skip = kind === "pd2a" ? 16 : 10;
		const compressed = await source.readAt(
			entry.offset + BigInt(skip),
			Number(entry.size) - skip,
		);
		return Readable.from([inflateLzssAll(compressed)]);
	}
	const header = await source.readAt(entry.offset, 0x0e);
	const dataOffset = header.readUInt16LE(6);
	const chunks = header.readInt32LE(0x0a);
	if (dataOffset <= 0 || dataOffset >= entry.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`Aaru RD1.0 entry has an invalid data offset: ${entry.path}`,
		);
	}
	const compressed = await source.readAt(
		entry.offset + BigInt(dataOffset),
		Number(entry.size - BigInt(dataOffset)),
	);
	return Readable.from([inflateAaruRle(compressed, chunks)]);
};

async function classifyEntries(
	source: ByteSource,
	entries: FixedEntry[],
): Promise<void> {
	for (const entry of entries) {
		const probeSize = Number(entry.size < 0x10n ? entry.size : 0x10n);
		if (probeSize === 0) continue;
		const probe = await source.readAt(entry.offset, probeSize);
		let kind: "pd2a" | "pd" | "rle" | undefined;
		if (probe.subarray(0, 4).equals(PD2A_TAG)) kind = "pd2a";
		else if (probe.subarray(0, 2).equals(PD_TAG)) kind = "pd";
		else if (probe.subarray(0, 5).equals(RD_TAG)) kind = "rle";
		if (kind) {
			entry.compressed = true;
			entry.metadata = { kind };
		}
	}
}

async function readAaruIndex(
	source: ByteSource,
	indexOffset: bigint,
	indexSize: number,
	count: number,
	dataOffset: bigint,
): Promise<FixedEntry[]> {
	if (indexOffset + BigInt(indexSize) > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "Aaru index is truncated");
	}
	const index = await source.readAt(indexOffset, indexSize);
	const records: { path: string; rawPath?: string; size: bigint }[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		if (position + 5 > index.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Aaru index is truncated");
		}
		const size = BigInt(index.readUInt32LE(position));
		if (size === ABSENT_SIZE) break;
		const nameLength = index[position + 4] ?? 0;
		if (
			nameLength === 0 ||
			nameLength > MAXIMUM_NAME_LENGTH ||
			position + 5 + nameLength > index.length
		) {
			throw new GarbroError("INVALID_ARCHIVE", "Aaru entry name is invalid");
		}
		const field = index.subarray(position + 5, position + 5 + nameLength);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		position += 5 + (terminator === -1 ? nameLength : terminator + 1);
		if (name.length === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Aaru entry has an empty name");
		}
		records.push({ ...normalizeEntryPath(name), size });
	}
	let offset = dataOffset;
	const entries: FixedEntry[] = [];
	for (const [id, record] of records.entries()) {
		if (!checkPlacement(offset, record.size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Aaru entry points outside the archive: ${record.path}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: record.path,
				...(record.rawPath === undefined ? {} : { rawPath: record.rawPath }),
				offset,
				size: record.size,
			}),
		);
		offset += record.size;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Aaru archive is empty");
	}
	await classifyEntries(source, entries);
	return entries;
}

interface Fl2Header {
	count: number;
	dataOffset: bigint;
	indexOffset: bigint;
	indexSize: number;
}

async function parseFl2(source: ByteSource): Promise<Fl2Header | undefined> {
	if (source.size < 0x14n) return undefined;
	const header = await source.readAt(0n, 0x14);
	if (header.readUInt32LE(0) !== 0x2e324c46) return undefined;
	if (header.readUInt8(4) !== 0x30) return undefined;
	const dataOffset = BigInt(header.readUInt16LE(6));
	const count = header.readInt16LE(8);
	if (!isSaneCount(count)) return undefined;
	const indexSize = header.readUInt32LE(0x0c);
	const indexOffset = BigInt(header.readUInt32LE(0x10));
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	return { count, dataOffset, indexOffset, indexSize };
}

interface Fl3Header {
	count: number;
	dataOffset: bigint;
	indexOffset: bigint;
	indexSize: number;
}

async function parseFl3(source: ByteSource): Promise<Fl3Header | undefined> {
	if (source.size < 0x1an) return undefined;
	const header = await source.readAt(0n, 0x1a);
	if (header.readUInt32LE(0) !== 0x2e334c46) return undefined;
	if (header.readUInt8(4) !== 0x30) return undefined;
	const dataOffset = BigInt(header.readUInt16LE(8));
	const indexSize = header.readUInt32LE(0x0a);
	const indexOffset = BigInt(header.readUInt32LE(0x0e));
	const count = header.readInt32LE(0x12);
	if (!isSaneCount(count)) return undefined;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	return { count, dataOffset, indexOffset, indexSize };
}

export const fl2Format: ArchiveFormat = defineFixedArchive({
	descriptor: fl2Descriptor,
	detection: { signatures: [{ bytes: Buffer.from("FL2.0", "ascii") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseFl2(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const header = await parseFl2(source);
		if (!header) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Aaru FL2.0 layout");
		}
		const entries = await readAaruIndex(
			source,
			header.indexOffset,
			header.indexSize,
			header.count,
			header.dataOffset,
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: aaruEntryOpener,
});

export const fl3Format: ArchiveFormat = defineFixedArchive({
	descriptor: fl3Descriptor,
	detection: { signatures: [{ bytes: Buffer.from("FL3.0", "ascii") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseFl3(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const header = await parseFl3(source);
		if (!header) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Aaru FL3.0 layout");
		}
		const entries = await readAaruIndex(
			source,
			header.indexOffset,
			header.indexSize,
			header.count,
			header.dataOffset,
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: aaruEntryOpener,
});
