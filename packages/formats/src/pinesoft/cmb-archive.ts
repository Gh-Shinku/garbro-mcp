// Format reference: GARBro "Legacy/PineSoft/ArcCMB.cs", class `CmbOpener`. The LZSS the packed entries are
// read with is GARbro's own "ArcFormats/LzssStream.cs", a frame of four thousand bytes written from its end
// down, a control byte naming eight decisions from its lowest bit up. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { CMB_LAYOUT, CMB_NONE } from "./cmb-layout.js";

/** The words a picture the engine packs is told by, and the head the packed stream stands behind. */
const OGG_SIGNATURE = 0x5367674f;
const BPD_ID = 0x4450420f;
const BPD_ID_MASK = 0xffffff0f;
const BPD_HEAD_SIZE = 4;
/** A sound of the engine names the long word of its own data and the short one of its kind. */
const SOUND_ID = 0x10;
const SOUND_HEAD_SIZE = 0x18;
/** An archive of the engine names how many entries stand in it and how long its head is. */
const INNER_COUNT_FIELD = 0x24;
const INNER_HEAD_SIZE = 0x28;
/** An entry this short stands as it is, whatever stands in it. */
const SHORT_ENTRY_SIZE = 0x2c;
/** Every entry of an archive of this engine is named after the place of its own, five places long. */
const NAME_LENGTH = 5;
const NAME_PAD = "0";
const LIMIT = 256 * 1024 * 1024;

export interface CmbPlace {
	index: number;
	path: string;
	offset: number;
	size: number;
	type: string;
	packed: boolean;
	unpackedSize: number;
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The places of the archive of a game, as the reference keeps them: a row to the archive of every number. */
export function cmbLayoutFor(index: number): readonly number[] | undefined {
	if (!Number.isSafeInteger(index) || index < 0) return undefined;
	return CMB_LAYOUT[index];
}

/** The name of an archive of this engine: a number and nothing else. */
export function cmbIndexOf(name: string): number | undefined {
	const stem = name.replace(/^.*[/\\]/, "").replace(/\.[^.]*$/, "");
	if (!/^\d+$/.test(stem)) return undefined;
	const index = Number(stem);
	return Number.isSafeInteger(index) ? index : undefined;
}

/**
 * `CmbOpener.TryOpen`: the places of the entries of an archive stand in the table of the game, and the places
 * of the entries that stand there name where every one of them begins. The last of them has to name the end of
 * the archive itself, which is what tells an archive from a file that merely stands beside one.
 */
export function placesFromOffsets(
	offsets: readonly number[],
	fileLength: number,
): CmbPlace[] | undefined {
	if (offsets.length < 2) return undefined;
	if ((offsets[offsets.length - 1] ?? 0) !== fileLength) return undefined;
	const places: CmbPlace[] = [];
	for (let at = 0; at < offsets.length - 1; at += 1) {
		const offset = offsets[at] ?? CMB_NONE;
		if (CMB_NONE === offset) continue;
		if (offset >= fileLength) return undefined;
		places.push({
			index: at,
			path: String(at).padStart(NAME_LENGTH, NAME_PAD),
			offset,
			size: 0,
			type: "binary",
			packed: false,
			unpackedSize: 0,
		});
	}
	if (0 === places.length) return undefined;
	for (let at = 0; at < places.length; at += 1) {
		const place = places[at];
		const next = places[at + 1];
		if (!place) continue;
		place.size = (next ? next.offset : fileLength) - place.offset;
		if (place.offset + place.size > fileLength) return undefined;
	}
	return places;
}

/**
 * `CmbOpener.DetectFileTypes`: an archive of this engine names no kind of its own, so the reference reads a
 * few words of every entry and tells a sound, a picture of the engine that is packed, a sound of another kind
 * and an archive standing within an archive. A picture of the engine is handed over **behind** the head of its
 * own, with the length it unfolds to taken out of that head.
 */
export function detectCmbTypes(data: Buffer, places: CmbPlace[]): void {
	for (const place of places) {
		if (place.offset + 8 > data.length) continue;
		const signature = data.readUInt32LE(place.offset);
		if (OGG_SIGNATURE === signature) {
			place.type = "audio";
			place.path = `${place.path}.ogg`;
			continue;
		}
		const id = data.readUInt32LE(place.offset + BPD_HEAD_SIZE);
		if (BPD_ID === (id & BPD_ID_MASK)) {
			place.type = "image";
			place.path = `${place.path}.bpd`;
			place.packed = true;
			place.unpackedSize = signature;
			place.offset += BPD_HEAD_SIZE;
			place.size -= BPD_HEAD_SIZE;
			continue;
		}
		if (place.size === signature + SOUND_HEAD_SIZE && SOUND_ID === id) {
			place.type = "audio";
			continue;
		}
		if (place.size <= SHORT_ENTRY_SIZE) continue;
		if (place.offset + INNER_COUNT_FIELD + 4 > data.length) continue;
		const count = data.readInt32LE(place.offset + INNER_COUNT_FIELD);
		if ((count + 1) * 4 + INNER_HEAD_SIZE === signature) {
			place.type = "archive";
		}
	}
}

/** `CmbOpener.OpenEntry`: an entry the engine packs is read through the frame of the reference's own walk. */
export function unpackCmbEntry(stored: Buffer, place: CmbPlace): Buffer {
	if (!place.packed) return stored;
	if (place.unpackedSize <= 0 || place.unpackedSize > LIMIT) {
		throw invalidArchive(
			"The length a picture of this engine unfolds to does not stand in its head",
		);
	}
	return inflateLzss(stored, { outputLength: place.unpackedSize });
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readCmb(source: ByteSource, sourcePath: string) {
	const index = cmbIndexOf(sourcePath);
	const layout = undefined === index ? undefined : cmbLayoutFor(index);
	if (!layout) throw invalidArchive("Not an archive of the PineSoft engine");
	const data = await readStored(source);
	const places = placesFromOffsets(layout, data.length);
	if (!places)
		throw invalidArchive(
			"The places of the entries of this archive are not its own",
		);
	detectCmbTypes(data, places);
	const entries: FixedEntry[] = places.map((place) =>
		createFixedEntry({
			id: place.index,
			path: place.path,
			offset: BigInt(place.offset),
			size: BigInt(place.packed ? place.unpackedSize : place.size),
			compressed: place.packed,
			packedSize: BigInt(place.size),
			metadata: { type: place.type, packed: place.packed },
		}),
	);
	return {
		entries,
		metadata: { entries: entries.length, archive: index },
	};
}

export const cmbArchiveDescriptor: FormatDescriptor = {
	id: "pinesoft-cmb-archive",
	name: "PineSoft resource archive",
	extensions: ["cmb"],
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
			source: "Legacy/PineSoft/ArcCMB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cmbArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cmbArchiveDescriptor,
	// The archive writes no word of its own: it is told by its name and by the places of its entries, which
	// the reference keeps for the archives of one game.
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath) return false;
		const index = cmbIndexOf(sourcePath);
		const layout = undefined === index ? undefined : cmbLayoutFor(index);
		if (!layout || 0n === source.size) return false;
		return BigInt(layout[layout.length - 1] ?? 0) === source.size;
	},
	async read(source: ByteSource, sourcePath: string) {
		return readCmb(source, sourcePath);
	},
	async openEntry(source: ByteSource, entry) {
		const data = await readStored(source);
		const offset = Number(entry.offset);
		const size = Number(
			entry.metadata?.packed ? entry.metadata.packedSize : entry.size,
		);
		if (!checkPlacement(BigInt(offset), BigInt(size), BigInt(data.length))) {
			throw invalidArchive("An entry of this archive stands past its end");
		}
		const place: CmbPlace = {
			index: Number(entry.id),
			path: entry.path,
			offset,
			size,
			type: String(entry.metadata?.type ?? "binary"),
			packed: true === entry.metadata?.packed,
			unpackedSize: Number(entry.size),
		};
		return Readable.from([
			unpackCmbEntry(data.subarray(offset, offset + size), place),
		]);
	},
});
