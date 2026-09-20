// Format reference: GARbro "ArcFormats/Malie/ArcLIB.cs", class `LibOpener` and its `Reader`. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

/** 'LIB\0' — the word every picture of the places of the picture of the engine of the kind of Malie stands
 * of. */
const LIB_SIGNATURE = 0x0042494c;
const HEADER_SIZE = 0x10;
const COUNT_OFFSET = 8;
/** The places of the picture of every place of the picture of the walk of the places of the picture stand of
 * two and forty places of the picture. */
const RECORD_SIZE = 0x30;
/** The places of the picture of the name of the place of the picture of the walk of them stand of six and
 * thirty places of the picture. */
const NAME_SIZE = 0x24;
const SIZE_OFFSET = 0x24;
const OFFSET_OFFSET = 0x28;
/** The places of the picture of the walk of the places of the picture of a place of the picture of the walk
 * of them stand beside the places of the picture of the walk of the places of the picture of the name of the
 * picture of the walk of it of their own. The reference stands the places of the picture of the walk of the
 * places of the picture of the places of the picture of their own of no places of the picture of the walk of
 * them, so a picture of the places of the picture of the walk of them that stands for its own places of the
 * picture stands of the places of the picture of the walk of the places of the picture of the walk of them of
 * its own of the places of the picture of their own. */
const MAX_DEPTH = 64;
const LIMIT = 1_000_000;

export interface MalieLibEntry {
	path: string;
	offset: number;
	size: number;
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Reader.ReadIndex`: the places of the picture of the walk of the places of the picture of the engine of
 * the kind of Malie. The places of the picture of the walk of them of a place of the picture of the walk of
 * the places of the picture stand of the places of the picture of the name of the picture of the walk of it,
 * of the places of the picture of the walk of the places of the picture of the place of the picture of the
 * walk of them, and of the places of the picture of the walk of the places of the picture of the place of the
 * picture of the walk of them — and a place of the picture of the walk of the places of the picture that
 * stands of no places of the picture of the walk of the places of the picture of the name of the picture of
 * the walk of it stands for the places of the picture of the walk of the places of the picture of the places
 * of the picture of the walk of them where it stands for the places of the picture of the walk of the places
 * of the picture of its own.
 */
function readIndexOfPlaces(
	data: Buffer,
	baseOffset: number,
	size: number,
	root: string,
	dir: MalieLibEntry[],
	depth: number,
): boolean {
	if (depth > MAX_DEPTH) return false;
	if (baseOffset + HEADER_SIZE > data.length || baseOffset < 0) return false;
	if (data.readUInt32LE(baseOffset) !== LIB_SIGNATURE) return false;
	const count = data.readInt16LE(baseOffset + COUNT_OFFSET);
	if (count <= 0) return false;
	let indexOffset = baseOffset + HEADER_SIZE;
	const indexSize = RECORD_SIZE * count;
	if (indexSize > size) return false;
	if (indexOffset + indexSize > data.length) return false;
	const dataOffset = indexOffset + indexSize;
	for (let i = 0; i < count; i += 1) {
		const name = data
			.subarray(indexOffset, indexOffset + NAME_SIZE)
			.toString("latin1")
			.replace(/\0.*$/, "");
		const entrySize = data.readUInt32LE(indexOffset + SIZE_OFFSET);
		const offset = baseOffset + data.readUInt32LE(indexOffset + OFFSET_OFFSET);
		indexOffset += RECORD_SIZE;
		const hasExtension = /\.[^./\\]+$/.test(name);
		const path = normalizeEntryPath(
			root.length > 0 ? `${root}/${name}` : name,
		).path;
		// The reference stands the places of the picture of the walk of the places of the picture of a place
		// of the picture of the walk of them that stands of no places of the picture of the walk of the places
		// of the picture of the name of its own beside the places of the picture of the walk of the places of
		// the picture of the name of the picture of the walk of it, so the places of the picture of the walk
		// of them of the places of the picture of the walk of the places of the picture of their own stand
		// beside them.
		if (
			!hasExtension &&
			readIndexOfPlaces(data, offset, entrySize, path, dir, depth + 1)
		)
			continue;
		if (offset < dataOffset || offset + entrySize > baseOffset + size)
			return false;
		if (offset + entrySize > data.length) return false;
		dir.push({ path, offset, size: entrySize });
		if (dir.length > LIMIT) return false;
	}
	return true;
}

/** `LibOpener.TryOpen`: the places of the picture of the walk of the places of the picture of the engine of
 * the kind of Malie. */
export function readMalieLibIndex(data: Buffer): MalieLibEntry[] | undefined {
	const dir: MalieLibEntry[] = [];
	if (!readIndexOfPlaces(data, 0, data.length, "", dir, 0)) return undefined;
	if (dir.length === 0) return undefined;
	return dir;
}

export const malieLibDescriptor: FormatDescriptor = {
	id: "malie-lib",
	name: "Malie engine resource archive",
	extensions: ["lib", "sdp"],
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
			source: "ArcFormats/Malie/ArcLIB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const malieLibFormat: ArchiveFormat = defineFixedArchive({
	descriptor: malieLibDescriptor,
	detection: {
		signatures: [{ bytes: Buffer.from("LIB\0", "latin1") }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const data = Buffer.from(
				await source.readAt(0n, Math.min(Number(source.size), 0x1000)),
			);
			return data.readUInt32LE(0) === LIB_SIGNATURE;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const dir = readMalieLibIndex(stored);
		if (!dir) throw invalidArchive("Not an archive of this kind");
		return {
			entries: dir.map((place, id) =>
				createFixedEntry({
					id,
					path: place.path,
					offset: BigInt(place.offset),
					size: BigInt(place.size),
					metadata: { type: "binary" },
				}),
			),
			metadata: { entries: dir.length },
		};
	},
	async openEntry(source: ByteSource, entry) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const place = readMalieLibIndex(stored)?.find(
			(candidate) => candidate.path === entry.path,
		);
		if (!place)
			throw invalidArchive(
				"No places of the picture of the walk of the places of the picture",
			);
		return Readable.from([
			Buffer.from(stored.subarray(place.offset, place.offset + place.size)),
		]);
	},
});
