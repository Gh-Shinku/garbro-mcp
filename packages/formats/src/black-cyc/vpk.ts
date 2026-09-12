// Format reference: GARbro ArcFormats/BlackCyc/ArcVPK.cs
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";

const NAME_SIZE = 8;
const RECORD_SIZE = 0x0c;
const OFFSET_OFFSET = 8;

export const vpkDescriptor: FormatDescriptor = {
	id: "black-cyc-vpk",
	name: "Black Cyc engine audio archive",
	extensions: ["vpk"],
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
			source: "ArcFormats/BlackCyc/ArcVPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== "vpk") return undefined;
	const index = await readCompanionFile(
		sourcePath,
		changeExtension(sourcePath, "vtb"),
	);
	if (!index || index.length < RECORD_SIZE) return undefined;
	if (index.length % RECORD_SIZE !== 0) return undefined;
	const count = index.length / RECORD_SIZE - 1;
	if (!isSaneCount(count)) return undefined;
	const entries: FixedEntry[] = [];
	let nextOffset = BigInt(index.readUInt32LE(OFFSET_OFFSET));
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const field = index.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = field.indexOf(0);
		const name = `${decodeCp932(terminator === -1 ? field : field.subarray(0, terminator))}.vaw`;
		const offset = nextOffset;
		nextOffset = BigInt(
			index.readUInt32LE(recordOffset + RECORD_SIZE + OFFSET_OFFSET),
		);
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Black Cyc VPK entry points outside the archive: ${name}`,
			);
		}
		entries.push(createFixedEntry({ id, path: name, offset, size }));
	}
	return entries;
}

export const vpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vpkDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "vpk") return false;
		try {
			return (await readIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIndex(source, sourcePath);
		if (!entries) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Black Cyc VPK layout");
		}
		return { entries, metadata: { entryCount: entries.length } };
	},
});
