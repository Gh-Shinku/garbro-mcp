// Format reference: GARbro Legacy/PlanTech/ArcPAC.cs
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

const BMP_TAG = Buffer.from("BM", "ascii");
const BMP_OFFSET = 8;
const HEADER_SIZE = 14;

export const plantechPacDescriptor: FormatDescriptor = {
	id: "plantech-pac",
	name: "PLANTECH engine bitmap package",
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
			source: "Legacy/PlanTech/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<boolean> {
	if (source.size < BigInt(HEADER_SIZE)) return false;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (header.readInt32LE(0) !== 0) return false;
	if (!header.subarray(BMP_OFFSET, BMP_OFFSET + BMP_TAG.length).equals(BMP_TAG))
		return false;
	// The first field at offset 4 mirrors the BMP size field at offset 10.
	return header.readUInt32LE(4) === header.readUInt32LE(10);
}

async function readPlantechPac(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await parseHeader(source))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid PLANTECH PAC layout");
	}
	const name = `${basename(sourcePath, extname(sourcePath))}.BMP`;
	return {
		entries: [
			createFixedEntry({
				id: 0,
				path: name,
				offset: BigInt(BMP_OFFSET),
				size: source.size - BigInt(BMP_OFFSET),
			}),
		],
		metadata: { entryCount: 1 },
	};
}

export const plantechPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: plantechPacDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return parseHeader(source);
	},
	read: readPlantechPac,
});
