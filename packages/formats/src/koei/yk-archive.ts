// Format reference: GARbro Legacy/Koei/ArcYK.cs (class `YkOpener`) and its second half,
// Legacy/Koei/YkTables.cs.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
} from "../shared/fixed-archive.js";
import {
	YK_AUDIO_NAMES,
	YK_DATA02_IMAGES,
	YK_OFFSET_TABLES,
	type YkImageGeometry,
} from "./yk-tables.js";

/** `YkOpener.GetData01Index`: a `DATA01` file is a whole number of fixed size picture blocks. */
const DATA01_BLOCK_SIZE = 0x4b400;
const DATA01_GEOMETRY: YkImageGeometry = { width: 640, height: 480, bpp: 8 };
/** From this `DATA02` id on the reference pictures are the fixed 128x192 splash screens. */
const DATA02_LARGE_ID = 189;
const DATA02_LARGE_GEOMETRY: YkImageGeometry = {
	width: 128,
	height: 192,
	bpp: 8,
};
/** Below this `DATA02` id an entry is a picture only when the geometry table lists it. */
const DATA02_NAMED_FROM = 11;
/** `ImageFormat.ReadPalette` reads 256 `BgrX` entries, which is also the bitmap colour map layout. */
const PALETTE_SIZE = 0x400;
/** `YkOpener.DecryptData03` mixes every whole word with this constant. */
const DATA03_KEY = 0x12c4d65;
const WORD = 4;
/**
 * `YkOpener.RiffHeader`: sixteen bytes of a wave head, whose size field `OpenAudio` overwrites with
 * the stored size plus eight. The stored bytes are expected to carry the rest of the format.
 */
const RIFF_HEADER = Buffer.from("RIFF\0\0\0\0WAVEfmt ", "latin1");
const EXTENSION = "yk";

export type YkEntryKind = "data" | "image" | "audio";

export interface YkEntryFlags {
	readonly kind: YkEntryKind;
	/** `DATA03` entries are word-mixed before they are handed over. */
	readonly mixed: boolean;
}

export interface YkEntryPlan extends YkEntryFlags {
	readonly index: number;
	readonly name: string;
	readonly offset: bigint;
	readonly size: bigint;
	/** Present when the reference hands the entry to its picture decoder. */
	readonly image?: YkImageGeometry;
	/** `DATA02` ids the reference names as pictures but holds no geometry for; they stay raw. */
	readonly undecoded?: boolean;
}

export interface YkLayout {
	readonly archiveName: string;
	/** `DATA01` archives are the fixed block kind rather than offset table driven. */
	readonly data01: boolean;
	readonly entries: readonly YkEntryPlan[];
}

/** `Path.GetFileNameWithoutExtension(sourcePath).ToUpperInvariant()`. */
function archiveNameOf(sourcePath: string): string {
	const separator = Math.max(
		sourcePath.lastIndexOf("/"),
		sourcePath.lastIndexOf("\\"),
	);
	const name = sourcePath.slice(separator + 1);
	const dot = name.lastIndexOf(".");
	return (dot > 0 ? name.slice(0, dot) : name).toUpperCase();
}

/** `YkOpener.GetData01Index`. */
function readData01Layout(fileSize: bigint): YkLayout | undefined {
	const block = BigInt(DATA01_BLOCK_SIZE);
	const count = Number(fileSize / block);
	if (!isSaneCount(count) || BigInt(count) * block !== fileSize)
		return undefined;
	const entries: YkEntryPlan[] = [];
	for (let index = 0; index < count; index += 1) {
		entries.push({
			index,
			name: `${String(index).padStart(5, "0")}.BMP`,
			offset: BigInt(index) * block,
			size: block,
			kind: "image",
			mixed: false,
			image: DATA01_GEOMETRY,
		});
	}
	return { archiveName: "DATA01", data01: true, entries };
}

/** `YkOpener.GetDataIndex`. */
function readOffsetTableLayout(
	fileSize: bigint,
	archiveName: string,
	offsets: readonly number[],
): YkLayout | undefined {
	const audio = YK_AUDIO_NAMES.has(archiveName);
	const mixed = "DATA03" === archiveName;
	const entries: YkEntryPlan[] = [];
	let current = 0;
	for (let index = 0; index < offsets.length; index += 1) {
		const end = offsets[index] ?? 0;
		const offset = BigInt(current);
		// The reference subtracts two `uint`s, so a table that goes backwards wraps to an enormous
		// size, which the placement check then rejects whole.
		const size = BigInt((end - current) >>> 0);
		if (!checkPlacement(offset, size, fileSize)) return undefined;
		let name = `${archiveName}#${String(index).padStart(4, "0")}`;
		let kind: YkEntryKind = "data";
		let image: YkImageGeometry | undefined;
		let undecoded = false;
		if (
			"DATA02" === archiveName &&
			(index >= DATA02_NAMED_FROM || YK_DATA02_IMAGES.has(index))
		) {
			name += ".BMP";
			kind = "image";
			// `YkOpener.OpenData02Image` prefers the fixed geometry of the high ids over the table.
			const listed =
				index >= DATA02_LARGE_ID
					? DATA02_LARGE_GEOMETRY
					: (YK_DATA02_IMAGES.get(index) ?? null);
			if (listed) image = listed;
			else undecoded = true;
		} else if (audio) {
			name += ".WAV";
			kind = "audio";
		}
		entries.push({
			index,
			name,
			offset,
			size,
			kind,
			mixed,
			...(image ? { image } : {}),
			...(undecoded ? { undecoded: true } : {}),
		});
		current = end;
	}
	return { archiveName, data01: false, entries };
}

/**
 * Reads the layout of a Koei `YK` archive from its name and length alone. `YkOpener.TryOpen` is
 * gated on the extension and drives everything else from the file name: `DATA01` is the fixed block
 * archive and the other names come from the offset table of the reference's second half.
 */
export function readYkLayout(
	fileSize: bigint,
	sourcePath: string,
): YkLayout | undefined {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	const archiveName = archiveNameOf(sourcePath);
	if ("DATA01" === archiveName) return readData01Layout(fileSize);
	const offsets = YK_OFFSET_TABLES.get(archiveName);
	if (!offsets) return undefined;
	return readOffsetTableLayout(fileSize, archiveName, offsets);
}

/** `YkOpener.DecryptData03`: mixes every whole word, leaving a trailing partial word untouched. */
export function decryptYkData03(data: Buffer): void {
	for (let position = 0; position + WORD <= data.length; position += WORD) {
		data.writeUInt32LE(
			(data.readUInt32LE(position) ^ DATA03_KEY) >>> 0,
			position,
		);
	}
}

/** `YkOpener.OpenAudio`: a wave head carrying the stored size plus eight goes in front of the data. */
export function packYkWaveHeader(size: number): Buffer {
	const header = Buffer.from(RIFF_HEADER);
	header.writeUInt32LE((size + 8) >>> 0, 4);
	return header;
}

/**
 * `YkOpener.OpenEntry`. `DATA03` entries are word-mixed and the audio archives get a wave head; every
 * other entry is handed over as stored.
 */
export function unpackYkEntry(data: Buffer, flags: YkEntryFlags): Buffer {
	if (flags.mixed) {
		const payload = Buffer.from(data);
		decryptYkData03(payload);
		return payload;
	}
	if ("audio" === flags.kind)
		return Buffer.concat([packYkWaveHeader(data.length), data]);
	return data;
}

/**
 * `YkImageDecoder.GetImageData`: a 256 entry colour map followed by eight bit indexed pixels in the
 * `ImageData.CreateFlipped` order, so the bitmap keeps its rows bottom up.
 */
export function decodeYkImage(data: Buffer, geometry: YkImageGeometry): Buffer {
	const pixels = geometry.width * geometry.height;
	if (data.length < PALETTE_SIZE + pixels)
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Koei YK picture is shorter than its colour map and pixels",
		);
	return writeBmp8Palette(
		geometry.width,
		geometry.height,
		data.subarray(PALETTE_SIZE, PALETTE_SIZE + pixels),
		data.subarray(0, PALETTE_SIZE),
		true,
	);
}

export const koeiYkDescriptor: FormatDescriptor = {
	id: "koei-yk",
	name: "Koei resource archive",
	extensions: [EXTENSION],
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
			source: "Legacy/Koei/ArcYK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** The archive needs the entry kind to unpack it, so that kind travels through the entry metadata. */
export const koeiYkFormat = defineFixedArchive({
	descriptor: koeiYkDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return readYkLayout(source.size, sourcePath) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readYkLayout(source.size, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Koei YK layout");
		const entries = layout.entries.map((plan) =>
			createFixedEntry({
				id: plan.index,
				...normalizeEntryPath(plan.name),
				offset: plan.offset,
				size: plan.size,
				encrypted: plan.mixed,
				metadata: {
					type: plan.kind,
					...(plan.image ? { image: plan.image } : {}),
					...(plan.undecoded ? { undecoded: true } : {}),
				},
			}),
		);
		return {
			entries,
			metadata: {
				archiveName: layout.archiveName,
				entryCount: entries.length,
			},
		};
	},
	async openEntry(source, entry) {
		const data = await source.readAt(entry.offset, Number(entry.size));
		const kind: YkEntryKind =
			entry.metadata?.type === "audio" ? "audio" : "data";
		return Readable.from([
			unpackYkEntry(data, { kind, mixed: entry.encrypted }),
		]);
	},
});
