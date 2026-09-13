// Format reference: GARbro ArcFormats/Ikura/ArcGAN.cs, class `GanOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename, extname } from "node:path";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("GANM0100", "latin1");
const COUNT_FIELD = 0xc;
/** The frame table sits behind a fixed 0x2000 byte area. */
const INDEX_OFFSET = 0x2010;
const RECORD_SIZE = 0x10;
const ID_FIELD = 0;
const REFERENCE_FIELD = 4;
const OFFSET_FIELD = 8;
const SIZE_FIELD = 0xc;
/** Frame names use a two digit index. */
const NAME_DIGITS = 2;

interface GanFrame {
	offset: bigint;
	size: bigint;
	id: number;
	reference: number;
}

/**
 * GARbro `GanOpener.TryOpen`. The animation format keeps a flat frame table behind a fixed area; every frame
 * knows its id, the frame it is based on and where its pixels are stored.
 */
async function readGanIndex(
	source: ByteSource,
): Promise<GanFrame[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = Buffer.from(await source.readAt(0n, COUNT_FIELD + 4));
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET) + BigInt(count * RECORD_SIZE) > source.size)
		return undefined;
	const table = Buffer.from(
		await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE),
	);
	const frames: GanFrame[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const offset = BigInt(table.readUInt32LE(record + OFFSET_FIELD));
		const size = BigInt(table.readUInt32LE(record + SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		frames.push({
			offset,
			size,
			id: table.readInt32LE(record + ID_FIELD),
			reference: table.readInt32LE(record + REFERENCE_FIELD),
		});
	}
	if (frames.length === 0) return undefined;
	return frames;
}

function toFixedEntries(
	frames: readonly GanFrame[],
	sourcePath: string,
): FixedEntry[] {
	const base = basename(sourcePath, extname(sourcePath));
	return frames.map((frame, id) =>
		createFixedEntry({
			id,
			path: `${base}#${id.toString().padStart(NAME_DIGITS, "0")}`,
			offset: frame.offset,
			size: frame.size,
			metadata: {
				type: "image",
				frameId: frame.id,
				reference: frame.reference,
			},
		}),
	);
}

export const ganDescriptor: FormatDescriptor = {
	id: "ikura-gan",
	name: "IKURA GDL animation resource",
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
			source: "ArcFormats/Ikura/ArcGAN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ganFormat = defineFixedArchive({
	descriptor: ganDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readGanIndex(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const frames = await readGanIndex(source);
		if (!frames)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid IKURA GAN layout");
		return {
			entries: toFixedEntries(frames, sourcePath),
			metadata: { entryCount: frames.length },
		};
	},
	/** The reference decodes frames as images and never overrides the plain extraction path. */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return source.createReadStream(entry.offset, entry.size);
	},
});
