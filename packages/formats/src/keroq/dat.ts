// Format reference: GARbro Legacy/KeroQ/ArcDAT.cs
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
import { readCompanionFile } from "../shared/companion.js";
import { basename, extname } from "node:path";

const SIGNATURE = Buffer.from([0x89, 0x50, 0x41, 0x43]);
const HEADER_SIGNATURE = Buffer.from([0x89, 0x48, 0x44, 0x52]);
const COUNT_OFFSET = 4;
const HDR_COUNT_OFFSET = 4;
const NAME_SIZE = 0x10;
const HEADER_SIZE = 8;

export const keroqDatDescriptor: FormatDescriptor = {
	id: "keroq-dat",
	name: "KeroQ resource archive",
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
			source: "Legacy/KeroQ/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const baseName = basename(sourcePath, extname(sourcePath));
	if (!/^\d+$/.test(baseName)) return undefined;
	const previous = Number(baseName) - 1;
	if (!Number.isSafeInteger(previous) || previous < 0) return undefined;
	const companionName = `${String(previous).padStart(3, "0")}.dat`;
	const index = await readCompanionFile(sourcePath, companionName);
	if (!index || index.length < HEADER_SIZE) return undefined;
	if (!index.subarray(0, HEADER_SIZE).subarray(0, 4).equals(HEADER_SIGNATURE))
		return undefined;
	if (index.readInt32LE(HDR_COUNT_OFFSET) !== count) return undefined;
	const entries: FixedEntry[] = [];
	let position = HEADER_SIZE;
	for (let id = 0; id < count; id += 1) {
		const field = index.subarray(position, position + NAME_SIZE);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		position += terminator === -1 ? NAME_SIZE : terminator + 1;
		if (name.length === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "KeroQ entry has an empty name");
		}
		if (position + 8 > index.length) {
			throw new GarbroError("INVALID_ARCHIVE", "KeroQ index is truncated");
		}
		const size = BigInt(index.readUInt32LE(position));
		const offset = BigInt(index.readUInt32LE(position + 4));
		position += 8;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`KeroQ entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return entries;
}

export const keroqDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: keroqDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIndex(source, sourcePath);
		if (!entries) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KeroQ DAT layout");
		}
		return { entries, metadata: { entryCount: entries.length } };
	},
});
