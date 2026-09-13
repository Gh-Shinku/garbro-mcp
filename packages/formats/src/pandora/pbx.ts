// Format reference: GARbro ArcFormats/Pandora/ArcPBX.cs, classes `PbxOpener` and `PandoraCompression`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("Pandora.box\0", "latin1");
/** The index opens with this offset, and every record is sixteen bytes long. */
const INDEX_START = 0x10;
const RECORD_SIZE = 0x10;
const NAME_SIZE = 0xc;
/** The first record's payload offset stands in the header. */
const OFFSET_FIELD = 0xc;
/** A packed payload opens with a magic, a skipped word and the unpacked size. */
const PACKED_SIGNATURE = 0x6344764d; // 'MvDc'
const PACKED_HEADER_SIZE = 0x10;
const UNPACKED_SIZE_FIELD = 8;

/**
 * GARBro `PandoraCompression.Unpack`. The stream opens with a literal byte and then alternates between literal
 * runs and overlapping copies. The branch for a control byte of at least 0x60 reads a big-endian word and then
 * reads a byte anyway, which is reproduced here because it still consumes input.
 */
export function unpackPandora(
	input: Buffer,
	length: number,
): Buffer | undefined {
	if (length <= 0) return undefined;
	const output = Buffer.alloc(length);
	let source = 0;
	let target = 0;
	const next = (): number | undefined =>
		source < input.length ? input[source++] : undefined;

	const first = next();
	if (first === undefined) return undefined;
	output[target++] = first;
	while (target < length) {
		const control = next();
		if (control === undefined) return undefined;
		if (control >= 0x80) {
			if (control >= 0xc0) {
				const low = next();
				if (low === undefined) return undefined;
				const distance = low + 0x101 + ((control & 0x3f) << 8);
				const from = target - distance;
				if (from < 0 || target + 3 > length) return undefined;
				output[target++] = output[from] ?? 0;
				output[target++] = output[from + 1] ?? 0;
				output[target++] = output[from + 2] ?? 0;
			} else {
				let count: number;
				let wide: number;
				if (control >= 0xb0) {
					const high = next();
					const low = next();
					if (high === undefined || low === undefined) return undefined;
					count = ((high << 8) | low) + 0x813 + ((control & 7) << 16);
					wide = control & 8;
				} else if (control >= 0xa0) {
					const value = next();
					if (value === undefined) return undefined;
					count = value + ((control & 7) << 8) + 19;
					wide = control & 8;
				} else {
					count = (control & 0xf) + 3;
					wide = control & 0x10;
				}
				let distance: number;
				if (wide !== 0) {
					const high = next();
					const low = next();
					if (high === undefined || low === undefined) return undefined;
					distance = ((high << 8) | low) + 0x101;
				} else {
					const value = next();
					if (value === undefined) return undefined;
					distance = value + 1;
				}
				const from = target - distance;
				if (from < 0 || target + count > length) return undefined;
				for (let i = 0; i < count; i += 1)
					output[target++] = output[from + i] ?? 0;
			}
		} else {
			let count: number;
			if (control >= 0x60) {
				// The reference reads and discards a big-endian word here before the run length.
				const high = next();
				const low = next();
				if (high === undefined || low === undefined) return undefined;
			}
			if (control >= 0x40) {
				const value = next();
				if (value === undefined) return undefined;
				count = value + ((control & 0x1f) << 8) + 0x41;
			} else count = control + 1;
			const taken = Math.min(count, length - target, input.length - source);
			input.copy(output, target, source, source + taken);
			source += taken;
			target += taken;
			if (target < length && taken < count) return undefined;
		}
	}
	return output;
}

/** Reports the unpacked size of a packed payload, or declines payloads that are stored as they are. */
async function readPackedSize(
	source: ByteSource,
	offset: bigint,
	storedSize: bigint,
): Promise<bigint | undefined> {
	if (storedSize <= BigInt(PACKED_HEADER_SIZE)) return undefined;
	const header = await source.readAt(offset, PACKED_HEADER_SIZE);
	if (header.readUInt32LE(0) !== PACKED_SIGNATURE) return undefined;
	const unpackedSize = header.readInt32LE(UNPACKED_SIZE_FIELD);
	if (unpackedSize <= 0) return undefined;
	return BigInt(unpackedSize);
}

/**
 * GARBro `PbxOpener.TryOpen`. The index chains payload offsets: every record holds the offset of the next
 * payload, and the size of a payload is the difference to its successor.
 */
async function readPandoraBox(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START + RECORD_SIZE)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	let nextOffset = BigInt(header.readUInt32LE(OFFSET_FIELD));
	if (nextOffset < BigInt(INDEX_START) || nextOffset > source.size)
		return undefined;
	const count = Number(
		(nextOffset - BigInt(INDEX_START)) / BigInt(RECORD_SIZE),
	);
	const index = await source.readAt(BigInt(INDEX_START), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const cursor = i * RECORD_SIZE;
		const name = decodeCStringField(index, cursor, NAME_SIZE);
		const offset = nextOffset;
		const recordNext = BigInt(index.readUInt32LE(cursor + NAME_SIZE));
		const storedSize = (recordNext - offset) & 0xffffffffn;
		nextOffset = recordNext;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const unpackedSize = await readPackedSize(source, offset, storedSize);
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: name,
				offset,
				size: unpackedSize ?? storedSize,
				packedSize: storedSize,
				...(unpackedSize === undefined ? {} : { compressed: true }),
			}),
		);
	}
	return entries;
}

/**
 * GARBro `PbxOpener.OpenEntry`: a payload that opens with the packing magic is unpacked, and any failure falls
 * back to the stored bytes.
 */
async function openPandoraBoxEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const header = await source.readAt(entry.offset, PACKED_HEADER_SIZE);
	const unpackedSize = header.readInt32LE(UNPACKED_SIZE_FIELD);
	const data = Buffer.from(
		await source.readAt(
			entry.offset + BigInt(PACKED_HEADER_SIZE),
			Number(entry.packedSize) - PACKED_HEADER_SIZE,
		),
	);
	const decoded = unpackPandora(data, unpackedSize);
	if (!decoded) return source.createReadStream(entry.offset, entry.packedSize);
	return Readable.from([decoded]);
}

export const pandoraPbxDescriptor: FormatDescriptor = {
	id: "pandora-pbx",
	name: "Pandora.box resource archive",
	extensions: ["pbx"],
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
			source: "ArcFormats/Pandora/ArcPBX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pandoraPbxFormat = defineFixedArchive({
	descriptor: pandoraPbxDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readPandoraBox(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entries = await readPandoraBox(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pandora.box layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openPandoraBoxEntry,
});
