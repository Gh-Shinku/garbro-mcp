// Format reference: GARbro Legacy/Tigerman/ArcCHR.cs
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
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename, extname } from "node:path";

const SIGNATURE = 0x000001b1;
const ZT_TAG = Buffer.from("ZT", "ascii");
const FIRST_RECORD_OFFSET = 12;
const RECORD_SIZE = 0x24;

export const chrDescriptor: FormatDescriptor = {
	id: "tigerman-chr",
	name: "Tigerman Project compound image",
	extensions: ["chr", "cls", "ev"],
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
			source: "Legacy/Tigerman/ArcCHR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface ChrHeader {
	baseOffset: number;
	firstSize: bigint;
}

async function parseHeader(source: ByteSource): Promise<ChrHeader | undefined> {
	if (source.size < 8n) return undefined;
	const header = await source.readAt(0n, 8);
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	const baseOffset = SIGNATURE;
	if (BigInt(baseOffset) >= source.size) return undefined;
	const tag = await source.readAt(BigInt(baseOffset), ZT_TAG.length);
	if (!tag.equals(ZT_TAG)) return undefined;
	return { baseOffset, firstSize: BigInt(header.readUInt32LE(4)) };
}

async function readChr(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Tigerman CHR layout");
	}
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	const firstOffset = BigInt(header.baseOffset);
	if (!checkPlacement(firstOffset, header.firstSize, source.size)) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Tigerman CHR first frame points outside the archive",
		);
	}
	entries.push(
		createFixedEntry({
			id: 0,
			path: `${baseName}#0.ZIT`,
			offset: firstOffset,
			size: header.firstSize,
			metadata: { type: "image" },
		}),
	);
	for (
		let position = BigInt(FIRST_RECORD_OFFSET);
		position + BigInt(RECORD_SIZE) <= firstOffset;
		position += BigInt(RECORD_SIZE)
	) {
		const record = await source.readAt(position, RECORD_SIZE);
		const offset = BigInt(record.readUInt32LE(0));
		if (offset === 0n) continue;
		const size = BigInt(record.readUInt32LE(4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Tigerman CHR frame points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: `${baseName}#${entries.length}.ZIT`,
				offset,
				size,
				metadata: { type: "image" },
			}),
		);
	}
	return { entries, metadata: { frameCount: entries.length } };
}

export const chrFormat: ArchiveFormat = defineFixedArchive({
	descriptor: chrDescriptor,
	detection: { signatures: [{ bytes: Buffer.from([0xb1, 0x01, 0x00, 0x00]) }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readChr,
});
