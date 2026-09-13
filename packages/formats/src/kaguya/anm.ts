// Format reference: GARBro ArcFormats/Kaguya/ArcANM.cs, classes `AnmOpenerBase`, `AnmOpener`, `An10Opener`
// and `An20Opener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import type { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { skipKaguyaFrameTable } from "./an21.js";

const EXTENSION = "anm";
const FRAME_DIGITS = 2;

const AN00_SIGNATURE = Buffer.from("AN00", "ascii");
const AN10_SIGNATURE = Buffer.from("AN10", "ascii");
const AN20_SIGNATURE = Buffer.from("AN20", "ascii");

/** The version 00 and 10 layouts locate their frame list through a count at 0x14. */
const FIRST_COUNT_OFFSET = 0x14;
const FRAME_TABLE_HEADER = 0x18;
const FRAME_TABLE_STRIDE = 4;
const COUNT_SIZE = 2;
/** Their frame headers end at 0x10, or 0x14 when a channel word is present. */
const AN00_FRAME_HEADER = 0x10;
const AN10_FRAME_HEADER = 0x14;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 0x0c;
const CHANNELS_OFFSET = 0x10;
/** The version 00 layout is always thirty-two bits per pixel. */
const AN00_CHANNELS = 4;
/** The version 20 layout walks the shared preamble and then reaches its frames through a gap. */
const AN20_TABLE_OFFSET = 8n;
const AN20_FRAME_GAP = 0x10;
const AN20_FRAME_HEADER = 0x14;

const ATTRIBUTION = [
	{
		project: "GARbro",
		source: "ArcFormats/Kaguya/ArcANM.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
] as const;

export const anmDescriptor: FormatDescriptor = {
	id: "kaguya-anm",
	name: "KaGuYa script engine animation resource",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

export const an10Descriptor: FormatDescriptor = {
	id: "kaguya-an10",
	name: "KaGuYa script engine animation resource, version 10",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

export const an20Descriptor: FormatDescriptor = {
	id: "kaguya-an20",
	name: "KaGuYa script engine animation resource, version 20",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

/** Builds the frame entries the base class names from the archive name and a two-digit index. */
function buildFrames(
	frames: readonly {
		offset: bigint;
		size: bigint;
		width: number;
		height: number;
		depth: number;
	}[],
	sourcePath: string,
): FixedEntry[] {
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	return frames.map((frame, id) =>
		createFixedEntry({
			id,
			...normalizeEntryPath(
				`${baseName}#${String(id).padStart(FRAME_DIGITS, "0")}`,
			),
			offset: frame.offset,
			size: frame.size,
			metadata: {
				inferredType: "image",
				frameIndex: id,
				width: frame.width,
				height: frame.height,
				depth: frame.depth,
			},
		}),
	);
}

/**
 * Walks the frame list that versions 00 and 10 share. A count at 0x14 says how far a frame table extends, and
 * the word behind that table is the real frame count, so the first count is only a way to reach the second.
 * Frames follow it, and each begins with a header holding its width and height at 8 and 0x0C; version 00 adds a
 * fixed channel count of four while version 10 reads its own channel word at 0x10, which makes the frame header
 * four bytes wider. A frame's span is its header plus the product of channels, width and height, and that
 * product is the only way to find the next frame, so nothing is stored per frame beyond these fields.
 */
async function readAnFrames(
	source: ByteSource,
	sourcePath: string,
	frameHeaderSize: number,
	fixedChannels: number | undefined,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_COUNT_OFFSET + COUNT_SIZE)) return undefined;
	const head = await source.readAt(0n, FIRST_COUNT_OFFSET + COUNT_SIZE);
	const firstCount = head.readInt16LE(FIRST_COUNT_OFFSET);
	if (firstCount < 0) return undefined;
	const tableEnd = BigInt(FRAME_TABLE_HEADER + firstCount * FRAME_TABLE_STRIDE);
	if (tableEnd + BigInt(COUNT_SIZE) > source.size) return undefined;
	const count = (await source.readAt(tableEnd, COUNT_SIZE)).readInt16LE(0);
	if (!isSaneCount(count)) return undefined;

	const frames: {
		offset: bigint;
		size: bigint;
		width: number;
		height: number;
		depth: number;
	}[] = [];
	let cursor = tableEnd + BigInt(COUNT_SIZE);
	for (let id = 0; id < count; id += 1) {
		if (cursor + BigInt(frameHeaderSize) > source.size) return undefined;
		const frame = await source.readAt(cursor, frameHeaderSize);
		const width = frame.readUInt32LE(WIDTH_OFFSET);
		const height = frame.readUInt32LE(HEIGHT_OFFSET);
		const channels = fixedChannels ?? frame.readUInt32LE(CHANNELS_OFFSET);
		const imageSize = BigInt(channels) * BigInt(width) * BigInt(height);
		const size = BigInt(frameHeaderSize) + imageSize;
		if (cursor + size > source.size) return undefined;
		frames.push({ offset: cursor, size, width, height, depth: channels });
		cursor += size;
	}
	return buildFrames(frames, sourcePath);
}

/**
 * GARBro `AnmOpener.GetFramesList`, the version 00 layout, whose frames are always thirty-two bits per pixel
 * behind a 0x10-byte header.
 */
async function readAn00Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(AN00_SIGNATURE.length)) return undefined;
	const head = await source.readAt(0n, 4);
	if (!head.equals(AN00_SIGNATURE)) return undefined;
	return readAnFrames(source, sourcePath, AN00_FRAME_HEADER, AN00_CHANNELS);
}

/**
 * GARBro `An10Opener.GetFramesList`, the version 10 layout, which reads a channel word and therefore keeps its
 * pixels behind a 0x14-byte header.
 */
async function readAn10Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(AN10_SIGNATURE.length)) return undefined;
	const head = await source.readAt(0n, 4);
	if (!head.equals(AN10_SIGNATURE)) return undefined;
	return readAnFrames(source, sourcePath, AN10_FRAME_HEADER, undefined);
}

/**
 * GARBro `An20Opener.GetFramesList` and its `SkipFrameTable` helper. This version walks the same preamble that
 * version 21 does — a typed table followed by a counted name table — but without requiring the `[PIC]10` marker
 * behind it. The frame count then sits right there, and the frames themselves begin sixteen bytes further on.
 * Their headers hold width, height and depth at 8, 0x0C and 0x10 and span a 0x14-byte header plus their pixels.
 */
async function readAn20Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(AN20_SIGNATURE.length)) return undefined;
	const head = await source.readAt(0n, 8);
	if (!head.subarray(0, 4).equals(AN20_SIGNATURE)) return undefined;
	const tableCount = head.readUInt16LE(4);
	// The reference reads the table count without a sanity check, and the walk bounds itself.
	const tableEnd = await skipKaguyaFrameTable(
		source,
		AN20_TABLE_OFFSET,
		tableCount,
	);
	if (tableEnd === undefined) return undefined;
	if (tableEnd + BigInt(COUNT_SIZE) > source.size) return undefined;
	const count = (await source.readAt(tableEnd, COUNT_SIZE)).readInt16LE(0);
	if (!isSaneCount(count)) return undefined;

	const frames: {
		offset: bigint;
		size: bigint;
		width: number;
		height: number;
		depth: number;
	}[] = [];
	let cursor = tableEnd + BigInt(COUNT_SIZE) + BigInt(AN20_FRAME_GAP);
	for (let id = 0; id < count; id += 1) {
		if (cursor + BigInt(AN20_FRAME_HEADER) > source.size) return undefined;
		const frame = await source.readAt(cursor, AN20_FRAME_HEADER);
		const width = frame.readUInt32LE(WIDTH_OFFSET);
		const height = frame.readUInt32LE(HEIGHT_OFFSET);
		const depth = frame.readUInt32LE(CHANNELS_OFFSET);
		const imageSize = BigInt(depth) * BigInt(width) * BigInt(height);
		const size = BigInt(AN20_FRAME_HEADER) + imageSize;
		if (cursor + size > source.size) return undefined;
		frames.push({ offset: cursor, size, width, height, depth });
		cursor += size;
	}
	return buildFrames(frames, sourcePath);
}

/** All three layouts store their frames verbatim; turning them into bitmaps is an image concern. */
async function openAnEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	return source.createReadStream(entry.offset, entry.size);
}

export const anmFormat: ArchiveFormat = defineFixedArchive({
	descriptor: anmDescriptor,
	detection: { signatures: [{ bytes: AN00_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAn00Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAn00Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa AN00 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openAnEntry,
});

export const an10Format: ArchiveFormat = defineFixedArchive({
	descriptor: an10Descriptor,
	detection: { signatures: [{ bytes: AN10_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAn10Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAn10Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa AN10 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openAnEntry,
});

export const an20Format: ArchiveFormat = defineFixedArchive({
	descriptor: an20Descriptor,
	detection: { signatures: [{ bytes: AN20_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAn20Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAn20Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KaGuYa AN20 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openAnEntry,
});
