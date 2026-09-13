// Format reference: GARbro "ArcFormats/Origin/ArcDAT.cs", class `HedDatOpener` (the listing; the
// `OrgImageDecoder` is out of scope).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decodeCp932, GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The index lives in a sibling file with this extension. */
const INDEX_EXTENSION = "HED";
const DATA_EXTENSION = "dat";
/** Names are stored masked with a constant. */
const NAME_MASK = 0xff;
/** The type probe reads this many bytes of every payload. */
const TYPE_PROBE_SIZE = 0x11;
/** An audio payload hides its stream behind a small prefix. */
const OGG_PREFIX_SIZE = 0xd;
const OGG_MARKER = Buffer.from("OggS", "latin1");
const OGG_MARKER_OFFSET = OGG_PREFIX_SIZE;
/** The mask archive names every entry after the data file. */
const MASK_FILE_NAME = "mask.dat";
/** Image payloads start with an alpha flag and a method byte. */
const IMAGE_METHOD_LIMIT = 3;

interface HedEntry {
	path: string;
	offset: bigint;
	size: bigint;
	type?: string;
	metadata?: Record<string, unknown>;
}

function baseNameOf(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

/** GARbro `HedDatOpener.TryOpen`: a masked name and offset table in the sibling `.hed` file. */
async function readHedLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<HedEntry[] | undefined> {
	const name = baseNameOf(sourcePath);
	if (!name.toLowerCase().endsWith(`.${DATA_EXTENSION}`)) return undefined;
	const base = name.replace(/\.[^.]*$/, "");
	const indexName = changeExtension(name, INDEX_EXTENSION);
	let index = await readCompanionFile(sourcePath, indexName);
	if (!index)
		index = await readCompanionFile(sourcePath, indexName.toLowerCase());
	if (!index) return undefined;
	const entries: HedEntry[] = [];
	let position = 0;
	while (position < index.length) {
		const nameLength = index[position] ?? 0;
		position += 1;
		let entryName: string;
		if (nameLength !== 0) {
			if (position + nameLength > index.length) return undefined;
			const field = Buffer.from(
				index.subarray(position, position + nameLength),
			);
			position += nameLength;
			for (let i = 0; i < field.length; i += 1)
				field[i] = (field[i] ?? 0) ^ NAME_MASK;
			let length = 0;
			while (length < field.length && (field[length] ?? 0) !== 0) length += 1;
			entryName = decodeCp932(field.subarray(0, length));
		} else {
			entryName = `${base}#${String(entries.length).padStart(4, "0")}`;
		}
		if (position + 4 > index.length) return undefined;
		const offset = BigInt(index.readUInt32LE(position));
		position += 4;
		if (offset > source.size) return undefined;
		entries.push({ path: entryName, offset, size: 0n });
	}
	if (entries.length === 0) return undefined;
	// Every size is the distance to the next payload, the last one the rest of the file.
	for (let i = 0; i < entries.length - 1; i += 1) {
		const current = entries[i];
		const next = entries[i + 1];
		if (!current || !next) return undefined;
		current.size = next.offset - current.offset;
	}
	const last = entries[entries.length - 1];
	if (last) last.size = source.size - last.offset;
	const isMask = name.toLowerCase() === MASK_FILE_NAME;
	for (const entry of entries) {
		if (!checkPlacement(entry.offset, entry.size, source.size))
			return undefined;
		if (entry.size < 1n) continue;
		const probeSize = Math.min(TYPE_PROBE_SIZE, Number(entry.size));
		const probe = Buffer.alloc(TYPE_PROBE_SIZE);
		Buffer.from(await source.readAt(entry.offset, probeSize)).copy(probe, 0);
		if (
			probe
				.subarray(OGG_MARKER_OFFSET, OGG_MARKER_OFFSET + 4)
				.equals(OGG_MARKER)
		) {
			// The audio stream starts behind its prefix.
			entry.offset += BigInt(OGG_PREFIX_SIZE);
			entry.size -= BigInt(OGG_PREFIX_SIZE);
			entry.type = "audio";
			continue;
		}
		const hasAlpha = probe[0] ?? 0;
		const method = probe[1] ?? 0;
		if (
			!isMask &&
			!(hasAlpha <= 1 && method > 0 && method <= IMAGE_METHOD_LIMIT)
		)
			continue;
		entry.type = "image";
		const headerSize = isMask ? 8 : 6;
		if (entry.size < BigInt(headerSize)) continue;
		const header = Buffer.from(await source.readAt(entry.offset, headerSize));
		entry.metadata = isMask
			? {
					width: header.readUInt32LE(0),
					height: header.readUInt32LE(4),
					bpp: 8,
					isMask: true,
				}
			: {
					hasAlpha: hasAlpha !== 0,
					method,
					width: header.readUInt16LE(2),
					height: header.readUInt16LE(4),
					bpp: 32,
				};
	}
	return entries;
}

export const originHedDatDescriptor: FormatDescriptor = {
	id: "origin-dat-hed",
	name: "origin engine resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/Origin/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const originHedDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: originHedDatDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readHedLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readHedLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid origin DAT/HED layout");
		const entries: FixedEntry[] = layout.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				offset: entry.offset,
				size: entry.size,
				encrypted: true,
				...(entry.type !== undefined || entry.metadata !== undefined
					? {
							metadata: {
								...(entry.type !== undefined ? { type: entry.type } : {}),
								...(entry.metadata ?? {}),
							} as Record<string, unknown>,
						}
					: {}),
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		// Image and audio payloads stay encoded: their decoders are out of scope.
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
