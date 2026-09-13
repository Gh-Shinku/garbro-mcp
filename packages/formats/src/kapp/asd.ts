// Format reference: GARbro Legacy/KApp/ArcASD.cs (classes `AsdKToolOpener`, `AsdArchive` and
// `AsdAudioOpener`), Legacy/KApp/ImageCGD.cs (`KTool` and its `HuffmanDecoder`) and
// GameRes/AudioWAV.cs (`WaveAudio.WriteRiffHeader`).
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `AsdKToolOpener` matches the first four bytes of the `ktool210` marker. */
const KTOOL_SIGNATURE = Buffer.from("ktoo", "latin1");
const KTOOL_COUNT_FIELD = 8;
const KTOOL_INDEX_OFFSET = 0x10;
const INDEX_ENTRY_SIZE = 4;
/** The payload marker at 0x0C of an entry selects its type. */
const TYPE_FIELD = 0xc;
const AUDIO_MARKER = 0xb713e4;
const IMAGE_MARKERS = [0xb29ea4, 0x973768];
/** The packed audio header. */
const AUDIO_SIZE_FIELD = 0;
const AUDIO_METHOD_FIELD = 8;
const AUDIO_HEADER_SIZE_FIELD = 0xa;
const AUDIO_FORMAT_FIELD = 0x10;
const KT_METHOD_STORED = 0;
const KT_METHOD_HUFFMAN = 0x10;
const KT_MAX_RLE_METHOD = 4;
const RIFF_HEADER_SIZE = 44;
const RIFF_SIZE_BIAS = 0x24;
/** `AsdAudioOpener` gates on the extension and on the format byte. */
const SPIEL_EXTENSION = ".asd";
const SPIEL_FORMAT_FIELD = 0;
const SPIEL_MP3_FORMAT = 2;
const SPIEL_HEADER_SIZE = 0x10;
const SPIEL_PCM_HEADER_SIZE = 0x20;
const SPIEL_SIZE_FIELD = 0;
const SPIEL_WAVE_FORMAT_FIELD = 8;
const SPIEL_CHANNELS_FIELD = 0xa;
const SPIEL_SAMPLE_RATE_FIELD = 0xc;
const SPIEL_AVERAGE_BYTES_FIELD = 0x10;
const SPIEL_BLOCK_ALIGN_FIELD = 0x14;
const SPIEL_BITS_FIELD = 0x16;
const INDEX_TERMINATOR = 0xffffffff;
const NAME_DIGITS = 4;
const DICTIONARY_SIZE = 0x100;
const TREE_SIZE = 514;
const TREE_SENTINEL = 513;
const FIRST_TREE_NODE = 257;
const END_TOKEN = 0x100;
const SENTINEL_CODE = 0xffff;
const MSB_MASK = 0x80;

interface WaveFormat {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

interface AsdEntry {
	name: string;
	offset: bigint;
	size: bigint;
	type: string;
}

/** `WaveAudio.WriteRiffHeader`: a fixed 44 byte RIFF/WAVE header without any extra chunks. */
export function writeRiffHeader(format: WaveFormat, dataSize: number): Buffer {
	const header = Buffer.alloc(RIFF_HEADER_SIZE);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE((RIFF_SIZE_BIAS + dataSize) >>> 0, 4);
	header.write("WAVE", 8, "latin1");
	header.write("fmt ", 0xc, "latin1");
	header.writeUInt32LE(0x10, 0x10);
	header.writeUInt16LE(format.formatTag & 0xffff, 0x14);
	header.writeUInt16LE(format.channels & 0xffff, 0x16);
	header.writeUInt32LE(format.sampleRate >>> 0, 0x18);
	header.writeUInt32LE(format.averageBytesPerSecond >>> 0, 0x1c);
	header.writeUInt16LE(format.blockAlign & 0xffff, 0x20);
	header.writeUInt16LE(format.bitsPerSample & 0xffff, 0x22);
	header.write("data", 0x24, "latin1");
	header.writeUInt32LE(dataSize >>> 0, 0x28);
	return header;
}

/** `KTool.DecompressRle`: one control byte per interleaved stream, written with a fixed step. */
function unpackKToolRle(
	input: Buffer,
	start: number,
	output: Buffer,
	step: number,
): number {
	let position = start;
	for (let lane = 0; lane < step; lane += 1) {
		let target = lane;
		for (;;) {
			if (position >= input.length) return position;
			const control = ((input[position] ?? 0) << 24) >> 24;
			position += 1;
			if (control === 0) break;
			if (control < 0) {
				let count = -control;
				while (count > 0) {
					if (position >= input.length) return position;
					if (target < output.length) output[target] = input[position] ?? 0;
					target += step;
					position += 1;
					count -= 1;
				}
				continue;
			}
			if (position >= input.length) return position;
			const value = input[position] ?? 0;
			position += 1;
			let count = control;
			while (count > 0) {
				if (target < output.length) output[target] = value;
				target += step;
				count -= 1;
			}
		}
	}
	return position;
}

/** `KTool.HuffmanDecoder`: a weight dictionary and a tree whose leaves are the byte values. */
function unpackKToolHuffman(
	input: Buffer,
	start: number,
	output: Buffer,
): number {
	const dictionary = Buffer.alloc(DICTIONARY_SIZE);
	const position = unpackKToolRle(input, start, dictionary, 1);
	const code = new Int32Array(TREE_SIZE);
	const left = new Int32Array(TREE_SIZE);
	const right = new Int32Array(TREE_SIZE);
	for (let index = 0; index < DICTIONARY_SIZE; index += 1)
		code[index] = dictionary[index] ?? 0;
	code[END_TOKEN] = 1;
	code[TREE_SENTINEL] = SENTINEL_CODE;
	let root = FIRST_TREE_NODE;
	for (;;) {
		let rhs = TREE_SENTINEL;
		let lhs = TREE_SENTINEL;
		for (let index = 0; index < root; index += 1) {
			const value = code[index] ?? 0;
			if (value === 0) continue;
			if (value < (code[lhs] ?? 0)) {
				rhs = lhs;
				lhs = index;
			} else if (value < (code[rhs] ?? 0)) {
				rhs = index;
			}
		}
		if (rhs === TREE_SENTINEL) break;
		code[root] = (code[rhs] ?? 0) + (code[lhs] ?? 0);
		left[root] = lhs;
		right[root] = rhs;
		code[lhs] = 0;
		code[rhs] = 0;
		root += 1;
		if (root >= TREE_SIZE) break;
	}
	const treeRoot = root - 1;
	let target = 0;
	let bits = 0;
	let mask = 0;
	let cursor = position;
	while (target < output.length) {
		let token = treeRoot;
		while (token > END_TOKEN) {
			if (mask === 0) {
				if (cursor >= input.length) return cursor;
				bits = input[cursor] ?? 0;
				cursor += 1;
				mask = MSB_MASK;
			}
			token = (bits & mask) !== 0 ? (right[token] ?? 0) : (left[token] ?? 0);
			mask >>= 1;
		}
		output[target] = token & 0xff;
		target += 1;
	}
	return cursor;
}

/** `KTool.Unpack`: the stored, the four rle methods and the huffman method. */
export function unpackKTool(
	input: Buffer,
	output: Buffer,
	method: number,
): Buffer {
	if (method === KT_METHOD_STORED) {
		input.copy(output, 0, 0, Math.min(input.length, output.length));
		return output;
	}
	if (method >= 1 && method <= KT_MAX_RLE_METHOD) {
		unpackKToolRle(input, 0, output, method);
		return output;
	}
	if (method === KT_METHOD_HUFFMAN) {
		unpackKToolHuffman(input, 0, output);
		return output;
	}
	throw new GarbroError(
		"UNSUPPORTED_FEATURE",
		`Unsupported KTool compression method ${method}`,
	);
}

/** `AsdKToolOpener.TryOpen`: a flat offset table with generated names and marker typed entries. */
async function readKTool(
	source: ByteSource,
	sourcePath: string,
): Promise<AsdEntry[] | undefined> {
	if (source.size < BigInt(KTOOL_INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, KTOOL_INDEX_OFFSET);
	if (!header.subarray(0, KTOOL_SIGNATURE.length).equals(KTOOL_SIGNATURE))
		return undefined;
	const count = header.readInt32LE(KTOOL_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const tableSize = (count + 1) * INDEX_ENTRY_SIZE;
	if (BigInt(KTOOL_INDEX_OFFSET) + BigInt(tableSize) > source.size)
		return undefined;
	const table = await source.readAt(BigInt(KTOOL_INDEX_OFFSET), tableSize);
	const baseName = (sourcePath.split(/[\\/]/).pop() ?? "").replace(
		/\.[^.]*$/,
		"",
	);
	const entries: AsdEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(table.readUInt32LE(id * INDEX_ENTRY_SIZE));
		const next = BigInt(table.readUInt32LE((id + 1) * INDEX_ENTRY_SIZE));
		if (next < offset) return undefined;
		const size = next - offset;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const marker = await readMarker(source, offset);
		entries.push({
			name: `${baseName}#${String(id).padStart(NAME_DIGITS, "0")}`,
			offset,
			size,
			type:
				marker === AUDIO_MARKER
					? "audio"
					: IMAGE_MARKERS.includes(marker)
						? "image"
						: "data",
		});
	}
	if (entries.length === 0) return undefined;
	return entries;
}

async function readMarker(source: ByteSource, offset: bigint): Promise<number> {
	if (offset + BigInt(TYPE_FIELD + 4) > source.size) return 0;
	const bytes = await source.readAt(offset + BigInt(TYPE_FIELD), 4);
	return bytes.readUInt32LE(0);
}

/** `AsdAudioOpener.TryOpen`: a terminated offset table, sized by the distance to the next offset. */
async function readSpiel(
	source: ByteSource,
	sourcePath: string,
): Promise<AsdEntry[] | undefined> {
	if (
		!(sourcePath.split(/[\\/]/).pop() ?? "")
			.toLowerCase()
			.endsWith(SPIEL_EXTENSION)
	)
		return undefined;
	if (source.size < BigInt(KTOOL_INDEX_OFFSET + INDEX_ENTRY_SIZE))
		return undefined;
	const head = await source.readAt(0n, KTOOL_INDEX_OFFSET);
	const format = head[SPIEL_FORMAT_FIELD] ?? 0;
	if (format !== 1 && format !== SPIEL_MP3_FORMAT) return undefined;
	const baseName = (sourcePath.split(/[\\/]/).pop() ?? "").replace(
		/\.[^.]*$/,
		"",
	);
	const entries: AsdEntry[] = [];
	let position = KTOOL_INDEX_OFFSET;
	for (;;) {
		if (BigInt(position) + BigInt(INDEX_ENTRY_SIZE) > source.size) break;
		const raw = await source.readAt(BigInt(position), INDEX_ENTRY_SIZE);
		const offset = BigInt(raw.readUInt32LE(0));
		if (offset === BigInt(INDEX_TERMINATOR)) break;
		const nextRaw = await source.readAt(
			BigInt(position + INDEX_ENTRY_SIZE),
			INDEX_ENTRY_SIZE,
		);
		const next = BigInt(nextRaw.readUInt32LE(0));
		const size =
			next === BigInt(INDEX_TERMINATOR) ? source.size - offset : next - offset;
		if (next !== BigInt(INDEX_TERMINATOR) && next < offset) return undefined;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({
			name: `${baseName}#${String(entries.length).padStart(NAME_DIGITS, "0")}`,
			offset,
			size,
			type: "audio",
		});
		position += INDEX_ENTRY_SIZE;
		if (entries.length > 0x40000) return undefined;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

function toFixedEntries(entries: readonly AsdEntry[]): FixedEntry[] {
	return entries.map((entry, id) => {
		const created = createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			metadata: { type: entry.type },
		});
		// Audio extraction rewrites the payload into a RIFF container or slices it.
		return entry.type === "audio" ? { ...created, sizeKnown: false } : created;
	});
}

/** `AsdKToolOpener.OpenAudio`: the packed audio becomes a RIFF container around the decoded data. */
async function openKToolAudio(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	if (stored.length < 0x20)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated KTool audio header");
	const dataSize = stored.readUInt32LE(AUDIO_SIZE_FIELD);
	const headerSize = stored.readUInt16LE(AUDIO_HEADER_SIZE_FIELD);
	const data = Buffer.alloc(dataSize);
	unpackKTool(
		stored.subarray(Math.min(headerSize + 0x10, stored.length)),
		data,
		stored[AUDIO_METHOD_FIELD] ?? 0,
	);
	const format: WaveFormat = {
		formatTag: stored.readUInt16LE(AUDIO_FORMAT_FIELD),
		channels: stored.readUInt16LE(AUDIO_FORMAT_FIELD + 2),
		sampleRate: stored.readUInt32LE(AUDIO_FORMAT_FIELD + 4),
		averageBytesPerSecond: stored.readUInt32LE(AUDIO_FORMAT_FIELD + 8),
		blockAlign: stored.readUInt16LE(AUDIO_FORMAT_FIELD + 0xc),
		bitsPerSample: stored.readUInt16LE(AUDIO_FORMAT_FIELD + 0xe),
	};
	return Readable.from([writeRiffHeader(format, data.length), data]);
}

/** `AsdAudioOpener.OpenEntry`: mp3 frames are sliced out, wave frames get a RIFF header. */
async function openSpielEntry(
	source: ByteSource,
	entry: FixedEntry,
	formatByte: number,
): Promise<Readable> {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	if (stored.length < 4)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated Spiel audio entry");
	const dataSize = stored.readUInt32LE(SPIEL_SIZE_FIELD);
	if (formatByte === SPIEL_MP3_FORMAT) {
		const start = Math.min(SPIEL_HEADER_SIZE, stored.length);
		return Readable.from([stored.subarray(start, start + dataSize)]);
	}
	const format: WaveFormat = {
		formatTag: stored.readUInt16LE(SPIEL_WAVE_FORMAT_FIELD),
		channels: stored.readUInt16LE(SPIEL_CHANNELS_FIELD),
		sampleRate: stored.readUInt32LE(SPIEL_SAMPLE_RATE_FIELD),
		averageBytesPerSecond: stored.readUInt32LE(SPIEL_AVERAGE_BYTES_FIELD),
		blockAlign: stored.readUInt16LE(SPIEL_BLOCK_ALIGN_FIELD),
		bitsPerSample: stored.readUInt16LE(SPIEL_BITS_FIELD),
	};
	const start = Math.min(SPIEL_PCM_HEADER_SIZE, stored.length);
	return Readable.from([
		writeRiffHeader(format, dataSize),
		stored.subarray(start),
	]);
}

async function spielFormatByte(
	source: ByteSource,
): Promise<number | undefined> {
	if (source.size < 1n) return undefined;
	const head = await source.readAt(0n, 1);
	return head[0];
}

async function detectSpiel(
	source: ByteSource,
	sourcePath: string,
): Promise<boolean> {
	return (await readSpiel(source, sourcePath)) !== undefined;
}

export const asdKToolDescriptor: FormatDescriptor = {
	id: "kapp-asd",
	name: "KApp engine resource archive",
	extensions: ["asd"],
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
			source: "Legacy/KApp/ArcASD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const asdSpielDescriptor: FormatDescriptor = {
	...asdKToolDescriptor,
	id: "kapp-asd-spiel",
	name: "Spiel audio archive",
	attribution: [...(asdKToolDescriptor.attribution ?? [])],
};

export const asdKToolFormat: ArchiveFormat = defineFixedArchive({
	descriptor: asdKToolDescriptor,
	detection: { signatures: [{ bytes: KTOOL_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readKTool(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readKTool(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KApp ASD layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (entry.metadata?.type === "audio") return openKToolAudio(source, entry);
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});

export const asdSpielFormat: ArchiveFormat = defineFixedArchive({
	descriptor: asdSpielDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return detectSpiel(source, sourcePath);
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readSpiel(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Spiel ASD layout");
		const format = await spielFormatByte(source);
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length, format },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const format = await spielFormatByte(source);
		if (format === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Missing Spiel format byte");
		return openSpielEntry(source, entry, format);
	},
});
