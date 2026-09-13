// Format reference: GARbro "ArcFormats/RealLive/ArcKOE.cs", classes `KoeOpener`, `KoeEntry` and
// `KoeArchive`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const HEADER_SIZE = 0x20;
const INDEX_OFFSET = 0x20;
const INDEX_ENTRY_SIZE = 8;
const DEFAULT_SAMPLE_RATE = 22050;
const CHUNK_SIZE = 0x1000;
const PCM_CHUNK_SIZE = 0x400;
const RIFF_HEADER_SIZE = 44;
const RIFF_SIZE_BIAS = 0x24;
const RIFF_TAG = 0x46464952;
const WAVE_TAG = 0x45564157;
const FMT_TAG = 0x20746d66;
const DATA_TAG = 0x61746164;

/// 4 bit delta to signed offset lookup, indexed by the sign stretched code.
const SAMPLE_TABLE: readonly number[] = [
	0x8000, 0x81ff, 0x83f9, 0x85ef, 0x87e1, 0x89cf, 0x8bb9, 0x8d9f, 0x8f81,
	0x915f, 0x9339, 0x950f, 0x96e1, 0x98af, 0x9a79, 0x9c3f, 0x9e01, 0x9fbf,
	0xa179, 0xa32f, 0xa4e1, 0xa68f, 0xa839, 0xa9df, 0xab81, 0xad1f, 0xaeb9,
	0xb04f, 0xb1e1, 0xb36f, 0xb4f9, 0xb67f, 0xb801, 0xb97f, 0xbaf9, 0xbc6f,
	0xbde1, 0xbf4f, 0xc0b9, 0xc21f, 0xc381, 0xc4df, 0xc639, 0xc78f, 0xc8e1,
	0xca2f, 0xcb79, 0xccbf, 0xce01, 0xcf3f, 0xd079, 0xd1af, 0xd2e1, 0xd40f,
	0xd539, 0xd65f, 0xd781, 0xd89f, 0xd9b9, 0xdacf, 0xdbe1, 0xdcef, 0xddf9,
	0xdeff, 0xe001, 0xe0ff, 0xe1f9, 0xe2ef, 0xe3e1, 0xe4cf, 0xe5b9, 0xe69f,
	0xe781, 0xe85f, 0xe939, 0xea0f, 0xeae1, 0xebaf, 0xec79, 0xed3f, 0xee01,
	0xeebf, 0xef79, 0xf02f, 0xf0e1, 0xf18f, 0xf239, 0xf2df, 0xf381, 0xf41f,
	0xf4b9, 0xf54f, 0xf5e1, 0xf66f, 0xf6f9, 0xf77f, 0xf801, 0xf87f, 0xf8f9,
	0xf96f, 0xf9e1, 0xfa4f, 0xfab9, 0xfb1f, 0xfb81, 0xfbdf, 0xfc39, 0xfc8f,
	0xfce1, 0xfd2f, 0xfd79, 0xfdbf, 0xfe01, 0xfe3f, 0xfe79, 0xfeaf, 0xfee1,
	0xff0f, 0xff39, 0xff5f, 0xff81, 0xff9f, 0xffb9, 0xffcf, 0xffe1, 0xffef,
	0xfff9, 0xffff, 0x0000, 0x0001, 0x0007, 0x0011, 0x001f, 0x0031, 0x0047,
	0x0061, 0x007f, 0x00a1, 0x00c7, 0x00f1, 0x011f, 0x0151, 0x0187, 0x01c1,
	0x01ff, 0x0241, 0x0287, 0x02d1, 0x031f, 0x0371, 0x03c7, 0x0421, 0x047f,
	0x04e1, 0x0547, 0x05b1, 0x061f, 0x0691, 0x0707, 0x0781, 0x07ff, 0x0881,
	0x0907, 0x0991, 0x0a1f, 0x0ab1, 0x0b47, 0x0be1, 0x0c7f, 0x0d21, 0x0dc7,
	0x0e71, 0x0f1f, 0x0fd1, 0x1087, 0x1141, 0x11ff, 0x12c1, 0x1387, 0x1451,
	0x151f, 0x15f1, 0x16c7, 0x17a1, 0x187f, 0x1961, 0x1a47, 0x1b31, 0x1c1f,
	0x1d11, 0x1e07, 0x1f01, 0x1fff, 0x2101, 0x2207, 0x2311, 0x241f, 0x2531,
	0x2647, 0x2761, 0x287f, 0x29a1, 0x2ac7, 0x2bf1, 0x2d1f, 0x2e51, 0x2f87,
	0x30c1, 0x31ff, 0x3341, 0x3487, 0x35d1, 0x371f, 0x3871, 0x39c7, 0x3b21,
	0x3c7f, 0x3de1, 0x3f47, 0x40b1, 0x421f, 0x4391, 0x4507, 0x4681, 0x47ff,
	0x4981, 0x4b07, 0x4c91, 0x4e1f, 0x4fb1, 0x5147, 0x52e1, 0x547f, 0x5621,
	0x57c7, 0x5971, 0x5b1f, 0x5cd1, 0x5e87, 0x6041, 0x61ff, 0x63c1, 0x6587,
	0x6751, 0x691f, 0x6af1, 0x6cc7, 0x6ea1, 0x707f, 0x7261, 0x7447, 0x7631,
	0x781f, 0x7a11, 0x7c07, 0x7fff,
];

const ADJUST_TABLE: readonly number[] = [
	0x00, 0xff, 0x01, 0xfe, 0x02, 0xfd, 0x03, 0xfc, 0x04, 0xfb, 0x05, 0xfa, 0x06,
	0xf9, 0x07, 0xf8, 0x08, 0xf7, 0x09, 0xf6, 0x0a, 0xf5, 0x0b, 0xf4, 0x0c, 0xf3,
	0x0d, 0xf2, 0x0e, 0xf1, 0x0f, 0xf0, 0x10, 0xef, 0x11, 0xee, 0x12, 0xed, 0x13,
	0xec, 0x14, 0xeb, 0x15, 0xea, 0x16, 0xe9, 0x17, 0xe8, 0x18, 0xe7, 0x19, 0xe6,
	0x1a, 0xe5, 0x1b, 0xe4, 0x1c, 0xe3, 0x1d, 0xe2, 0x1e, 0xe1, 0x1f, 0xe0, 0x20,
	0xdf, 0x21, 0xde, 0x22, 0xdd, 0x23, 0xdc, 0x24, 0xdb, 0x25, 0xda, 0x26, 0xd9,
	0x27, 0xd8, 0x28, 0xd7, 0x29, 0xd6, 0x2a, 0xd5, 0x2b, 0xd4, 0x2c, 0xd3, 0x2d,
	0xd2, 0x2e, 0xd1, 0x2f, 0xd0, 0x30, 0xcf, 0x31, 0xce, 0x32, 0xcd, 0x33, 0xcc,
	0x34, 0xcb, 0x35, 0xca, 0x36, 0xc9, 0x37, 0xc8, 0x38, 0xc7, 0x39, 0xc6, 0x3a,
	0xc5, 0x3b, 0xc4, 0x3c, 0xc3, 0x3d, 0xc2, 0x3e, 0xc1, 0x3f, 0xc0, 0x40, 0xbf,
	0x41, 0xbe, 0x42, 0xbd, 0x43, 0xbc, 0x44, 0xbb, 0x45, 0xba, 0x46, 0xb9, 0x47,
	0xb8, 0x48, 0xb7, 0x49, 0xb6, 0x4a, 0xb5, 0x4b, 0xb4, 0x4c, 0xb3, 0x4d, 0xb2,
	0x4e, 0xb1, 0x4f, 0xb0, 0x50, 0xaf, 0x51, 0xae, 0x52, 0xad, 0x53, 0xac, 0x54,
	0xab, 0x55, 0xaa, 0x56, 0xa9, 0x57, 0xa8, 0x58, 0xa7, 0x59, 0xa6, 0x5a, 0xa5,
	0x5b, 0xa4, 0x5c, 0xa3, 0x5d, 0xa2, 0x5e, 0xa1, 0x5f, 0xa0, 0x60, 0x9f, 0x61,
	0x9e, 0x62, 0x9d, 0x63, 0x9c, 0x64, 0x9b, 0x65, 0x9a, 0x66, 0x99, 0x67, 0x98,
	0x68, 0x97, 0x69, 0x96, 0x6a, 0x95, 0x6b, 0x94, 0x6c, 0x93, 0x6d, 0x92, 0x6e,
	0x91, 0x6f, 0x90, 0x70, 0x8f, 0x71, 0x8e, 0x72, 0x8d, 0x73, 0x8c, 0x74, 0x8b,
	0x75, 0x8a, 0x76, 0x89, 0x77, 0x88, 0x78, 0x87, 0x79, 0x86, 0x7a, 0x85, 0x7b,
	0x84, 0x7c, 0x83, 0x7d, 0x82, 0x7e, 0x81, 0x7f, 0x80,
];

interface KoeEntryInfo {
	name: string;
	offset: bigint;
	sampleCount: number;
}

/** `KoeOpener.TryOpen`: a flat index of chunked 4 bit ADPCM audio. */
async function buildKoeEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: KoeEntryInfo[]; sampleRate: number } | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	// The reference checks the 'KOEP' signature word plus "AC\0", seven bytes in total.
	if (header.toString("latin1", 0, 7) !== "KOEPAC\0") return undefined;
	const count = header.readInt32LE(0x10);
	if (!isSaneCount(count)) return undefined;
	const sampleRate = header.readUInt32LE(0x18) || DEFAULT_SAMPLE_RATE;
	if (BigInt(INDEX_OFFSET) + BigInt(count * INDEX_ENTRY_SIZE) > source.size)
		return undefined;
	const index = Buffer.from(
		await source.readAt(BigInt(INDEX_OFFSET), count * INDEX_ENTRY_SIZE),
	);
	const baseName = (sourcePath.split(/[\\/]/).pop() ?? "").replace(
		/\.[^.]*$/,
		"",
	);
	const entries: KoeEntryInfo[] = [];
	for (let i = 0; i < count; i += 1) {
		const position = i * INDEX_ENTRY_SIZE;
		const id = index.readUInt16LE(position);
		const sampleCount = index.readUInt16LE(position + 2);
		const offset = index.readUInt32LE(position + 4);
		// The stored size covers the per chunk length table only.
		if (!checkPlacement(BigInt(offset), BigInt(sampleCount * 2), source.size))
			return undefined;
		entries.push({
			name: `${baseName}#${id.toString().padStart(4, "0")}.wav`,
			offset: BigInt(offset),
			sampleCount,
		});
	}
	return { entries, sampleRate };
}

/** `WaveAudio.WriteRiffHeader`: a fixed 44 byte RIFF/WAVE header without any extra chunks. */
function writeRiffHeader(dataSize: number, sampleRate: number): Buffer {
	const header = Buffer.alloc(RIFF_HEADER_SIZE);
	header.writeUInt32LE(RIFF_TAG, 0);
	header.writeUInt32LE((RIFF_SIZE_BIAS + dataSize) >>> 0, 4);
	header.writeUInt32LE(WAVE_TAG, 8);
	header.writeUInt32LE(FMT_TAG, 0xc);
	header.writeUInt32LE(0x10, 0x10);
	header.writeUInt16LE(1, 0x14);
	header.writeUInt16LE(2, 0x16);
	header.writeUInt32LE(sampleRate, 0x18);
	header.writeUInt32LE(4 * sampleRate, 0x1c);
	header.writeUInt16LE(4, 0x20);
	header.writeUInt16LE(16, 0x22);
	header.writeUInt32LE(DATA_TAG, 0x24);
	header.writeUInt32LE(dataSize >>> 0, 0x28);
	return header;
}
export const realliveKoeDescriptor: FormatDescriptor = {
	id: "reallive-koe",
	name: "RealLive engine audio archive",
	extensions: ["koe"],
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
			source: "ArcFormats/RealLive/ArcKOE.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const realliveKoeFormat: ArchiveFormat = defineFixedArchive({
	descriptor: realliveKoeDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("KOEPAC\0", "latin1") }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await buildKoeEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const built = await buildKoeEntries(source, sourcePath);
		if (!built) throw new GarbroError("INVALID_ARCHIVE", "Invalid KOE index");
		const fixed: FixedEntry[] = built.entries.map((entry, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				// Every chunk expands to the same amount of PCM, so the extracted size is known.
				size: BigInt(RIFF_HEADER_SIZE + entry.sampleCount * CHUNK_SIZE),
				packedSize: BigInt(entry.sampleCount * 2),
				compressed: true,
				metadata: {
					type: "audio",
					sampleCount: entry.sampleCount,
					sampleRate: built.sampleRate,
				},
			}),
		);
		return {
			entries: fixed,
			metadata: { entryCount: fixed.length, sampleRate: built.sampleRate },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = entry.metadata as
			| { sampleCount?: number; sampleRate?: number }
			| undefined;
		const sampleCount = metadata?.sampleCount ?? 0;
		const sampleRate = metadata?.sampleRate || DEFAULT_SAMPLE_RATE;
		if (sampleCount === 0) {
			return Readable.from([writeRiffHeader(0, sampleRate)]);
		}
		const offset = entry.offset ?? 0n;
		const tableSize = sampleCount * 2;
		const available = Number(source.size) - Number(offset);
		if (available < tableSize)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated KOE chunk table");
		const table = Buffer.from(await source.readAt(offset, tableSize));
		const lengths: number[] = [];
		let packedSize = 0;
		for (let index = 0; index < sampleCount; index += 1) {
			const length = table.readUInt16LE(index * 2);
			lengths.push(length);
			packedSize += length;
		}
		const dataOffset = offset + BigInt(tableSize);
		const readable = Math.max(Number(source.size) - Number(dataOffset), 0);
		const packed = Buffer.from(
			await source.readAt(dataOffset, Math.min(packedSize, readable)),
		);
		const output = Buffer.alloc(sampleCount * CHUNK_SIZE);
		let outputPosition = 0;
		let inputPosition = 0;
		for (const length of lengths) {
			if (length === 0) {
				outputPosition += CHUNK_SIZE;
				continue;
			}
			if (length === PCM_CHUNK_SIZE) {
				for (let i = 0; i < PCM_CHUNK_SIZE; i += 1) {
					const sample = SAMPLE_TABLE[packed[inputPosition++] ?? 0] ?? 0;
					output.writeUInt16LE(sample, outputPosition);
					output.writeUInt16LE(sample, outputPosition + 2);
					outputPosition += 4;
				}
				continue;
			}
			let source_index = 0;
			for (let i = 0; i < PCM_CHUNK_SIZE; i += 2) {
				let bits = packed[inputPosition++] ?? 0;
				if (((bits + 1) & 0x0f) !== 0) {
					source_index =
						(source_index - (ADJUST_TABLE[bits & 0x0f] ?? 0)) & 0xff;
				} else {
					let idx = bits >> 4;
					bits = packed[inputPosition++] ?? 0;
					idx |= (bits << 4) & 0xf0;
					source_index = (source_index - (ADJUST_TABLE[idx] ?? 0)) & 0xff;
				}
				let sample = SAMPLE_TABLE[source_index] ?? 0;
				output.writeUInt16LE(sample, outputPosition);
				output.writeUInt16LE(sample, outputPosition + 2);
				outputPosition += 4;
				bits >>= 4;
				if (((bits + 1) & 0x0f) !== 0) {
					source_index =
						(source_index - (ADJUST_TABLE[bits & 0x0f] ?? 0)) & 0xff;
				} else {
					source_index = (source_index - (packed[inputPosition++] ?? 0)) & 0xff;
				}
				sample = SAMPLE_TABLE[source_index] ?? 0;
				output.writeUInt16LE(sample, outputPosition);
				output.writeUInt16LE(sample, outputPosition + 2);
				outputPosition += 4;
			}
		}
		const dataSize = sampleCount * CHUNK_SIZE;
		return Readable.from([
			Buffer.concat([writeRiffHeader(dataSize, sampleRate), output]),
		]);
	},
});
