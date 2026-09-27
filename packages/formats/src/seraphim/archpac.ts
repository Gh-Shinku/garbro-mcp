// Port of GARbro "ArcFormats/Seraphim/ArcSeraph.cs" (tag "SERAPH/ARCH", class ArchPacOpener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The resource archives of the engine of Seraphim.
//
// The reference reads two shapes of this archive. The first stands of `KnownSchemes`, a table keyed by the
// name of the archive that holds the offset of the index of every game - offsets "hardcoded into game
// executable", as the reference's own note says - and that table ships **empty**. The second, which needs no
// table at all, stands of a companion file: where `ArchPac.dat` stands beside a `ScnPac.dat`, the index of
// the archive stands in that companion, at a place the companion's own head names. The port carries the
// second shape, which is the one a stock reference reads as well.
//
// The index itself is a table of `baseCount` runs (at most `0x40` of them), every run a place of the file
// and a count of files, of `fileCount` files over all of them; every file then stands of the places of a
// window of `baseCount + 1` places of the file, walked **backwards** over the runs, of the count of a file
// standing of the place of the next one. A file is named `<run>-<%05d>.cts`.
//
// The places of a file of the engine stand of the places of it as they stand where the word of the head of
// the file stands of `0x9C78` (`0x78 0x9C`, a stream of zlib) or where the first place stands at one and
// the fifth at `0x78`, of a head of four places skipped. The picture behind them is a plain one of its own
// where the head of it names a count of the places of a picture that stands within the counts of the
// reference: the counts of the places of a row and of a column, and then three places of the file for every
// place of the picture, of the places of the colours standing as they stand. Every other file stands handed
// over as its places stand, which is a departure written down in `docs/formats/seraphim-archpac.md`.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { basename } from "node:path";
import { writeBmp24 } from "../shared/bmp.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { readCompanionFile } from "../shared/companion.js";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";

/** `ArchPacOpener.TryOpen`: the name of the archive of the engine, and of its companion. */
const ARCHIVE_NAME = "archpac.dat";
const COMPANION_NAME = "ScnPac.dat";
/** The places of the head of the companion: the place of the first file, and the index behind it. */
const FIRST_PLACE_AT = 4;
const PLACES_PER_PLACE = 4;
/** The counts of the runs of the index and of the files of every run. */
const MOST_RUNS = 0x40;
const RUN_PLACES = 8;
const FILE_PLACES = 4;
/** The places of the name of a file of the engine. */
const NAME_DIGITS = 5;
const NAME_TAIL = ".cts";
/** The counts of the places of the head of a picture of the engine. */
const MOST_PICTURE_PLACES = 0x4100;
const PICTURE_HEAD_PLACES = 4;
const PICTURE_COLOURS = 3;
const ZLIB_WORD = 0x9c78;
const SKIPPED_HEAD_WORD = 1;
const SKIPPED_HEAD_PLACES = 4;
const ZLIB_FIRST_PLACE = 0x78;

/** One run of the index of the engine: a place of the file and the count of the files that stand there. */
interface SeraphimRun {
	offset: number;
	count: number;
}

/** One file of the index of the engine. */
export interface SeraphimArchEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

/**
 * `ArchPacOpener.ReadIndex`: the files of the index of the engine at the place given, of the counts of the
 * reference. The first place of every run of files stands of the run itself, and the places of a file stand
 * one run behind the other, of the run at the head of the index last.
 */
export function walkSeraphimArchIndex(
	index: Buffer,
	indexOffset: number,
	maxOffset: bigint,
): SeraphimArchEntry[] | undefined {
	const readAt = (at: number): number =>
		at + 4 <= index.length ? index.readInt32LE(at) : -1;
	if (indexOffset + RUN_PLACES > index.length) return undefined;
	const runCount = readAt(indexOffset);
	const fileCount = readAt(indexOffset + PLACES_PER_PLACE);
	indexOffset += RUN_PLACES;
	if (runCount <= 0 || runCount > MOST_RUNS || !isSaneCount(fileCount)) {
		return undefined;
	}
	const runs: SeraphimRun[] = [];
	let total = 0;
	for (let at = 0; at < runCount; at += 1) {
		const offset = readAt(indexOffset) >>> 0;
		const count = readAt(indexOffset + PLACES_PER_PLACE);
		if (count <= 0 || count > fileCount || BigInt(offset) > maxOffset) {
			return undefined;
		}
		total += count;
		if (total > fileCount) return undefined;
		runs.push({ offset, count });
		indexOffset += RUN_PLACES;
	}
	if (total !== fileCount) return undefined;
	const entries: SeraphimArchEntry[] = [];
	for (let run = runCount - 1; run >= 0; run -= 1) {
		const base = runs[run];
		if (!base) return undefined;
		let next = readAt(indexOffset) >>> 0;
		indexOffset += FILE_PLACES;
		for (let at = 0; at < base.count; at += 1) {
			const start = next;
			next = readAt(indexOffset) >>> 0;
			indexOffset += FILE_PLACES;
			if (next < start) return undefined;
			const size = next - start;
			const offset = BigInt(start + base.offset);
			if (!checkPlacement(offset, BigInt(size), maxOffset)) return undefined;
			if (size > 0) {
				entries.push({
					name: `${run}-${String(at).padStart(NAME_DIGITS, "0")}${NAME_TAIL}`,
					offset,
					size: BigInt(size),
				});
			}
		}
	}
	return 0 === entries.length ? undefined : entries;
}

/** `SeraphArchive.OpenEntry`: the places of a file of the engine, of the places of zlib where they stand so. */
export async function unpackSeraphimArchEntry(data: Buffer): Promise<Buffer> {
	if (data.length < PICTURE_HEAD_PLACES) return data;
	const word = (data.readInt32LE(0) & 0xffff) >>> 0;
	if (ZLIB_WORD === word) return inflateZlibBuffer(data);
	if (
		SKIPPED_HEAD_WORD === data.readInt32LE(0) &&
		ZLIB_FIRST_PLACE === data[SKIPPED_HEAD_PLACES]
	) {
		return inflateZlibBuffer(data.subarray(SKIPPED_HEAD_PLACES));
	}
	return data;
}

/** `SeraphArchive.OpenRawImage`: the picture of a file of the engine, where its head names one. */
export function decodeSeraphimArchPicture(data: Buffer): Buffer | undefined {
	if (data.length < PICTURE_HEAD_PLACES) return undefined;
	const width = data.readUInt16LE(0);
	const height = data.readUInt16LE(2);
	const planeSize = width * height;
	const total = data.length - PICTURE_HEAD_PLACES;
	if (
		width > MOST_PICTURE_PLACES ||
		0 === width ||
		0 === height ||
		0 === planeSize ||
		0 !== total % planeSize
	) {
		return undefined;
	}
	const stride = width * PICTURE_COLOURS;
	if (height * stride > total) return undefined;
	const pixels = Buffer.from(
		data.subarray(PICTURE_HEAD_PLACES, PICTURE_HEAD_PLACES + height * stride),
	);
	return writeBmp24(width, height, pixels, false);
}

export const seraphimArchDescriptor: FormatDescriptor = {
	id: "seraphim-archpac",
	name: "Seraphim engine resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/Seraphim/ArcSeraph.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

/** The index of an archive of the engine, of its companion as the reference stands of it. */
async function readSeraphimArch(
	source: ByteSource,
	sourcePath: string,
): Promise<SeraphimArchEntry[] | undefined> {
	if (basename(sourcePath).toLowerCase() !== ARCHIVE_NAME) return undefined;
	const companion = await readCompanionFile(sourcePath, COMPANION_NAME);
	if (!companion || companion.length < FIRST_PLACE_AT + PLACES_PER_PLACE) {
		return undefined;
	}
	const firstPlace = companion.readUInt32LE(FIRST_PLACE_AT);
	if (firstPlace < PLACES_PER_PLACE) return undefined;
	const indexOffset = companion.readUInt32LE(firstPlace - PLACES_PER_PLACE);
	return walkSeraphimArchIndex(companion, indexOffset, source.size);
}

export const seraphimArchEntryOpener: FixedEntryOpener = async (
	source,
	entry,
) => {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const places = await unpackSeraphimArchEntry(stored);
	const picture = decodeSeraphimArchPicture(places);
	return Readable.from([picture ?? places]);
};

export const seraphimArchFormat: ArchiveFormat = defineFixedArchive({
	descriptor: seraphimArchDescriptor,
	detection: {
		signatures: [],
		priority: -1,
		extensionFallback: true,
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readSeraphimArch(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const walked = await readSeraphimArch(source, sourcePath);
		if (!walked) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not an archive of the engine of Seraphim: its name is not that of the archive of the engine, or the index of its companion stands of no walk of this engine",
			);
		}
		const entries: FixedEntry[] = walked.map((entry, id) => ({
			...createFixedEntry({
				id,
				path: entry.name,
				offset: entry.offset,
				size: entry.size,
				compressed: false,
				metadata: { type: "image", image: "bmp" } as Record<string, unknown>,
			}),
			sizeKnown: true,
		}));
		return { entries, metadata: { count: entries.length } };
	},
	openEntry: seraphimArchEntryOpener,
});
