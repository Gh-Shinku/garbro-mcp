// Format reference: GARbro ArcFormats/AnimeGameSystem/ArcANI.cs, class `AniOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	createFixedEntry,
	defineFixedArchive,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 4;
/** The reference refuses files larger than a signed 32-bit length. */
const MAX_FILE_SIZE = 0x7fffffff;
const MAX_FRAME_COUNT = 10000;
/** A frame type of one marks a frame that is not listed. */
const SKIPPED_FRAME_TYPE = 1;
/** Frame types that start a new key frame group. */
const KEY_FRAME_TYPES = new Set([0, 0xa]);

/**
 * GARbro `AniOpener.TryOpen`. The format only applies to `.ani` names. The first word is the payload
 * offset, which doubles as the size of the frame table: the table holds one offset per four bytes, so
 * its entry count is that offset divided by four, and the offsets themselves follow from 0x04.
 *
 * Every distinct frame offset starts with a frame type byte below 0x20. A type of one is skipped; the
 * remaining types are masked to their low nibble, and types zero and 0x0A begin a new key frame, whose
 * index is the position of the next listed frame. Listed frames are named after their table index with
 * four digits and carry the frame metadata the image layer needs.
 *
 * Sizes are not in the table: entries are sorted by offset, and each one stores up to the next
 * *different* offset, so frames that share an offset all end where the next group begins.
 *
 * Frame payloads are CG images, and GARbro decodes them with the separate `CG` image format, including
 * its key frame chain. That image layer is out of scope, so entries are extracted as stored.
 */
async function readAniIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== "ani") return undefined;
	if (source.size < BigInt(HEADER_SIZE) || source.size > BigInt(MAX_FILE_SIZE))
		return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const firstOffset = BigInt(header.readUInt32LE(0));
	if (firstOffset < BigInt(HEADER_SIZE) || firstOffset >= source.size)
		return undefined;
	if (firstOffset % 4n !== 0n) return undefined;
	const frameCount = Number(firstOffset / 4n);
	if (frameCount > MAX_FRAME_COUNT) return undefined;

	const offsets: bigint[] = [firstOffset];
	if (frameCount > 1) {
		const table = await source.readAt(
			BigInt(HEADER_SIZE),
			(frameCount - 1) * 4,
		);
		for (let index = 1; index < frameCount; index += 1) {
			const offset = BigInt(table.readUInt32LE((index - 1) * 4));
			if (offset < firstOffset || offset >= source.size) return undefined;
			offsets.push(offset);
		}
	}

	const frameTypes = new Map<string, number>();
	for (const offset of offsets) {
		const key = offset.toString();
		if (frameTypes.has(key)) continue;
		const byte = (await source.readAt(offset, 1))[0] ?? 0;
		if (byte >= 0x20) return undefined;
		frameTypes.set(key, byte);
	}

	interface Frame {
		name: string;
		offset: bigint;
		frameType: number;
		keyFrame: number;
		frameIndex: number;
	}
	const frames: Frame[] = [];
	let lastKeyFrame = 0;
	for (let index = 0; index < frameCount; index += 1) {
		const offset = offsets[index];
		if (offset === undefined) return undefined;
		const rawType = frameTypes.get(offset.toString()) ?? 0;
		if (rawType === SKIPPED_FRAME_TYPE) continue;
		const frameType = rawType & 0xf;
		if (KEY_FRAME_TYPES.has(frameType)) lastKeyFrame = frames.length;
		frames.push({
			name: index.toString().padStart(4, "0"),
			offset,
			frameType,
			keyFrame: lastKeyFrame,
			frameIndex: frames.length,
		});
	}
	if (frames.length === 0) return undefined;

	// Sizes come from an offset-ordered walk: each frame reaches the next different offset, or the end
	// of the file.
	const order = frames.map((_frame, index) => index);
	order.sort((left, right) => {
		const a = frames[left];
		const b = frames[right];
		if (!a || !b) return 0;
		return a.offset < b.offset ? -1 : a.offset > b.offset ? 1 : 0;
	});
	const sizes = new Array<bigint>(frames.length).fill(0n);
	for (let position = 0; position < order.length; position += 1) {
		const index = order[position];
		if (index === undefined) return undefined;
		const frame = frames[index];
		if (!frame) return undefined;
		// Equal offsets are contiguous, so the run ends at the next different offset.
		let next = position + 1;
		while (
			next < order.length &&
			frames[order[next] ?? 0]?.offset === frame.offset
		)
			next += 1;
		const nextIndex = order[next];
		const nextOffset =
			nextIndex === undefined
				? source.size
				: (frames[nextIndex]?.offset ?? source.size);
		sizes[index] = BigInt.asUintN(32, nextOffset - frame.offset);
	}

	return frames.map((frame, index) =>
		createFixedEntry({
			id: index,
			path: frame.name,
			offset: frame.offset,
			size: sizes[index] ?? 0n,
			metadata: {
				type: "image",
				frameType: frame.frameType,
				keyFrame: frame.keyFrame,
				frameIndex: frame.frameIndex,
			},
		}),
	);
}

/** GARbro does not override `OpenEntry` for this format, so entries are their stored frames. */
const aniEntryOpener: FixedEntryOpener = async (source, entry) =>
	source.createReadStream(entry.offset, entry.size);

export const animeGameSystemAniDescriptor: FormatDescriptor = {
	id: "ags-ani",
	name: "Anime Game System animation resource",
	extensions: ["ani"],
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
			source: "ArcFormats/AnimeGameSystem/ArcANI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const animeGameSystemAniFormat: ArchiveFormat = defineFixedArchive({
	descriptor: animeGameSystemAniDescriptor,
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath = ""): Promise<boolean> {
		return (await readAniIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAniIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ANI layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: aniEntryOpener,
});
