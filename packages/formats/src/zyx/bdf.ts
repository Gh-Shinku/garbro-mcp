// Format reference: GARbro "ArcFormats/Zyx/ArcBDF.cs", class `BdfOpener`.
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

const RECORD_SIZE = 0x1c;
const INDEX_START = 4;
const FIRST_FRAME_OFFSET_FIELD = 4;
const OFFSET_FIELD = 0;
const SIZE_FIELD = 4;
const INCREMENTAL_FIELD = 8;
const WIDTH_FIELD = 0x14;
const HEIGHT_FIELD = 0x18;
/** The reference accepts at most a hundred frames. */
const MAX_FRAMES = 100;
/** A frame needs at least one command byte. */
const MIN_FRAME_SIZE = 4;

interface BdfFrame {
	name: string;
	offset: bigint;
	size: number;
	incremental: boolean;
	width: number;
	height: number;
}

async function readBdfFrames(
	source: ByteSource,
	sourcePath: string,
): Promise<BdfFrame[] | undefined> {
	if (source.size < BigInt(INDEX_START + RECORD_SIZE)) return undefined;
	const header = await source.readAt(0n, INDEX_START + RECORD_SIZE);
	const count = header.readInt32LE(0);
	if (count <= 0 || count > MAX_FRAMES) return undefined;
	if (header.readInt32LE(FIRST_FRAME_OFFSET_FIELD) !== 0) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_START) + BigInt(indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_START), indexSize);
	const baseOffset = BigInt(INDEX_START + indexSize);
	const fileName = sourcePath.split(/[\\/]/).pop() ?? "";
	const dot = fileName.lastIndexOf(".");
	const baseName = (dot > 0 ? fileName.slice(0, dot) : fileName) || "frame";
	const frames: BdfFrame[] = [];
	for (let id = 0; id < count; id += 1) {
		const base = id * RECORD_SIZE;
		const offset = baseOffset + BigInt(index.readUInt32LE(base + OFFSET_FIELD));
		const size = index.readUInt32LE(base + SIZE_FIELD);
		const width = index.readInt32LE(base + WIDTH_FIELD);
		const height = index.readInt32LE(base + HEIGHT_FIELD);
		// Frames without a payload are skipped, and a listed frame has to be fully usable.
		if (size === 0) continue;
		if (size < MIN_FRAME_SIZE || width <= 0 || height <= 0) return undefined;
		if (!checkPlacement(offset, BigInt(size), source.size)) return undefined;
		frames.push({
			name: `${baseName}#${String(id).padStart(2, "0")}`,
			offset,
			size,
			incremental: index.readInt32LE(base + INCREMENTAL_FIELD) !== 0,
			width,
			height,
		});
	}
	if (frames.length === 0) return undefined;
	return frames;
}

export const zyxBdfDescriptor: FormatDescriptor = {
	id: "zyx-bdf",
	name: "Zyx multi-frame image package",
	extensions: ["bdf"],
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
			source: "ArcFormats/Zyx/ArcBDF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const zyxBdfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: zyxBdfDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readBdfFrames(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const frames = await readBdfFrames(source, sourcePath);
		if (!frames) throw new GarbroError("INVALID_ARCHIVE", "Invalid BDF index");
		const entries: FixedEntry[] = frames.map((frame, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(frame.name),
				offset: frame.offset,
				size: BigInt(frame.size),
				metadata: {
					type: "image",
					incremental: frame.incremental,
					width: frame.width,
					height: frame.height,
				},
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
