// Format reference: GARbro ArcFormats/Maika/ArcMIK01.cs, class `MikOpener`, which extends `Mk2Opener`
// from ArcMK2.cs for its payload handling.
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";
import {
	type Mk2Entry,
	openMk2Entry,
	probeCompression,
	schemeForArchiveId,
	schemeIdOf,
} from "./mk2-pack.js";

const MIK_SIGNATURE = Buffer.from("MIK01\x1a\0");
const USG_SIGNATURE = Buffer.from("USG01\x1a\0");
const SIGNATURES = [MIK_SIGNATURE, USG_SIGNATURE];
const HEADER_SIZE = 0x10;
const COUNT_OFFSET = 8;
const INDEX_OFFSET_FIELD = 0x0a;
const RECORD_SIZE = 0x10;
const NAME_SIZE = 0x0c;

export const maikaMik01Descriptor: FormatDescriptor = {
	id: "maika-mik01",
	name: "MAIKA resource archive",
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
			source: "ArcFormats/Maika/ArcMIK01.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Maika/ArcMK2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function matchesSignature(header: Buffer): boolean {
	return (
		header.subarray(0, MIK_SIGNATURE.length).equals(MIK_SIGNATURE) ||
		header.subarray(0, USG_SIGNATURE.length).equals(USG_SIGNATURE)
	);
}

async function readIndex(source: ByteSource): Promise<Mk2Entry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!matchesSignature(header)) return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	// The reference resolves the scramble scheme from the archive id, its first five bytes.
	const scheme = schemeForArchiveId(header.subarray(0, 5).toString("latin1"));
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	const indexSize = count * RECORD_SIZE;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const index = await source.readAt(indexOffset, indexSize);
	const entries: Mk2Entry[] = [];
	// Payloads follow the header in record order, which is how the reference derives their offsets.
	let offset = BigInt(HEADER_SIZE);
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const storedSize = BigInt(index.readUInt32LE(record + NAME_SIZE));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const probe = await probeCompression(source, offset, storedSize, scheme);
		const compressed = probe !== undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: storedSize,
			compressed,
			...(probe
				? {
						metadata: {
							compressionSignature: probe.signature,
							innerPackedSize: probe.innerPackedSize,
							scrambleScheme: schemeIdOf(scheme),
						},
					}
				: {}),
		}) as Mk2Entry;
		if (compressed) entry.sizeKnown = false;
		entries.push(entry);
		offset += storedSize;
	}
	return entries;
}

export const maikaMik01Format: ArchiveFormat = defineFixedArchive({
	descriptor: maikaMik01Descriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source) {
		return (await readIndex(source)) !== undefined;
	},
	async read(source) {
		const entries = await readIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MAIKA MIK01 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openMk2Entry,
});
