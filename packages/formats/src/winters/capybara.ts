// Format reference: GARbro ArcFormats/Winters/ArcDAT.cs
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

const SIGNATURE = Buffer.from("CAPYBARA DAT 001", "ascii");
const NAMES_OFFSET_OFFSET = 0x10;
const NAMES_LENGTH_OFFSET = 0x14;
const INDEX_OFFSET = 0x18;
const RECORD_SIZE = 8;
const TERMINATOR = ":END";

export const capybaraDatDescriptor: FormatDescriptor = {
	id: "winters-capybara",
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
			source: "ArcFormats/Winters/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface CapybaraHeader {
	namesOffset: bigint;
	namesLength: number;
}

async function parseHeader(
	source: ByteSource,
): Promise<CapybaraHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const namesOffset = BigInt(header.readUInt32LE(NAMES_OFFSET_OFFSET));
	const namesLength = header.readUInt32LE(NAMES_LENGTH_OFFSET);
	if (namesOffset <= BigInt(INDEX_OFFSET) || namesOffset >= source.size)
		return undefined;
	if (BigInt(NAMES_OFFSET_OFFSET) + BigInt(namesLength) > source.size)
		return undefined;
	return { namesOffset, namesLength };
}

async function readCapybaraDat(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid CAPYBARA DAT signature");
	}
	const { namesOffset, namesLength } = header;
	const namesText = decodeCp932(await source.readAt(namesOffset, namesLength));
	const names = namesText.split(/\r?\n/);
	let nameIndex = 0;
	const entries: FixedEntry[] = [];
	for (
		let position = BigInt(INDEX_OFFSET);
		position + BigInt(RECORD_SIZE) <= namesOffset;
		position += BigInt(RECORD_SIZE)
	) {
		const name = names[nameIndex] ?? "";
		nameIndex += 1;
		if (name === TERMINATOR) break;
		if (name.length === 0) continue;
		if (name.trim().length === 0) break;
		const record = await source.readAt(position, RECORD_SIZE);
		const offset = BigInt(record.readUInt32LE(0));
		const size = BigInt(record.readUInt32LE(4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`CAPYBARA DAT entry points outside the archive: ${name}`,
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
		throw new GarbroError("INVALID_ARCHIVE", "CAPYBARA DAT archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const capybaraDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: capybaraDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readCapybaraDat,
});
