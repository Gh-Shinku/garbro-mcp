// Format references: GARbro ArcFormats/Maika/ArcMIK01.cs and ArcMK2.cs.
import { inflateLzssAll, inflateMaikaBpr } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MIK_SIGNATURE = Buffer.from("MIK01\x1a\0");
const USG_SIGNATURE = Buffer.from("USG01\x1a\0");
const SIGNATURES = [MIK_SIGNATURE, USG_SIGNATURE];
const HEADER_SIZE = 0x10;
const COUNT_OFFSET = 8;
const INDEX_OFFSET_FIELD = 0x0a;
const RECORD_SIZE = 0x10;
const NAME_SIZE = 0x0c;
const PACKED_HEADER_SIZE = 10;
const PACKED_SIGNATURES = new Set([0x3143, 0x3144, 0x3145, 0x3146]);
const E1_SIGNATURE = 0x3145;
const BPR01 = Buffer.from("BPR01");
const BPR02 = Buffer.from("BPR02");

interface ScrambleScheme {
	size: number;
	pairs: readonly (readonly [number, number])[];
}

const DEFAULT_SCHEME: ScrambleScheme = {
	size: 14,
	pairs: [
		[7, 11],
		[9, 12],
	],
};
const USG_SCHEME: ScrambleScheme = {
	size: 15,
	pairs: [
		[7, 13],
		[9, 14],
	],
};

interface MikEntry extends FixedEntry {
	metadata?: {
		compressionSignature?: number;
		innerPackedSize?: number;
		scrambleScheme?: "default" | "usg";
	};
}

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

function matchingSignature(header: Buffer): "default" | "usg" | undefined {
	if (header.subarray(0, MIK_SIGNATURE.length).equals(MIK_SIGNATURE))
		return "default";
	if (header.subarray(0, USG_SIGNATURE.length).equals(USG_SIGNATURE))
		return "usg";
	return undefined;
}

async function readIndex(source: ByteSource): Promise<MikEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const schemeName = matchingSignature(header);
	if (!schemeName) return undefined;
	const scheme = schemeName === "usg" ? USG_SCHEME : DEFAULT_SCHEME;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	const indexSize = count * RECORD_SIZE;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const index = await source.readAt(indexOffset, indexSize);
	const entries: MikEntry[] = [];
	let offset = BigInt(HEADER_SIZE);
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const storedSize = BigInt(index.readUInt32LE(record + NAME_SIZE));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		let compressionSignature: number | undefined;
		let innerPackedSize: number | undefined;
		if (storedSize >= BigInt(PACKED_HEADER_SIZE + scheme.size)) {
			const packedHeader = await source.readAt(offset, 6);
			const signature = packedHeader.readUInt16LE(0);
			const candidateSize = packedHeader.readUInt32LE(2);
			if (
				PACKED_SIGNATURES.has(signature) &&
				BigInt(candidateSize) <= storedSize - BigInt(PACKED_HEADER_SIZE) &&
				candidateSize >= scheme.size
			) {
				compressionSignature = signature;
				innerPackedSize = candidateSize;
			}
		}
		const compressed = compressionSignature !== undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: storedSize,
			compressed,
			...(compressed
				? {
						metadata: {
							compressionSignature,
							innerPackedSize,
							scrambleScheme: schemeName,
						},
					}
				: {}),
		}) as MikEntry;
		if (compressed) entry.sizeKnown = false;
		entries.push(entry);
		offset += storedSize;
	}
	return entries;
}

function restorePrefix(input: Buffer, scheme: ScrambleScheme): void {
	for (const [left, right] of scheme.pairs) {
		const value = input[left] ?? 0;
		input[left] = input[right] ?? 0;
		input[right] = value;
	}
}

async function openEntry(
	source: ByteSource,
	entry: MikEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const innerPackedSize = entry.metadata?.innerPackedSize;
	const compressionSignature = entry.metadata?.compressionSignature;
	if (innerPackedSize === undefined || compressionSignature === undefined)
		return source.createReadStream(entry.offset, entry.packedSize);
	const input = Buffer.from(
		await source.readAt(
			entry.offset + BigInt(PACKED_HEADER_SIZE),
			bigintToBufferLength(BigInt(innerPackedSize), "MAIKA packed entry"),
		),
	);
	if (compressionSignature === E1_SIGNATURE) {
		const scheme =
			entry.metadata?.scrambleScheme === "usg" ? USG_SCHEME : DEFAULT_SCHEME;
		restorePrefix(input, scheme);
	}
	const unpacked = inflateLzssAll(input);
	if (unpacked.subarray(0, BPR02.length).equals(BPR02))
		return Readable.from([inflateMaikaBpr(unpacked.subarray(BPR02.length), 3)]);
	if (unpacked.subarray(0, BPR01.length).equals(BPR01))
		return Readable.from([inflateMaikaBpr(unpacked.subarray(BPR01.length), 1)]);
	return Readable.from([unpacked]);
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
	openEntry,
});
