// Format reference: GARbro ArcFormats/elf/ArcVSD.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename, extname } from "node:path";

const SIGNATURE = Buffer.from("VSD1", "ascii");
const HEADER_SIZE = 8;

export const vsdDescriptor: FormatDescriptor = {
	id: "silky-vsd",
	name: "AI5WIN engine video file",
	extensions: ["vsd"],
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
			source: "ArcFormats/elf/ArcVSD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<bigint | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const skip = BigInt(header.readUInt32LE(4));
	const offset = BigInt(HEADER_SIZE) + skip;
	if (offset >= source.size) return undefined;
	return offset;
}

async function readVsd(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const offset = await parseHeader(source);
	if (offset === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid AI5WIN VSD layout");
	}
	const name = `${basename(sourcePath, extname(sourcePath))}.mpg`;
	return {
		entries: [
			createFixedEntry({
				id: 0,
				path: name,
				offset,
				size: source.size - offset,
			}),
		],
		metadata: { streamOffset: offset },
	};
}

export const vsdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vsdDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readVsd,
});
