// Format reference: GARbro ArcFormats/Liar/ArcLWG.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = 0x0001474c;
const HEIGHT_OFFSET = 4;
const WIDTH_OFFSET = 8;
const COUNT_OFFSET = 12;
const DIR_SIZE_OFFSET = 20;
const DIR_OFFSET = 24;
const NAME_LENGTH_OFFSET = 17;
const NAME_OFFSET = 18;
const MINIMUM_RECORD_SIZE = 18;

export const lwgDescriptor: FormatDescriptor = {
	id: "liar-lwg",
	name: "Liar multi-frame image",
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
			source: "ArcFormats/Liar/ArcLWG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface LwgHeader {
	count: number;
	height: number;
	width: number;
	dirOffset: number;
	dirSize: number;
	dataOffset: number;
	dataSize: number;
}

async function parseHeader(source: ByteSource): Promise<LwgHeader | undefined> {
	if (source.size < BigInt(DIR_OFFSET)) return undefined;
	const header = await source.readAt(0n, DIR_OFFSET);
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const dirSize = header.readUInt32LE(DIR_SIZE_OFFSET);
	const dirOffset = DIR_OFFSET;
	const dataOffset = dirOffset + dirSize;
	if (BigInt(dataOffset + 4) > source.size) return undefined;
	const dataSize = (await source.readAt(BigInt(dataOffset), 4)).readUInt32LE(0);
	if (BigInt(dataOffset + 4 + dataSize) > source.size) return undefined;
	return {
		count,
		height: header.readUInt32LE(HEIGHT_OFFSET),
		width: header.readUInt32LE(WIDTH_OFFSET),
		dirOffset,
		dirSize,
		dataOffset: dataOffset + 4,
		dataSize,
	};
}

async function readLwg(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Liar LWG layout");
	}
	const dir = await source.readAt(BigInt(header.dirOffset), header.dirSize);
	const entries: FixedEntry[] = [];
	let position = 0;
	for (let id = 0; id < header.count; id += 1) {
		if (position + MINIMUM_RECORD_SIZE > dir.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Liar LWG directory is truncated",
			);
		}
		const posX = dir.readInt32LE(position);
		const posY = dir.readInt32LE(position + 4);
		const bpp = dir[position + 8] ?? 0;
		const offset =
			BigInt(header.dataOffset) + BigInt(dir.readUInt32LE(position + 9));
		const size = BigInt(dir.readUInt32LE(position + 13));
		const nameLength = dir[position + NAME_LENGTH_OFFSET] ?? 0;
		if (position + NAME_OFFSET + nameLength > dir.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Liar LWG name is truncated");
		}
		const name = decodeCp932(
			dir.subarray(position + NAME_OFFSET, position + NAME_OFFSET + nameLength),
		);
		position += NAME_OFFSET + nameLength;
		if (size === 0n) continue;
		const dataEnd = BigInt(header.dataOffset + header.dataSize);
		if (offset + size > dataEnd || !checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Liar LWG entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(
					name.length > 0 ? `${name}.wcg` : String(entries.length),
				),
				offset,
				size,
				metadata: { type: "image", posX, posY, bpp },
			}),
		);
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Liar LWG archive is empty");
	}
	return {
		entries,
		metadata: {
			frameCount: entries.length,
			width: header.width,
			height: header.height,
		},
	};
}

export const lwgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: lwgDescriptor,
	detection: { signatures: [{ bytes: Buffer.from([0x4c, 0x47, 0x01, 0x00]) }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readLwg,
});
