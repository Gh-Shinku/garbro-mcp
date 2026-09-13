// Format reference: GARbro "ArcFormats/Kid/ArcDAT.cs", class `LnkOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
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
import { decryptCps, readCpsHeader, unpackLnd } from "./lnd.js";

const LNK_SIGNATURE = Buffer.from([0x4c, 0x4e, 0x4b]);
const INDEX_START = 0x10;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x18;
const LND_SIGNATURE = 0x00646e6c; // 'lnd'
const CPS_SIGNATURE = 0x00535043; // 'CPS'
// The reference skips the signature, the unpacked size field and one more word.
const LND_STREAM_START = 16;
const CPS_MARKER_SIZE = 4;

interface LnkEntry {
	name: string;
	offset: bigint;
	storedSize: number;
	packed: boolean;
}

async function readLnkEntries(
	source: ByteSource,
): Promise<LnkEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START + 4)) return undefined;
	const count = (await source.readAt(4n, 4)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(INDEX_START + count * RECORD_SIZE);
	if (dataOffset > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_START), count * RECORD_SIZE);
	const entries: LnkEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const base = id * RECORD_SIZE;
		const name = decodeCStringField(index, base + 8, NAME_SIZE);
		if (name.trim().length === 0) return undefined;
		const offset = dataOffset + BigInt(index.readUInt32LE(base));
		const size = index.readUInt32LE(base + 4);
		const storedSize = size >>> 1;
		if (!checkPlacement(offset, BigInt(storedSize), source.size))
			return undefined;
		entries.push({ name, offset, storedSize, packed: (size & 1) !== 0 });
	}
	return entries;
}

/** Checks whether a stored entry holds a Cps stream, whose unpacked size is not known up front. */
async function hasCpsMarker(
	source: ByteSource,
	entry: LnkEntry,
): Promise<boolean> {
	if (!checkPlacement(entry.offset, BigInt(CPS_MARKER_SIZE), source.size))
		return false;
	const marker = await source.readAt(entry.offset, CPS_MARKER_SIZE);
	return marker.readUInt32LE(0) === CPS_SIGNATURE;
}

/** Applies the `Lnd` and `Cps` layers of `LnkOpener.OpenEntry` to a stored entry. */
export function decodeLnkPayload(stored: Buffer, packed: boolean): Buffer {
	let data = stored;
	if (
		packed &&
		stored.length >= LND_STREAM_START &&
		stored.readUInt32LE(0) === LND_SIGNATURE
	) {
		data = unpackLnd(stored, LND_STREAM_START, stored.readUInt32LE(8));
	}
	if (data.length < CPS_MARKER_SIZE || data.readUInt32LE(0) !== CPS_SIGNATURE)
		return data;
	const header = readCpsHeader(data);
	if (!header)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated KID CPS stream");
	if ((header.compression & 2) !== 0 && (header.compression & 1) === 0)
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"KID Lnd16 compression is not supported",
		);
	const body = decryptCps(
		data,
		header.keyOffset + CPS_MARKER_SIZE + 0x10,
		header,
	);
	const output = Buffer.alloc(header.unpackedSize);
	if ((header.compression & 1) !== 0) {
		return unpackLnd(body, CPS_MARKER_SIZE, header.unpackedSize);
	}
	body.copy(output, 0, CPS_MARKER_SIZE, CPS_MARKER_SIZE + header.unpackedSize);
	return output;
}

export const kidLnkDescriptor: FormatDescriptor = {
	id: "kid-lnk",
	name: "KID resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/Kid/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kidLnkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kidLnkDescriptor,
	detection: { signatures: [{ bytes: LNK_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLnkEntries(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readLnkEntries(source);
		if (!entries) throw new GarbroError("INVALID_ARCHIVE", "Invalid KID index");
		const fixed: FixedEntry[] = [];
		for (const [id, entry] of entries.entries()) {
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.storedSize),
				packedSize: BigInt(entry.storedSize),
				compressed: entry.packed,
			});
			// Packed entries declare their size in the payload, and Cps payloads unpack to another size.
			const nested = !entry.packed && (await hasCpsMarker(source, entry));
			fixed.push(
				entry.packed || nested ? { ...created, sizeKnown: false } : created,
			);
		}
		return {
			entries: fixed,
			metadata: { entryCount: fixed.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		return Readable.from([decodeLnkPayload(stored, entry.compressed === true)]);
	},
});
