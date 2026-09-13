// Format reference: GARBro ArcFormats/ClickTeam/ArcMF.cs, class `MfOpener`. Overlays of Windows
// executables are located with the shared helper ported from ArcFormats/ExeFile.cs.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { createZlibInflateStream } from "@garbro-mcp/codecs";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { findExecutableOverlay } from "../shared/exe.js";

const DOS_SIGNATURE = Buffer.from("MZ", "ascii");
const MFS_SIGNATURE = Buffer.from([
	0x77, 0x77, 0x77, 0x77, 0x49, 0x87, 0x47, 0x12,
]);
const COUNT_OFFSET = 0x1c;
const INDEX_START = 0x20;
/** The reference reads names through a 520-byte window. */
const NAME_BUFFER_SIZE = 520;
/** The reserved words between a name and its size field. */
const RECORD_RESERVED = 4;
const RECORD_SIZE_FIELD = 8;
/** This one library is stored uncompressed. */
const STORED_NAME = "mmfs2.dll";

interface MfsHeader {
	entries: FixedEntry[];
}

/**
 * GARbro `MfOpener.TryOpen`. An archive stored in an executable lives behind its last section; a plain
 * file starts at zero. The eight-byte `wwww` marker has to be present, the entry count sits at 0x1C and
 * the index begins at 0x20.
 *
 * Each record is a UTF-16 name whose length is stored as a code-unit count at the current position,
 * followed by two reserved words, the stored size and the payload. The walk continues from the end of
 * the payload, so the records double as the payload table. Every entry is zlib compressed except the
 * `mmfs2.dll` library.
 */
async function readMfsIndex(
	source: ByteSource,
): Promise<MfsHeader | undefined> {
	let base = 0n;
	if (source.size >= BigInt(DOS_SIGNATURE.length)) {
		const magic = await source.readAt(0n, DOS_SIGNATURE.length);
		if (magic.equals(DOS_SIGNATURE)) {
			const overlay = await findExecutableOverlay(source);
			if (!overlay) return undefined;
			base = overlay.offset;
		}
	}
	if (base + BigInt(INDEX_START) > source.size) return undefined;
	const header = await source.readAt(base, INDEX_START);
	if (!header.subarray(0, MFS_SIGNATURE.length).equals(MFS_SIGNATURE))
		return undefined;

	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	let position = base + BigInt(INDEX_START);
	for (let id = 0; id < count; id += 1) {
		if (position + 2n > source.size) return undefined;
		const nameLength = (await source.readAt(position, 2)).readUInt16LE(0) * 2;
		if (nameLength > NAME_BUFFER_SIZE) return undefined;
		position += 2n;
		if (position + BigInt(nameLength) > source.size) return undefined;
		const nameBytes = await source.readAt(position, nameLength);
		const name = nameBytes.toString("utf16le");
		position += BigInt(nameLength);

		const recordOffset = position + BigInt(RECORD_RESERVED);
		const record = await source.readAt(
			recordOffset,
			RECORD_SIZE_FIELD - RECORD_RESERVED,
		);
		const size = BigInt(record.readUInt32LE(0));
		const payloadOffset = position + BigInt(RECORD_SIZE_FIELD);
		if (!checkPlacement(payloadOffset, size, source.size)) return undefined;

		const compressed = name !== STORED_NAME;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset: payloadOffset,
			size,
			packedSize: size,
			compressed,
		});
		if (compressed) entry.sizeKnown = false;
		entries.push(entry);
		position = payloadOffset + size;
	}
	return { entries };
}

/** GARbro `MfOpener.OpenEntry`: everything but the bundled library is deflated. */
const mfsEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = source.createReadStream(entry.offset, entry.packedSize);
	if (!entry.compressed) return stored;
	return createZlibInflateStream(stored);
};

export const clickTeamMfsDescriptor: FormatDescriptor = {
	id: "clickteam-mfs",
	name: "Multimedia Fusion resource archive",
	extensions: [],
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
			source: "ArcFormats/ClickTeam/ArcMF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const clickTeamMfsFormat: ArchiveFormat = defineFixedArchive({
	descriptor: clickTeamMfsDescriptor,
	detection: { signatures: [{ bytes: MFS_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readMfsIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const result = await readMfsIndex(source);
		if (!result) throw new GarbroError("INVALID_ARCHIVE", "Invalid MFS layout");
		return {
			entries: result.entries,
			metadata: { entryCount: result.entries.length },
		};
	},
	openEntry: mfsEntryOpener,
});
