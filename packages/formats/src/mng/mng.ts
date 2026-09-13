// Format reference: GARbro "ArcFormats/ImageMNG.cs", classes `MngFormat` and `MngOpener`.
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MNG_SIGNATURE = Buffer.from([0x8a, 0x4d, 0x4e, 0x47]);
const MNG_DATA_MARKER = Buffer.from([0x0d, 0x0a, 0x1a, 0x0a]);
const MHDR_MARKER = "MHDR";
const IHDR_MARKER = "IHDR";
const IEND_MARKER = "IEND";
const MEND_MARKER = "MEND";
const MNG_HEADER_SIZE = 8;
const CHUNK_HEADER_SIZE = 12;
const MHDR_REQUIRED_SIZE = 28;
/** Guards the unbounded chunk walk of the reference against malformed files. */
const MAX_CHUNKS = 0x10000;

interface MngChunk {
	offset: bigint;
	size: number;
	type: string;
}

/** Reads one MNG chunk header at `offset`, or nothing when the file ends there. */
async function readChunk(
	source: ByteSource,
	offset: bigint,
): Promise<MngChunk | undefined> {
	if (offset + BigInt(CHUNK_HEADER_SIZE) > source.size) return undefined;
	const header = await source.readAt(offset, CHUNK_HEADER_SIZE);
	return {
		offset,
		size: header.readInt32BE(0),
		type: header.toString("latin1", 4, 8),
	};
}

interface PngFrame {
	offset: bigint;
	size: bigint;
}

/**
 * `MngFormat.ReadMetaData` finds the first embedded PNG stream and `MngOpener.TryOpen` splits it into
 * frames: an entry covers everything from an IHDR chunk up to the end of its IEND chunk.
 */
async function readFrames(source: ByteSource): Promise<PngFrame[] | undefined> {
	if (source.size < BigInt(MNG_HEADER_SIZE + 8)) return undefined;
	const header = await source.readAt(0n, MNG_HEADER_SIZE + 8);
	if (!header.subarray(4, 8).equals(MNG_DATA_MARKER)) return undefined;
	const mhdrSize = header.readInt32BE(MNG_HEADER_SIZE);
	if (
		header.toString("latin1", MNG_HEADER_SIZE + 4, MNG_HEADER_SIZE + 8) !==
		MHDR_MARKER
	)
		return undefined;
	if (mhdrSize < MHDR_REQUIRED_SIZE) return undefined;
	// The header chunk is followed by its own four byte checksum.
	let position = BigInt(MNG_HEADER_SIZE + 8 + mhdrSize + 4);
	let pngOffset: bigint | undefined;
	for (let seen = 0; seen < MAX_CHUNKS; seen += 1) {
		const chunk = await readChunk(source, position);
		if (!chunk || chunk.size < 0) break;
		if (chunk.type === MEND_MARKER || chunk.type === IEND_MARKER) break;
		if (chunk.type === IHDR_MARKER) {
			pngOffset = chunk.offset;
			break;
		}
		position += BigInt(chunk.size + CHUNK_HEADER_SIZE);
	}
	if (pngOffset === undefined) return undefined;
	const frames: PngFrame[] = [];
	let ihdrOffset: bigint | undefined;
	position = pngOffset;
	for (let seen = 0; seen < MAX_CHUNKS; seen += 1) {
		if (position >= source.size) break;
		const chunk = await readChunk(source, position);
		if (!chunk || chunk.size < 0) break;
		if (chunk.type === MEND_MARKER) break;
		if (chunk.type === IHDR_MARKER) {
			ihdrOffset = chunk.offset;
		} else if (chunk.type === IEND_MARKER) {
			// An IEND without a matching IHDR is rejected by the reference.
			if (ihdrOffset === undefined) return undefined;
			const size =
				chunk.offset + BigInt(chunk.size + CHUNK_HEADER_SIZE) - ihdrOffset;
			if (!checkPlacement(ihdrOffset, size, source.size)) return undefined;
			frames.push({ offset: ihdrOffset, size });
			ihdrOffset = undefined;
		}
		position += BigInt(chunk.size + CHUNK_HEADER_SIZE);
	}
	return frames.length === 0 ? undefined : frames;
}

export const mngDescriptor: FormatDescriptor = {
	id: "mng",
	name: "Multiple-image Network Graphics",
	extensions: ["mng"],
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
			source: "ArcFormats/ImageMNG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mngFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mngDescriptor,
	detection: { signatures: [{ bytes: MNG_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFrames(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const frames = await readFrames(source);
		if (!frames) throw new GarbroError("INVALID_ARCHIVE", "Invalid MNG stream");
		const fileName = sourcePath.split(/[\\/]/).pop() ?? "";
		const dot = fileName.lastIndexOf(".");
		const baseName = (dot > 0 ? fileName.slice(0, dot) : fileName) || "frame";
		const entries: FixedEntry[] = frames.map((frame, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(`${baseName}#${String(id).padStart(2, "0")}.png`),
				offset: frame.offset,
				size: frame.size,
				metadata: { type: "image" },
			}),
		);
		return {
			entries,
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
