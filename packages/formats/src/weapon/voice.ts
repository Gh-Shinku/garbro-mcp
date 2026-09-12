// Format reference: GARbro Legacy/Weapon/ArcVoice.cs
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

const INDEX_OFFSET = 4;

export const weaponVoiceDescriptor: FormatDescriptor = {
	id: "weapon-voice",
	name: "Weapon audio archive",
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
			source: "Legacy/Weapon/ArcVoice.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface VoiceHeader {
	count: number;
	indexSize: number;
}

async function parseHeader(
	source: ByteSource,
): Promise<VoiceHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * 4 + 8;
	if (BigInt(indexSize) > source.size) return undefined;
	const tail = (await source.readAt(BigInt(indexSize - 4), 4)).readUInt32LE(0);
	if (BigInt(tail) !== source.size) return undefined;
	const firstOffset = (
		await source.readAt(BigInt(INDEX_OFFSET), 4)
	).readUInt32LE(0);
	if (BigInt(firstOffset) < BigInt(indexSize)) return undefined;
	return { count, indexSize };
}

async function readWeaponVoice(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Weapon voice layout");
	}
	const { count, indexSize } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), (count + 1) * 4);
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(index.readUInt32LE(id * 4));
		const nextOffset = BigInt(index.readUInt32LE((id + 1) * 4));
		const size = nextOffset - offset;
		if (
			offset < BigInt(indexSize) ||
			!checkPlacement(offset, size, source.size)
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Weapon voice entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${baseName}#${String(id).padStart(4, "0")}.wav`,
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const weaponVoiceFormat: ArchiveFormat = defineFixedArchive({
	descriptor: weaponVoiceDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readWeaponVoice,
});
