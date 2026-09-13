// Format reference: GARbro "ArcFormats/FlyingShine/ArcPD.cs", class `PdOpener` (the `PD` tag; archive
// creation is out of scope).
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

/** The archive starts with the little endian spelling of `Pack`. */
const SIGNATURE = Buffer.from("Pack", "latin1");
/** Two variant words follow the signature: `Only` (plain) and `Plus` (every byte is masked). */
const ONLY_VERSION = 0x796c6e4f;
const PLUS_VERSION = 0x73756c50;
const VERSION_OFFSET = 4;
const COUNT_OFFSET = 0x40;
const RECORD_OFFSET = 0x48;
const RECORD_SIZE = 0x90;
const NAME_SIZE = 0x80;
const OFFSET_OFFSET = 0x80;
const SIZE_OFFSET = 0x88;
/** `Plus` archives mask every payload byte. */
const MASK = 0xff;

interface PdEntry {
	path: string;
	offset: bigint;
	size: bigint;
	script: boolean;
}

/** GARbro `PdOpener.TryOpen`: a `Pack` header, a variant word and fixed size records. */
async function readPdIndex(source: ByteSource): Promise<PdEntry[] | undefined> {
	if (source.size < BigInt(RECORD_OFFSET)) return undefined;
	const head = Buffer.from(await source.readAt(0n, RECORD_OFFSET));
	if (!head.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const version = head.readUInt32LE(VERSION_OFFSET);
	if (version !== ONLY_VERSION && version !== PLUS_VERSION) return undefined;
	const count = head.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count) || count * RECORD_SIZE >= Number(source.size))
		return undefined;
	const indexSize = count * RECORD_SIZE;
	let index: Buffer;
	try {
		index = Buffer.from(await source.readAt(BigInt(RECORD_OFFSET), indexSize));
	} catch {
		return undefined;
	}
	const entries: PdEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const position = i * RECORD_SIZE;
		const name = decodeCStringField(index, position, NAME_SIZE);
		const offset = index.readBigInt64LE(position + OFFSET_OFFSET);
		const size = BigInt(index.readUInt32LE(position + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({
			path: name,
			offset,
			size,
			script: name.toLowerCase().endsWith(".dsf"),
		});
	}
	return entries.length > 0 ? entries : undefined;
}

export const flyingShinePdDescriptor: FormatDescriptor = {
	id: "flying-shine-pd",
	name: "Flying Shine resource archive",
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

export const flyingShinePdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: flyingShinePdDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPdIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const parsed = await readPdIndex(source);
		if (!parsed)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Flying Shine PD layout",
			);
		const head = Buffer.from(await source.readAt(0n, RECORD_OFFSET));
		// The `Plus` variant masks every payload byte on extraction.
		const masked = head.readUInt32LE(VERSION_OFFSET) === PLUS_VERSION;
		const entries: FixedEntry[] = parsed.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				offset: entry.offset,
				size: entry.size,
				encrypted: masked,
				...(entry.script
					? { metadata: { type: "script" } as Record<string, unknown> }
					: {}),
			}),
		);
		return { entries, metadata: { entryCount: entries.length, masked } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		if (entry.encrypted) {
			for (let index = 0; index < data.length; index += 1)
				data[index] = (data[index] ?? 0) ^ MASK;
		}
		return Readable.from([data]);
	},
});
