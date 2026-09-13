// Format reference: GARbro ArcFormats/FC01/ArcMCA.cs, class `McaOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename, extname } from "node:path";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("MCA ", "ascii");
const HEADER_SIZE = 0x24;
const INDEX_OFFSET_FIELD = 0x10;
const BITS_PER_PIXEL_FIELD = 0x14;
const COUNT_FIELD = 0x20;
/** An eight bit archive keeps a palette in front of its offset table. */
const PALETTE_BITS = 8;
const PALETTE_SIZE = 0x400;
/** Payloads that are not longer than this are dropped. */
const MIN_PAYLOAD_SIZE = 0x20;

/**
 * GARbro `McaOpener.TryOpen`. The header holds the offset table position, the bit depth and the frame
 * count; the table itself is a list of frame offsets and a frame ends where the next one begins. The last
 * frame reaches to the end of the file.
 */
async function readMcaIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	let tableOffset = header.readUInt32LE(INDEX_OFFSET_FIELD);
	if (BigInt(tableOffset) >= source.size) return undefined;
	if (header.readInt32LE(BITS_PER_PIXEL_FIELD) === PALETTE_BITS)
		tableOffset += PALETTE_SIZE;
	if (BigInt(tableOffset) + BigInt(count * 4) > source.size) return undefined;
	const table = Buffer.from(
		await source.readAt(BigInt(tableOffset), count * 4),
	);
	const base = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	for (let index = 0; index < count; index += 1) {
		const offset = BigInt(table.readUInt32LE(index * 4));
		// The reference compares the payload against its own position inside the table.
		const tablePosition = BigInt(tableOffset + index * 4);
		if (offset > source.size || offset <= tablePosition) return undefined;
		const next =
			index + 1 === count
				? source.size
				: BigInt(table.readUInt32LE((index + 1) * 4));
		const size = next - offset;
		if (size <= BigInt(MIN_PAYLOAD_SIZE)) continue;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: `${base}#${index.toString().padStart(4, "0")}`,
				offset,
				size,
				metadata: { type: "image" },
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const mcaDescriptor: FormatDescriptor = {
	id: "fc01-mca",
	name: "F&C Co. multi-frame image",
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
			source: "ArcFormats/FC01/ArcMCA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mcaFormat = defineFixedArchive({
	descriptor: mcaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readMcaIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readMcaIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid F&C MCA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	/** The reference only decodes frames as images, so a plain extraction hands back the stored frame. */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return source.createReadStream(entry.offset, entry.size);
	},
});
