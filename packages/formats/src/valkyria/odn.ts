// Format reference: GARbro "ArcFormats/Valkyria/ArcODN.cs", classes `OdnOpener` and
// `OdnIndexReader` (the image decoder and the `.pni` scheme INI are out of scope).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeRiffHeader } from "../kapp/asd.js";
import { detectFileType } from "../shared/detect-type.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference only opens files these extensions. */
const EXTENSIONS = ["odn", "dat", "pni"];
const HEADER_SIZE = 0x1c;
const V1_RECORD_SIZE = 0x10;
const V2_RECORD_SIZES = [0x10, 0x18];
const INDEX_RECORD_SIZE = 0x10;
const NAME_SIZE = 8;
const OFFSET_SIZE = 8;
const V1_END = "END_ffffffffffff";
const V1_TERMINATOR = "ffffffffffffffff";
const HIME_END = "HIME_END";
/** A first record with this offset field selects the first layout. */
const ZERO_OFFSET = "00000000";
/** The `HIME_END` marker is followed by eight more bytes before the payload area starts. */
const HIME_END_EXTRA = 8;
/** The encrypted layout is unmasked with a key that counts down from `0xFF`. */
const INDEX_KEY = 0xff;
/** `OggS` masked with `0x0D` marks an audio payload. */
const MASKED_OGG_SIGNATURE = 0x5e6a6a42;
const OGG_MASK = 0x0d;
const RIFF_SIGNATURE = 0x46464952;
const NAME_PATTERNS = {
	image24: /^(?:back|phii|psss)/,
	image32: /^(?:data|codn|cccc|fund|puni|wind)/,
	script: /^(?:scrp|menu|sysm)/,
	audio: /^hime/,
};
/** GARbro exposes `22050` and `44100` as a user setting; the port fixes the value. */
const AUDIO_SAMPLE_RATE = 44100;
const AUDIO_CHANNELS = 1;
const AUDIO_BLOCK_ALIGN = 2;
const AUDIO_BITS_PER_SAMPLE = 16;
/** Guard against index records that never reach their terminator. */
const ENTRY_LIMIT = 0x40000;

interface OdnEntry {
	path: string;
	rawPath?: string;
	offset: number;
	size: number;
	type?: string;
	encrypted: boolean;
	masked: boolean;
}

interface OdnIndex {
	entries: OdnEntry[];
	scriptsEncrypted: boolean;
}

function ascii(data: Buffer, start: number, length: number): string {
	return data.subarray(start, start + length).toString("latin1");
}

function isAscii(data: Buffer, length: number): boolean {
	for (let i = 0; i < length; i += 1) {
		const value = data[i] ?? 0;
		if (value < 0x20 || value > 0x7e) return false;
	}
	return true;
}

/** Parses the eight character hexadecimal offset field of an index record. */
function parseOffset(text: string): number | undefined {
	if (!/^[0-9a-fA-F]{1,8}$/.test(text)) return undefined;
	return Number.parseInt(text, 16) >>> 0;
}

/** GARbro `XoredStream`, used for the masked Ogg payloads: one constant key for every byte. */
function xorConstant(data: Buffer, key: number): void {
	for (let i = 0; i < data.length; i += 1) data[i] = (data[i] ?? 0) ^ key;
}

/** GARbro `OdnOpener.Decrypt`: the key counts down for every byte. */
function xorCountdown(data: Buffer, length: number, key: number): number {
	let current = key & 0xff;
	for (let i = 0; i < length; i += 1) {
		data[i] = (data[i] ?? 0) ^ current;
		current = (current - 1) & 0xff;
	}
	return current;
}

async function readExact(
	source: ByteSource,
	offset: number,
	size: number,
): Promise<Buffer | undefined> {
	try {
		const data = Buffer.from(await source.readAt(BigInt(offset), size));
		return data.length === size ? data : undefined;
	} catch {
		return undefined;
	}
}

/** GARbro `OdnIndexReader.ReadV1`: relative offsets, eight byte text fields. */
async function readV1(source: ByteSource): Promise<OdnIndex | undefined> {
	const entries: OdnEntry[] = [];
	let scriptsEncrypted = true;
	let indexOffset = 0;
	for (;;) {
		const record = await readExact(source, indexOffset, V1_RECORD_SIZE);
		if (!record) return undefined;
		indexOffset += V1_RECORD_SIZE;
		const text = ascii(record, 0, V1_RECORD_SIZE);
		if (text === V1_END) break;
		if (text === V1_TERMINATOR) {
			scriptsEncrypted = false;
			break;
		}
		if (text.startsWith(HIME_END)) {
			indexOffset += HIME_END_EXTRA;
			break;
		}
		const offset = parseOffset(ascii(record, NAME_SIZE, OFFSET_SIZE));
		if (offset === undefined) return undefined;
		entries.push({
			...normalizeEntryPath(ascii(record, 0, NAME_SIZE)),
			offset,
			size: 0,
			encrypted: false,
			masked: false,
		});
		if (entries.length > ENTRY_LIMIT) return undefined;
	}
	for (const entry of entries)
		entry.offset = (entry.offset + indexOffset) >>> 0;
	const last = entries[entries.length - 1];
	if (last && BigInt(last.offset) === source.size) entries.pop();
	return { entries, scriptsEncrypted };
}

/** GARbro `OdnIndexReader.ReadV2`: absolute offsets, the first offset bounds the index. */
async function readV2(
	source: ByteSource,
	header: Buffer,
	recordSize: number,
): Promise<OdnIndex | undefined> {
	const firstOffset = parseOffset(ascii(header, NAME_SIZE, OFFSET_SIZE));
	if (firstOffset === undefined) return undefined;
	const entries: OdnEntry[] = [];
	let record = header;
	let indexOffset = 0;
	while (indexOffset < firstOffset) {
		const offset = parseOffset(ascii(record, NAME_SIZE, OFFSET_SIZE));
		if (offset === undefined) return undefined;
		if (BigInt(offset) === source.size) break;
		entries.push({
			...normalizeEntryPath(ascii(record, 0, NAME_SIZE)),
			offset,
			size: 0,
			encrypted: false,
			masked: false,
		});
		if (entries.length > ENTRY_LIMIT) return undefined;
		indexOffset += recordSize;
		const next = await readExact(source, indexOffset, recordSize);
		if (!next) return undefined;
		record = next;
	}
	return { entries, scriptsEncrypted: true };
}

/** GARbro `OdnIndexReader.ReadEncrypted`: every record is masked with the running key. */
async function readEncrypted(
	source: ByteSource,
	header: Buffer,
	key: number,
): Promise<OdnIndex | undefined> {
	const entries: OdnEntry[] = [];
	let record: Buffer = Buffer.from(header);
	let indexOffset = 0;
	let current = key & 0xff;
	for (;;) {
		indexOffset += INDEX_RECORD_SIZE;
		if (ascii(record, 0, INDEX_RECORD_SIZE) === V1_TERMINATOR) break;
		const offset = parseOffset(ascii(record, NAME_SIZE, OFFSET_SIZE));
		if (offset === undefined) return undefined;
		entries.push({
			...normalizeEntryPath(ascii(record, 0, NAME_SIZE)),
			offset,
			size: 0,
			encrypted: false,
			masked: false,
		});
		if (entries.length > ENTRY_LIMIT) return undefined;
		const next = await readExact(source, indexOffset, INDEX_RECORD_SIZE);
		if (!next) return undefined;
		current = xorCountdown(next, INDEX_RECORD_SIZE, current);
		record = next;
	}
	for (const entry of entries)
		entry.offset = (entry.offset + indexOffset) >>> 0;
	return { entries, scriptsEncrypted: true };
}

/** GARbro `OdnIndexReader.FixupDir`: sizes follow the entry order, the types the names. */
async function fixupEntries(
	source: ByteSource,
	index: OdnIndex,
): Promise<OdnEntry[] | undefined> {
	const { entries, scriptsEncrypted } = index;
	for (const [i, entry] of entries.entries()) {
		const next = entries[i + 1]?.offset;
		const end = next === undefined ? source.size : BigInt(next);
		const size = end - BigInt(entry.offset);
		if (size < 0n) return undefined;
		entry.size = Number(size);
		// An empty entry may sit on the end of the file, so only a real range is checked.
		if (size > 0n && !checkPlacement(BigInt(entry.offset), size, source.size))
			return undefined;
		if (NAME_PATTERNS.image24.test(entry.path)) {
			entry.type = "image";
		} else if (NAME_PATTERNS.script.test(entry.path)) {
			entry.type = "script";
			entry.encrypted = scriptsEncrypted;
		} else if (NAME_PATTERNS.audio.test(entry.path)) {
			entry.type = "audio";
		} else if (entry.size > 4) {
			const probe = await readExact(source, entry.offset, 4);
			if (probe) {
				const signature = probe.readUInt32LE(0);
				if (signature === MASKED_OGG_SIGNATURE) {
					entry.type = "audio";
					entry.masked = true;
				} else if (signature === RIFF_SIGNATURE) {
					entry.type = "audio";
				} else {
					const detected = detectFileType(signature);
					if (detected?.type !== undefined) entry.type = detected.type;
					else if (NAME_PATTERNS.image32.test(entry.path)) entry.type = "image";
				}
			}
		}
	}
	return entries;
}

async function readOdnLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<OdnEntry[] | undefined> {
	const extension = sourceExtension(sourcePath)
		.toLowerCase()
		.replace(/^\./, "");
	if (!EXTENSIONS.includes(extension)) return undefined;
	const header = await readExact(source, 0, HEADER_SIZE);
	if (!header) return undefined;
	let index: OdnIndex | undefined;
	if (ascii(header, NAME_SIZE, OFFSET_SIZE) === ZERO_OFFSET) {
		index = await readV1(source);
	} else if (isAscii(header, V1_RECORD_SIZE)) {
		const name = ascii(header, 0, 4);
		for (const recordSize of V2_RECORD_SIZES) {
			if (ascii(header, recordSize, 4) !== name) continue;
			index = await readV2(source, header, recordSize);
			break;
		}
	} else {
		// The masked layout needs the header unmasked first, then proves itself the same way.
		const key = xorCountdown(header, V1_RECORD_SIZE, INDEX_KEY);
		if (ascii(header, NAME_SIZE, OFFSET_SIZE) === ZERO_OFFSET)
			index = await readEncrypted(source, header, key);
	}
	if (!index || index.entries.length === 0) return undefined;
	const entries = await fixupEntries(source, index);
	return entries && entries.length > 0 ? entries : undefined;
}

export const valkyriaOdnDescriptor: FormatDescriptor = {
	id: "valkyria-odn",
	name: "Valkyria resource archive",
	extensions: EXTENSIONS,
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
			source: "ArcFormats/Valkyria/ArcODN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const valkyriaOdnFormat: ArchiveFormat = defineFixedArchive({
	descriptor: valkyriaOdnDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readOdnLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readOdnLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Valkyria ODN layout");
		const entries: FixedEntry[] = layout.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				...(entry.rawPath !== undefined ? { rawPath: entry.rawPath } : {}),
				offset: BigInt(entry.offset),
				size: BigInt(entry.size),
				encrypted: entry.encrypted,
				metadata: {
					...(entry.type !== undefined ? { type: entry.type } : {}),
					masked: entry.masked,
				} as Record<string, unknown>,
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = entry.metadata as
			| { masked?: boolean; type?: string }
			| undefined;
		const length = Number(entry.size);
		if (metadata?.type === "script" && entry.encrypted) {
			// The mask key is the bitwise complement of the entry offset.
			const data = Buffer.from(await source.readAt(entry.offset, length));
			xorCountdown(data, data.length, ~Number(entry.offset) & 0xff);
			return Readable.from([data]);
		}
		const data = Buffer.from(await source.readAt(entry.offset, length));
		if (NAME_PATTERNS.audio.test(entry.path)) {
			// The stored stream is raw PCM, so the riff header is prepended.
			const header = writeRiffHeader(
				{
					formatTag: 1,
					channels: AUDIO_CHANNELS,
					sampleRate: AUDIO_SAMPLE_RATE,
					averageBytesPerSecond: AUDIO_SAMPLE_RATE * AUDIO_BLOCK_ALIGN,
					blockAlign: AUDIO_BLOCK_ALIGN,
					bitsPerSample: AUDIO_BITS_PER_SAMPLE,
				},
				data.length,
			);
			return Readable.from([header, data]);
		}
		if (data.length > 4 && data.readUInt32LE(0) === MASKED_OGG_SIGNATURE)
			xorConstant(data, OGG_MASK);
		return Readable.from([data]);
	},
});
