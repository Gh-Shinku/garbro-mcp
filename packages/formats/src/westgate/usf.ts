// Format reference: GARbro Legacy/WestGate/ArcUSF.cs (with UcaTool.ReadIndex from ArcUCA.cs)
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const FIRST_OFFSET_OFFSET = 0x0c;
const NAME_SIZE = 0x0c;
const RECORD_SIZE = 0x10;
const EXTENSIONS = new Set(["alh", "usf", "udc", "uwb", "arc"]);
const INVALID_NAME_CHARS = '<>:"/\\|?*';

/** Mirrors Path.GetInvalidFileNameChars: control characters plus the Windows-reserved set. */
function hasInvalidNameChar(name: string): boolean {
	for (const character of name) {
		const code = character.codePointAt(0) ?? 0;
		if (code < 0x20 || INVALID_NAME_CHARS.includes(character)) return true;
	}
	return false;
}

export const usfDescriptor: FormatDescriptor = {
	id: "westgate-usf",
	name: "West Gate resource archive",
	extensions: ["alh", "usf", "udc", "uwb", "arc"],
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
			source: "Legacy/WestGate/ArcUSF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "Legacy/WestGate/ArcUCA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface UsfHeader {
	count: number;
	indexSize: number;
}

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<UsfHeader | undefined> {
	if (sourcePath.length > 0 && !EXTENSIONS.has(sourceExtension(sourcePath)))
		return undefined;
	if (source.size < BigInt(FIRST_OFFSET_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, FIRST_OFFSET_OFFSET + 4);
	const firstOffset = BigInt(header.readUInt32LE(FIRST_OFFSET_OFFSET));
	if (firstOffset >= source.size || (firstOffset & 0xfn) !== 0n)
		return undefined;
	const count = Number(firstOffset / 0x10n);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(indexSize) !== firstOffset) return undefined;
	return { count, indexSize };
}

async function readUsf(
	source: ByteSource,
	sourcePath: string,
): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source, sourcePath);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid West Gate USF layout");
	}
	const { count, indexSize } = header;
	const index = await source.readAt(0n, indexSize);
	const records: { path: string; rawPath?: string; offset: bigint }[] = [];
	let nextOffset = BigInt(indexSize);
	let lastName: string | undefined;
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameField = index.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (
			name.length === 0 ||
			name.trim().length === 0 ||
			hasInvalidNameChar(name) ||
			name === lastName
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"West Gate USF entry name is invalid",
			);
		}
		lastName = name;
		const offset = nextOffset;
		nextOffset =
			id + 1 === count
				? source.size
				: BigInt(index.readUInt32LE(recordOffset + RECORD_SIZE + NAME_SIZE));
		if (nextOffset <= offset || nextOffset > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"West Gate USF offsets are not monotonic",
			);
		}
		records.push({ ...normalizeEntryPath(name), offset });
	}
	const entries: FixedEntry[] = records.map((record, id) => {
		const next = records[id + 1]?.offset ?? source.size;
		const size = next - record.offset;
		if (!checkPlacement(record.offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`West Gate USF entry points outside the archive: ${record.path}`,
			);
		}
		return createFixedEntry({
			id,
			path: record.path,
			...(record.rawPath === undefined ? {} : { rawPath: record.rawPath }),
			offset: record.offset,
			size,
		});
	});
	return { entries, metadata: { entryCount: count } };
}

export const usfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: usfDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await parseHeader(source, sourcePath)) !== undefined;
	},
	read: readUsf,
});
