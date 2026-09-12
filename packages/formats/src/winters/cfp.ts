// Format reference: GARbro ArcFormats/Winters/ArcCFP.cs
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("CAPYBARA DAT 002", "ascii");
const NAMES_OFFSET_OFFSET = 0x14;
const NAMES_LENGTH_OFFSET = 0x18;
const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x0c;

export const cfpDescriptor: FormatDescriptor = {
	id: "winters-cfp",
	name: "Winters resource archive",
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
			source: "ArcFormats/Winters/ArcCFP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface CfpHeader {
	namesOffset: bigint;
	namesLength: number;
}

async function parseHeader(source: ByteSource): Promise<CfpHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const namesOffset = BigInt(header.readUInt32LE(NAMES_OFFSET_OFFSET));
	const namesLength = header.readUInt32LE(NAMES_LENGTH_OFFSET);
	if (namesOffset <= BigInt(INDEX_OFFSET) || namesOffset >= source.size)
		return undefined;
	if (BigInt(NAMES_OFFSET_OFFSET + 4) + BigInt(namesLength) > source.size)
		return undefined;
	return { namesOffset, namesLength };
}

async function readCfp(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Invalid CAPYBARA DAT 002 signature",
		);
	}
	const { namesOffset, namesLength } = header;
	const names = decodeCp932(
		await source.readAt(namesOffset, namesLength),
	).split(/\r?\n/);
	const entries: FixedEntry[] = [];
	let nameIndex = 0;
	for (
		let position = BigInt(INDEX_OFFSET);
		position + BigInt(RECORD_SIZE) <= namesOffset;
		position += BigInt(RECORD_SIZE)
	) {
		const name = names[nameIndex] ?? "";
		nameIndex += 1;
		if (name.length === 0) continue;
		const record = await source.readAt(position, RECORD_SIZE);
		const offset = BigInt(record.readUInt32LE(0));
		const size = BigInt(record.readUInt32LE(4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`CAPYBARA CFP entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "CAPYBARA CFP archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const cfpFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cfpDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readCfp,
});
