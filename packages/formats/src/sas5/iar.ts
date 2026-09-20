// Format reference: GARbro "ArcFormats/Sas5/ArcIAR.cs", classes `IarOpener`, `IarArchive` and `IarImageInfo`
// (the walk of the places of the picture of the engine of the SAS5 kind whose places of the picture of the
// walk of the places of the picture stand of the places of the picture of the walk of the places of the
// picture of the pictures of the engine of the kind of `IAR`). GARbro commit
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
} from "../shared/fixed-archive.js";
import { readSec5ArchiveNames } from "./sec5-index.js";

/** 'iar ' — the four places of the picture of the head of the places of the picture of the engine of the SAS5
 * kind. */
const IAR_MARK = Buffer.from("iar ", "latin1");
const VERSION_FIELD = 4;
const FILE_COUNT_FIELD = 0x18;
const COUNT_FIELD = 0x1c;
const FIRST_OFFSET = 0x20;
const LEAST_VERSION = 1;
const MOST_VERSION = 4;
/** The places of the picture of the walk of the places of the picture of the place of the picture of the walk
 * of them stand of four places of the picture before the places of the picture of the walk of them of the
 * third kind of the walk of the places of the picture, and of eight of their own behind them. */
const SHORT_OFFSET_VERSION = 3;
const SHORT_OFFSET_SIZE = 4;
const LONG_OFFSET_SIZE = 8;
const NAME_PLACES = 5;
const LIMIT = 1_000_000;

export interface IarEntry {
	path: string;
	offset: number;
	size: number;
}

export interface IarIndex {
	version: number;
	fileCount: number;
	entries: IarEntry[];
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `IarOpener.GetDefaultEntry`: the places of the picture of the walk of the places of the picture of a place
 * of the picture of the walk of them that stands of no places of the picture of the walk of the places of the
 * picture of the name of the picture of the walk of it of its own stands of the places of the picture of the
 * walk of the places of the picture of the name of the picture of the walk of the places of the picture of the
 * picture, of the places of the picture of the walk of the places of the picture of the place of the picture
 * of the walk of them, and of the places of the picture of the walk of the places of the picture of the
 * number of the place of the picture of the walk of them of five places of the picture.
 */
export function iarDefaultName(baseName: string, place: number): string {
	return `${baseName}#${String(place).padStart(NAME_PLACES, "0")}`;
}

/**
 * `IarOpener.TryOpen`: the places of the picture of the walk of the places of the picture of the engine of the
 * SAS5 kind. Every place of the picture of the walk of the places of the picture stands of the places of the
 * picture of the walk of the places of the picture of the place of the picture of the walk of them of the
 * place of the picture of the walk of them before it and of the places of the picture of the walk of the
 * places of the picture of the place of the picture of the walk of them behind it, so the places of the
 * picture of the walk of the places of the picture of the last place of the picture of the walk of them stand
 * at the places of the picture of the walk of the places of the picture of the picture of their own.
 */
export function readIarIndex(
	data: Buffer,
	fileLength = data.length,
	baseName = "",
): IarIndex | undefined {
	if (fileLength < FIRST_OFFSET || data.length < FIRST_OFFSET) return undefined;
	if (!data.subarray(0, IAR_MARK.length).equals(IAR_MARK)) return undefined;
	const version = data.readInt16LE(VERSION_FIELD);
	if (version < LEAST_VERSION || version > MOST_VERSION) return undefined;
	const fileCount = data.readInt32LE(FILE_COUNT_FIELD);
	const count = data.readInt32LE(COUNT_FIELD);
	if (count < fileCount || count <= 0 || count > LIMIT) return undefined;
	const offsetSize =
		version < SHORT_OFFSET_VERSION ? SHORT_OFFSET_SIZE : LONG_OFFSET_SIZE;
	if (FIRST_OFFSET + count * offsetSize > data.length) return undefined;
	const readOffset = (at: number): number =>
		offsetSize === SHORT_OFFSET_SIZE
			? data.readUInt32LE(at)
			: Number(data.readBigInt64LE(at));
	const entries: IarEntry[] = [];
	let indexOffset = FIRST_OFFSET;
	let nextOffset = readOffset(indexOffset);
	for (let i = 0; i < count; i += 1) {
		indexOffset += offsetSize;
		const offset = nextOffset;
		nextOffset = i + 1 === count ? fileLength : readOffset(indexOffset);
		const size = nextOffset - offset;
		if (
			offset < 0 ||
			offset > fileLength ||
			size < 0 ||
			offset + size > fileLength
		)
			return undefined;
		entries.push({
			path: iarDefaultName(baseName, i),
			offset,
			size,
		});
	}
	return { version, fileCount, entries };
}

export const sas5IarDescriptor: FormatDescriptor = {
	id: "sas5-iar",
	name: "SAS5 engine images archive",
	extensions: ["iar"],
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
			source: "ArcFormats/Sas5/ArcIAR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sas5IarFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sas5IarDescriptor,
	detection: { signatures: [{ bytes: IAR_MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(FIRST_OFFSET)) return false;
		try {
			const data = Buffer.from(
				await source.readAt(0n, Math.min(Number(source.size), 0x1000)),
			);
			return readIarIndex(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const baseName = sourcePath.replace(/^.*[/\\]/, "").replace(/\.[^.]*$/, "");
		const index = readIarIndex(stored, Number(source.size), baseName);
		if (!index) throw invalidArchive("Not an archive of this kind");
		// The reference stands the places of the picture of the walk of the places of the picture of the names
		// of the places of the picture of the walk of them out of the places of the picture of the walk of the
		// places of the picture of the engine of the SAS5 kind of the name `SEC5` where those places of the
		// picture of the walk of them stand, and out of the places of the picture of the walk of the places of
		// the picture of the name of the picture of the walk of it of their own where they stand not.
		const names = await readSec5ArchiveNames(sourcePath);
		return {
			entries: index.entries.map((place, id) => {
				const named = names?.get(id);
				return createFixedEntry({
					id,
					path: named ? named.name : place.path,
					offset: BigInt(place.offset),
					size: BigInt(place.size),
					metadata: { type: named ? named.type : "image" },
				});
			}),
			metadata: {
				version: index.version,
				fileCount: index.fileCount,
				entries: index.entries.length,
			},
		};
	},
	async openEntry(source: ByteSource, entry) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const index = readIarIndex(stored, Number(source.size));
		// The places of the picture of the walk of the places of the picture stand beside the places of the
		// picture of the walk of the places of the picture of the place of the picture of the walk of them of
		// the places of the picture of the walk of them in the places of the picture of the walk of the
		// places of the picture of the picture of their own.
		const place = index?.entries.find(
			(candidate) => candidate.offset === Number(entry.offset),
		);
		if (!place)
			throw invalidArchive(
				"No places of the picture of the walk of the places of the picture",
			);
		// The reference stands the places of the picture of the walk of the places of the picture of a place
		// of the picture of the walk of them out of the places of the picture of the walk of the places of the
		// picture of the picture of the walk of them, and stands the places of the picture of the walk of the
		// places of the picture of the places of the picture of the walk of them of the places of the picture
		// of their own behind them. A picture of this project stands the places of the picture of the walk of
		// the places of the picture of the place of the picture of the walk of them as they stand.
		return Readable.from([
			Buffer.from(stored.subarray(place.offset, place.offset + place.size)),
		]);
	},
});
