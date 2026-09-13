// Format reference: GARbro "ArcFormats/FlyingShine/ArcPD.cs", class `FlyingShinePdOpener` (the `PD/2`
// tag).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decodeCp932, GarbroError } from "@garbro-mcp/core";
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
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `Flyi` followed by the long format name. */
const SIGNATURE = Buffer.from("Flyi", "latin1");
const MARKER = Buffer.from("ngShinePDFile\0", "latin1");
const KEY_OFFSET = 0x14;
const COUNT_OFFSET = 0x1c;
const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x30;
/** The name field ends where the offset words start. */
const NAME_LIMIT = 0x24;
const SHIFT_OFFSET = 0x24;
const OFFSET_OFFSET = 0x28;
const SIZE_OFFSET = 0x2c;
/** The ogg header check reads thirty five bytes: `OggS`, the page flags and the `vorbis` marker. */
const OGG_HEADER_SIZE = 0x23;
const OGG_SIGNATURE = Buffer.from("OggS", "latin1");
const OGG_MARKER = Buffer.from("vorbis", "latin1");
/** The page flags byte is rewritten, the two following bytes are the expected values. */
const OGG_MODIFIED_INDEX = 0x1a;
const OGG_FLAG_INDEX = 0x1b;
const OGG_FLAG_VALUE = 0x1e;
const OGG_VERSION_INDEX = 0x1c;
const OGG_VERSION_VALUE = 0x01;
/** The script key is derived from the last byte and validated with the one before it. */
const SCRIPT_KEY_XOR = 0x0a;
const SCRIPT_MARKER = 0x0d;

interface Pd2Entry {
	path: string;
	offset: bigint;
	size: bigint;
	script: boolean;
	ogg: boolean;
}

/** GARbro `FlyingShinePdOpener.TryOpen`: a keyed index of fixed size records. */
async function readPd2Index(
	source: ByteSource,
): Promise<Pd2Entry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const head = Buffer.from(await source.readAt(0n, INDEX_OFFSET));
	if (!head.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (!head.subarray(4, 4 + MARKER.length).equals(MARKER)) return undefined;
	const key = head[KEY_OFFSET] ?? 0;
	const count = head.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = RECORD_SIZE * count;
	if (BigInt(INDEX_OFFSET) + BigInt(indexSize) > source.size) return undefined;
	let index: Buffer;
	try {
		index = Buffer.from(await source.readAt(BigInt(INDEX_OFFSET), indexSize));
	} catch {
		return undefined;
	}
	const entries: Pd2Entry[] = [];
	for (let i = 0; i < count; i += 1) {
		const position = i * RECORD_SIZE;
		// The whole record is masked with the archive key.
		const record = Buffer.alloc(RECORD_SIZE);
		for (let j = 0; j < RECORD_SIZE; j += 1)
			record[j] = (index[position + j] ?? 0) ^ key;
		let length = 0;
		while (length < NAME_LIMIT && (record[length] ?? 0) !== 0) length += 1;
		if (length <= 0 || length >= NAME_LIMIT) return undefined;
		const name = decodeCp932(record.subarray(0, length));
		const shift = record.readUInt32LE(SHIFT_OFFSET);
		// Both the start and the end are stored shifted, so the size follows from the difference.
		const offset = (record.readUInt32LE(OFFSET_OFFSET) - shift) >>> 0;
		const size = (record.readUInt32LE(SIZE_OFFSET) - shift) >>> 0;
		if (!checkPlacement(BigInt(offset), BigInt(size), source.size))
			return undefined;
		const lower = name.toLowerCase();
		entries.push({
			path: name,
			offset: BigInt(offset),
			size: BigInt(size),
			script: lower.endsWith(".def") || lower.endsWith(".dsf"),
			ogg: lower.endsWith(".ogg"),
		});
	}
	return entries.length > 0 ? entries : undefined;
}

export const flyingShinePd2Descriptor: FormatDescriptor = {
	id: "flying-shine-pd2",
	name: "Flying Shine resource archive version 2",
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
			source: "ArcFormats/FlyingShine/ArcPD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const flyingShinePd2Format: ArchiveFormat = defineFixedArchive({
	descriptor: flyingShinePd2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPd2Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const parsed = await readPd2Index(source);
		if (!parsed)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Flying Shine PD version 2 layout",
			);
		const entries: FixedEntry[] = parsed.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				offset: entry.offset,
				size: entry.size,
				encrypted: entry.script || entry.ogg,
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const lower = entry.path.toLowerCase();
		if (lower.endsWith(".ogg") && data.length > OGG_HEADER_SIZE - 1) {
			return Readable.from([patchOggPage(data)]);
		}
		if ((lower.endsWith(".def") || lower.endsWith(".dsf")) && data.length >= 2)
			return Readable.from([decodeScript(data)]);
		return Readable.from([data]);
	},
});

/** `FlyingShinePdOpener.OpenOgg`: only a page header flag is rewritten. */
function patchOggPage(data: Buffer): Buffer {
	const header = data.subarray(0, OGG_HEADER_SIZE);
	if (!header.subarray(0, 4).equals(OGG_SIGNATURE)) return data;
	if ((header[OGG_MODIFIED_INDEX] ?? 0) === 1) return data;
	if ((header[OGG_FLAG_INDEX] ?? 0) !== OGG_FLAG_VALUE) return data;
	if ((header[OGG_VERSION_INDEX] ?? 0) !== OGG_VERSION_VALUE) return data;
	if (!header.subarray(0x1d, 0x1d + OGG_MARKER.length).equals(OGG_MARKER))
		return data;
	data[OGG_MODIFIED_INDEX] = 1;
	return data;
}

/** `FlyingShinePdOpener.OpenEntry`: the script key lives in the two trailing bytes. */
function decodeScript(data: Buffer): Buffer {
	const key = (data[data.length - 1] ?? 0) ^ SCRIPT_KEY_XOR;
	if (((data[data.length - 2] ?? 0) ^ key) !== SCRIPT_MARKER) return data;
	for (let index = 0; index < data.length; index += 1)
		data[index] = (data[index] ?? 0) ^ key;
	return data;
}
