// Format reference: GARbro "ArcFormats/FlyingShine/ArcPD.cs", class `Pd3Opener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The index starts behind the header and holds fixed size records. */
const INDEX_OFFSET = 0x18;
const RECORD_SIZE = 0x11c;
/** Name, size and relative offset inside a record. */
const NAME_SIZE = 0x104;
const SIZE_OFFSET = 0x108;
const OFFSET_OFFSET = 0x10c;
const COUNT_OFFSET = 0;
const ENTRY_COUNT_OFFSET = 4;
const TOTAL_SIZE_OFFSET = 0xc;
const HEADER_SIZE = INDEX_OFFSET;
/** Scripts are stored with every byte rotated right by four bits. */
const SCRIPT_EXTENSIONS = [".def", ".dsf"];
const ROTATE_BITS = 4;

interface Pd3Entry {
	path: string;
	offset: bigint;
	size: bigint;
	script: boolean;
}

function isScript(name: string): boolean {
	const lower = name.toLowerCase();
	return SCRIPT_EXTENSIONS.some((extension) => lower.endsWith(extension));
}

/** GARbro `Pd3Opener.TryOpen`: a fixed size index whose empty records carry a zero first byte. */
async function readPd3Index(
	source: ByteSource,
): Promise<Pd3Entry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	const indexCount = head.readInt32LE(COUNT_OFFSET);
	const count = head.readInt32LE(ENTRY_COUNT_OFFSET);
	const totalSize = head.readUInt32LE(TOTAL_SIZE_OFFSET);
	if (indexCount < count || !isSaneCount(indexCount) || !isSaneCount(count))
		return undefined;
	const indexSize = Math.imul(RECORD_SIZE, indexCount) >>> 0;
	// The index has to leave room for the payload area.
	if (BigInt(indexSize) >= source.size - BigInt(HEADER_SIZE)) return undefined;
	const baseOffset = BigInt(indexSize) + BigInt(HEADER_SIZE);
	if (baseOffset + BigInt(totalSize) !== source.size) return undefined;
	let index: Buffer;
	try {
		index = Buffer.from(await source.readAt(BigInt(INDEX_OFFSET), indexSize));
	} catch {
		return undefined;
	}
	const entries: Pd3Entry[] = [];
	for (let i = 0; i < indexCount; i += 1) {
		const position = i * RECORD_SIZE;
		// A zero first byte marks an empty slot.
		if ((index[position] ?? 0) === 0) continue;
		const name = decodeCStringField(index, position, NAME_SIZE);
		const size = BigInt(index.readUInt32LE(position + SIZE_OFFSET));
		const offset =
			baseOffset + BigInt(index.readUInt32LE(position + OFFSET_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({ path: name, offset, size, script: isScript(name) });
	}
	return entries.length > 0 ? entries : undefined;
}

export const flyingShinePd3Descriptor: FormatDescriptor = {
	id: "flying-shine-pd3",
	name: "Flying Shine resource archive version 3",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/FlyingShine/ArcPD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const flyingShinePd3Format: ArchiveFormat = defineFixedArchive({
	descriptor: flyingShinePd3Descriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPd3Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const parsed = await readPd3Index(source);
		if (!parsed)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Flying Shine PD3 layout",
			);
		const entries: FixedEntry[] = parsed.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				offset: entry.offset,
				size: entry.size,
				encrypted: entry.script,
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		// Scripts are stored with a four bit right rotation on every byte.
		if (entry.encrypted) {
			for (let index = 0; index < data.length; index += 1) {
				const value = data[index] ?? 0;
				data[index] =
					((value >> ROTATE_BITS) | (value << (8 - ROTATE_BITS))) & 0xff;
			}
		}
		return Readable.from([data]);
	},
});
