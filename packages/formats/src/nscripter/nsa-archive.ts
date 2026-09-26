// Port of GARbro "ArcFormats/NScripter/ArcNSA.cs" (tag "NSA", class NsaOpener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. An archive of the NScripter engine: the count of
// the files of the archive, the place of their tables, and the names, the places and the walks of the files.
//
// The reference reads three walks of the places of a file: the LZSS of the engine, the walk of a picture of
// the name `spb` (which it stands of as a bitmap of the engine's own), and bzip2 for a file of the name
// `nbz`. This port carries the first two and turns a file of the third kind away, because it carries no
// walk of bzip2.

import { MsbBitReader } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
	isSaneCount,
} from "../shared/fixed-archive.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";
/** `LZSS`: the counts of the walk of the engine, which the name of the class at 338 stands of. */
export const NSA_LZSS_EI = 8;
export const NSA_LZSS_EJ = 4;
/** The count of the places of the file one word of the index of the engine stands of. */
const INDEX_WORD = 13;
/** The count of the places of the file the reference stands of a word of the index in front of a name. */
const INDEX_WORD_BEFORE_NAME = 15;
/** The count of the places of the head of a file the walk of the places of a picture of the name `spb`. */
const SPB_HEAD = 4;
/** The places of the file of the head of a bitmap. */
const BMP_HEAD = 54;

/** The walks of the places of a file of the engine, of the count the reference counts them by. */
export const NSA_COMPRESSION_NONE = 0;
export const NSA_COMPRESSION_SPB = 1;
export const NSA_COMPRESSION_LZSS = 2;
export const NSA_COMPRESSION_NBZ = 4;

/** A file of an archive of the engine. */
export interface NsaEntry {
	name: string;
	offset: number;
	size: number;
	unpacked: number;
	compression: number;
}

/** `SarOpener.ReadIndex`: the count of the files of the archive and the words of the index behind it. */
export function readNsaIndex(data: Buffer): NsaEntry[] | undefined {
	// The reference begins at 2 where the first word of the file stands of nought, which is the mark of a
	// file of the engine whose index stands behind it.
	const start = 0 === data.readUInt16BE(0) ? 2 : 0;
	let at = start;
	if (at + 6 > data.length) return undefined;
	const count = data.readInt16BE(at);
	if (!isSaneCount(count) || count <= 0) return undefined;
	at += 2;
	// The reference stands of the place it began the walk at, which is the place of the count of the
	// files rather than the place of the word behind it.
	const base = data.readUInt32BE(at) + start;
	at += 4;
	if (base >= data.length || base < INDEX_WORD_BEFORE_NAME * count)
		return undefined;
	const entries: NsaEntry[] = [];
	for (let index = 0; index < count; index += 1) {
		if (base - at < INDEX_WORD_BEFORE_NAME) return undefined;
		const stop = data.indexOf(0, at);
		if (-1 === stop || stop >= base) return undefined;
		const name = data.toString("latin1", at, stop);
		at = stop + 1;
		if (base - at < INDEX_WORD || 0 === name.length) return undefined;
		const compression = data[at] ?? 0;
		const offset = data.readUInt32BE(at + 1) + base;
		const size = data.readUInt32BE(at + 5);
		const unpacked = data.readUInt32BE(at + 9);
		at += INDEX_WORD;
		if (!checkPlacement(BigInt(offset), BigInt(size), BigInt(data.length))) {
			return undefined;
		}
		if (compression > NSA_COMPRESSION_NBZ) return undefined;
		entries.push({ name, offset, size, unpacked, compression });
	}
	if (0 === entries.length) return undefined;
	return entries;
}

/**
 * `Unpacker.DecodeLZSS`: the walk of the engine. A place of the stream that stands of one stands of the
 * next eight places of the file; a place that stands of nought stands of two counts, of eight and of four
 * places, which name a place of the frame of the walk and the count of the places that stand there.
 */
export function unpackNsaLzss(input: Buffer, unpacked: number): Buffer {
	const output: Buffer = Buffer.alloc(unpacked, 0x00);
	const frame = Buffer.alloc(1 << NSA_LZSS_EI, 0x00);
	const reader = new MsbBitReader(input);
	let written = 0;
	let frameAt = (1 << NSA_LZSS_EI) - ((1 << NSA_LZSS_EJ) + 1);
	while (written < output.length) {
		if (0 !== reader.tryReadBits(1)) {
			const byte = reader.tryReadBits(8);
			if (-1 === byte) break;
			output[written] = byte;
			written += 1;
			frame[frameAt] = byte;
			frameAt = (frameAt + 1) & ((1 << NSA_LZSS_EI) - 1);
			continue;
		}
		const place = reader.tryReadBits(NSA_LZSS_EI);
		if (-1 === place) break;
		const count = reader.tryReadBits(NSA_LZSS_EJ);
		if (-1 === count) break;
		for (let step = 0; step <= count + 1; step += 1) {
			if (written >= output.length) break;
			const byte = frame[(place + step) & ((1 << NSA_LZSS_EI) - 1)] ?? 0;
			output[written] = byte;
			written += 1;
			frame[frameAt] = byte;
			frameAt = (frameAt + 1) & ((1 << NSA_LZSS_EI) - 1);
		}
	}
	return output;
}

/**
 * `Unpacker.DecodeSPB`: a picture of the engine, stood of a bitmap of twenty four places of a colour. The
 * three planes of the picture follow each other, every one of them of its own walk, and the places of a
 * picture are stood of the places of the file down its last row first, the rows of it standing of each
 * other in turn.
 */
export function unpackNsaSpb(input: Buffer): Buffer | undefined {
	if (input.length < SPB_HEAD) return undefined;
	const width = ((input[0] ?? 0) << 8) | (input[1] ?? 0);
	const height = ((input[2] ?? 0) << 8) | (input[3] ?? 0);
	if (0 === width || 0 === height) return undefined;
	const stride = width * 3 + ((4 - ((width * 3) % 4)) % 4);
	const totalSize = stride * height + BMP_HEAD;
	const output = Buffer.alloc(totalSize, 0x00);
	output.write("BM", 0, "latin1");
	output.writeUInt32LE(totalSize, 2);
	output.writeUInt32LE(BMP_HEAD, 10);
	output.writeUInt32LE(40, 14);
	output.writeUInt32LE(width, 18);
	output.writeUInt32LE(height, 22);
	output.writeUInt16LE(1, 26);
	output.writeUInt16LE(24, 28);
	const plane = Buffer.alloc(width * height * 4, 0x00);
	// The walk of the stream stands of the places of the head of the picture as well, which it reads
	// behind the reader of the places of the file.
	const bits = new MsbBitReader(input, SPB_HEAD);
	for (let colour = 0; colour < 3; colour += 1) {
		let count = 0;
		let value = bits.tryReadBits(8);
		if (-1 === value) return undefined;
		plane[count] = value;
		count += 1;
		while (count < width * height) {
			const run = bits.tryReadBits(3);
			if (-1 === run) return undefined;
			if (0 === run) {
				for (let step = 0; step < 4 && count < plane.length; step += 1) {
					plane[count] = value;
					count += 1;
				}
				continue;
			}
			const width_ = 7 === run ? bits.tryReadBits(1) + 1 : run + 2;
			if (-1 === width_) return undefined;
			for (let step = 0; step < 4 && count < plane.length; step += 1) {
				if (8 === width_) {
					const byte = bits.tryReadBits(8);
					if (-1 === byte) return undefined;
					value = byte;
				} else {
					const delta = bits.tryReadBits(width_);
					if (-1 === delta) return undefined;
					value += 0 !== (delta & 1) ? (delta >> 1) + 1 : -(delta >> 1);
					value &= 0xff;
				}
				plane[count] = value;
				count += 1;
			}
		}
		let at = stride * (height - 1) + colour + BMP_HEAD;
		let from = 0;
		for (let row = 0; row < height; row += 1) {
			if (0 !== (row & 1)) {
				for (let column = 0; column < width; column += 1) {
					output[at] = plane[from] ?? 0;
					from += 1;
					at -= 3;
				}
				at -= stride - 3;
			} else {
				for (let column = 0; column < width; column += 1) {
					output[at] = plane[from] ?? 0;
					from += 1;
					at += 3;
				}
				at -= stride + 3;
			}
		}
	}
	return output;
}

export const nsaDescriptor: FormatDescriptor = {
	id: "nscripter-nsa-archive",
	name: "NScripter engine resource archive",
	extensions: ["nsa"],
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
			source: "ArcFormats/NScripter/ArcNSA.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

/** The places of one file of the archive, of the walk its own count of the engine names. */
export const nsaEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const compression = Number(
		entry.metadata?.compression ?? NSA_COMPRESSION_NONE,
	);
	if (NSA_COMPRESSION_NBZ === compression || /\.nbz$/i.test(entry.path)) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"The places of a file of this kind stand of the walk of bzip2, which this project does not carry",
		);
	}
	if (NSA_COMPRESSION_SPB === compression) {
		const picture = unpackNsaSpb(data);
		if (!picture)
			throw invalidArchive("The picture of the engine stands of no walk");
		return Readable.from([picture]);
	}
	if (NSA_COMPRESSION_LZSS === compression) {
		const unpacked = Number(entry.metadata?.unpackedSize ?? 0);
		if (unpacked <= 0)
			throw invalidArchive(
				"The file of the engine names no count of its places",
			);
		return Readable.from([unpackNsaLzss(data, unpacked)]);
	}
	return Readable.from([data]);
};

export const nsaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nsaDescriptor,
	detection: {
		signatures: [],
		priority: -1,
		extensionFallback: true,
	},
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			const entries = readNsaIndex(data);
			if (entries) return true;
			// `NsaOpener.TryOpen`: a file of the places of a sound of the name `mp3` stands of an archive
			// of one file, of the whole of the places of the file behind the mark of it.
			if (!/\.nsa$/i.test(sourcePath ?? "")) return false;
			return (data.readUInt32LE(0) & 0xffffff) === 0x90fbff;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const entries = readNsaIndex(data);
		if (entries) {
			const names = new Set<string>();
			const fixed: FixedEntry[] = entries.map((entry, id) => {
				if (names.has(entry.name)) {
					throw invalidArchive("The archive stands of two files of one name");
				}
				names.add(entry.name);
				const packed =
					NSA_COMPRESSION_NONE !== entry.compression &&
					NSA_COMPRESSION_NBZ !== entry.compression;
				return {
					...createFixedEntry({
						id,
						path: entry.name,
						offset: BigInt(entry.offset),
						size: BigInt(entry.size),
						compressed: packed,
						metadata: {
							type: /\.nbz$/i.test(entry.name) ? "audio" : "file",
							compression: entry.compression,
							unpackedSize: 0 !== entry.unpacked ? entry.unpacked : entry.size,
						} as Record<string, unknown>,
					}),
					sizeKnown: true,
				} as FixedEntry;
			});
			return {
				entries: fixed,
				metadata: { count: fixed.length, shape: "index" },
			};
		}
		// The whole of a file that stands of the mark of a sound of the engine, of no index at all.
		if ((data.readUInt32LE(0) & 0xffffff) !== 0x90fbff) {
			throw invalidArchive("Not an archive of the NScripter engine");
		}
		const name = `${basename(sourcePath).replace(/\.[^.]*$/, "")}.mp3`;
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: name,
						offset: 0n,
						size: source.size,
						compressed: false,
						metadata: { type: "audio" } as Record<string, unknown>,
					}),
					sizeKnown: true,
				} as FixedEntry,
			],
			metadata: { count: 1, shape: "one-sound" },
		};
	},
	openEntry: nsaEntryOpener,
});

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}
