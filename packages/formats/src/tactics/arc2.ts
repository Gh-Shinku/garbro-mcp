// Port of GARbro "ArcFormats/Tactics/ArcTactics.cs" (tag "ARC/Tactics/2", class Arc2Opener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. An archive of the engine of Tactics of the second
// shape: the head of the engine is the same as the first shape's, and behind it stands a flat list of the
// places of the pictures of the engine rather than a packed index.
//
// The reference refuses such an archive at the head of its walk where it holds no scheme for it:
// `Arc2Opener.TryOpen` reads the flat list and then returns nothing unless `QueryScheme()` answers with the
// password of the game, which the reference fills from its format database (keyed on the title of the game)
// or from the settings of the user, and neither stands in the reference tree. This port carries no place to
// take a password from outside either, so it lists the pictures of the archive - the walk the reference
// stands of once a scheme is at hand - and refuses every one of them where its places are asked for, with
// the reason of the refusal named. That is a departure from the reference, which refuses the whole archive
// instead; it is written down in `docs/formats/tactics-arc2.md`.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";
/** The words of the head of the engine at 4, which both shapes of the archive stand of. */
const HEAD_MARK = "ICS_ARC_FILE";
/** Where the list of the pictures of the engine begins. */
const LIST_OFFSET = 0x10;
/** The places of the file of one word of the list, in front of the name of it. */
const RECORD_SIZE = 0x14;
/** The count of the places of the file of a name of the list. */
const MAX_NAME_LENGTH = 0x100;

/** A picture of the engine: where its places stand, of what count, and whether they stand packed. */
export interface Tactics2Entry {
	name: string;
	/** The count of the places of the file, being the count of the unpacked places where it stands bold. */
	size: number;
	/** The count of the places the picture stands of where its places are unpacked, of nought otherwise. */
	unpacked: number;
	offset: number;
}

/** The pictures of the engine of the flat list at 0x10, of the head of the file. */
export function parseTactics2List(data: Buffer): Tactics2Entry[] | undefined {
	if (data.length < LIST_OFFSET) return undefined;
	if (data.toString("latin1", 4, 4 + HEAD_MARK.length) !== HEAD_MARK) {
		return undefined;
	}
	const entries: Tactics2Entry[] = [];
	let offset = LIST_OFFSET;
	while (offset < data.length) {
		if (offset + RECORD_SIZE > data.length) return undefined;
		const size = data.readUInt32LE(offset);
		const unpacked = data.readUInt32LE(offset + 4);
		const nameLength = data.readUInt32LE(offset + 8);
		if (0 === nameLength) break;
		if (nameLength > MAX_NAME_LENGTH) return undefined;
		offset += RECORD_SIZE;
		if (offset + nameLength > data.length) return undefined;
		const name = decodeCp932(data.subarray(offset, offset + nameLength));
		offset += nameLength;
		if (offset + size > data.length) return undefined;
		entries.push({ name, size, unpacked, offset });
		offset += size;
	}
	if (0 === entries.length) return undefined;
	if (!isSaneCount(entries.length)) return undefined;
	return entries;
}

export const tactics2ArcDescriptor: FormatDescriptor = {
	id: "tactics-arc2",
	name: "Tactics resource archive of the second shape",
	extensions: ["arc", "adf"],
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
			source: "ArcFormats/Tactics/ArcTactics.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

/** `Arc2Opener.OpenEntry`: the places of the picture stand of the password of the game. */
export const tactics2EntryOpener: FixedEntryOpener = async () => {
	throw new GarbroError(
		"UNSUPPORTED_FEATURE",
		"The places of a picture of the engine stand of the password of the game, which the reference stands of no place of the file for and this port carries no place to take one from",
	);
};

export const tactics2ArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tactics2ArcDescriptor,
	detection: {
		signatures: [
			{
				bytes: Buffer.concat([
					Buffer.from("TACT", "latin1"),
					Buffer.from(HEAD_MARK, "latin1"),
				]),
			},
		],
		// The first shape of the archive stands of the same head, of a packed index behind it; it is tried
		// first, and a file of this shape stands of it only where that index cannot be walked.
		priority: -1,
	},
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readList(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, _sourcePath: string) {
		const entries = await readList(source);
		if (!entries)
			throw invalidArchive("Not an archive of the second shape of the engine");
		const fixed: FixedEntry[] = [];
		const names = new Set<string>();
		for (const [id, entry] of entries.entries()) {
			const { path, rawPath } = normalizeEntryPath(entry.name);
			if (names.has(path)) {
				throw invalidArchive("The archive stands of two pictures of one name");
			}
			names.add(path);
			const packed = 0 !== entry.unpacked;
			fixed.push({
				...createFixedEntry({
					id,
					path,
					...(rawPath === undefined ? {} : { rawPath }),
					offset: BigInt(entry.offset),
					size: BigInt(entry.size),
					compressed: packed,
					metadata: {
						type: "image",
						unpackedSize: packed ? entry.unpacked : entry.size,
						storedSize: entry.size,
					} as Record<string, unknown>,
				}),
				sizeKnown: true,
			});
		}
		return {
			entries: fixed,
			metadata: { count: fixed.length, shape: "flat-list" },
		};
	},
	openEntry: tactics2EntryOpener,
});

async function readList(
	source: ByteSource,
): Promise<Tactics2Entry[] | undefined> {
	if (source.size < BigInt(LIST_OFFSET)) return undefined;
	return parseTactics2List(
		Buffer.from(await source.readAt(0n, Number(source.size))),
	);
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}
