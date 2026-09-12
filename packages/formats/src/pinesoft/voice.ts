// Format reference: GARbro Legacy/PineSoft/ArcVoice.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename, extname } from "node:path";

const HEADER_SIZE = 0x28;
const COUNT_OFFSET = 0x24;
const MINIMUM_SIZE = 0x2c;

export const pinesoftVoiceDescriptor: FormatDescriptor = {
	id: "pinesoft-voice",
	name: "PineSoft audio archive",
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
			source: "Legacy/PineSoft/ArcVoice.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface VoiceHeader {
	count: number;
}

async function parseHeader(
	source: ByteSource,
): Promise<VoiceHeader | undefined> {
	if (source.size <= BigInt(MINIMUM_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const headerSize = header.readInt32LE(0);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if ((count + 1) * 4 + HEADER_SIZE !== headerSize) return undefined;
	return { count };
}

async function readPinesoftVoice(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid PineSoft voice layout");
	}
	const { count } = header;
	const index = await source.readAt(BigInt(HEADER_SIZE), (count + 1) * 4);
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(index.readUInt32LE(id * 4));
		const nextOffset = BigInt(index.readUInt32LE((id + 1) * 4));
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"PineSoft voice entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${baseName}#${String(id).padStart(5, "0")}`,
				offset,
				size,
			}),
		);
	}
	if (BigInt(index.readUInt32LE(count * 4)) !== source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"PineSoft voice final offset does not match the file size",
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const pinesoftVoiceFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pinesoftVoiceDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readPinesoftVoice,
});
