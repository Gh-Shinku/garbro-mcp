// Format reference: GARbro "ArcFormats/Palette/ArcCHR.cs", class `ChrOpener`, and the PNG constants from
// "ArcFormats/Palette/ImagePGA.cs" (`PgaFormat`).
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { crc32 } from "@garbro-mcp/codecs";
import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `PngFormat.HeaderBytes`. */
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
/** `PgaFormat.PngFooter`: a trailing IEND chunk. */
const PNG_FOOTER = Buffer.from([
	0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const INDEX_OFFSET_FIELD = 4;
const FIRST_PAYLOAD_OFFSET = 8;
const CHAR_HEADER_SIZE = 8;
const COUNT_FIELD_SIZE = 4;

interface ChrEntry {
	name: string;
	offset: bigint;
	size: bigint;
	offsetX: number;
	offsetY: number;
	virtual: boolean;
}

function baseNameWithoutExtension(sourcePath: string): string {
	const name = sourcePath.split(/[\\/]/).pop() ?? "";
	const dot = name.lastIndexOf(".");
	return dot > 0 ? name.slice(0, dot) : name;
}

/**
 * Rebuilds the PNG stream of a character entry: the file only stores the PNG body behind its signature.
 * `ChrOpener.OpenEntry` also injects an `oFFs` chunk holding the frame offset behind the IHDR chunk.
 */
export function wrapPalettePng(
	body: Buffer,
	offsetX: number,
	offsetY: number,
	injectOffsets: boolean,
): Buffer {
	if (!injectOffsets) return Buffer.concat([PNG_SIGNATURE, body, PNG_FOOTER]);
	// The reference copies the leading chunk verbatim before writing the oFFs chunk.
	const chunkLength = body.length >= 4 ? body.readInt32BE(0) : -1;
	const headSize = chunkLength + 8;
	if (chunkLength < 0 || headSize > body.length)
		return Buffer.concat([PNG_SIGNATURE, body, PNG_FOOTER]);
	const chunk = Buffer.alloc(4 + 4 + 4 + 4 + 1 + 4);
	chunk.writeUInt32BE(9, 0);
	chunk.write("oFFs", 4, "latin1");
	chunk.writeInt32BE(offsetX, 8);
	chunk.writeInt32BE(offsetY, 12);
	chunk.writeUInt8(0, 16);
	chunk.writeUInt32BE(crc32(chunk.subarray(4, 17)), 17);
	return Buffer.concat([
		PNG_SIGNATURE,
		body.subarray(0, headSize),
		chunk,
		body.subarray(headSize),
		PNG_FOOTER,
	]);
}

/** `ChrOpener.TryOpen`: a byte sized name and a length prefixed record per frame. */
async function readChrEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<ChrEntry[] | undefined> {
	if (source.size < BigInt(FIRST_PAYLOAD_OFFSET)) return undefined;
	const indexOffset = (
		await source.readAt(BigInt(INDEX_OFFSET_FIELD), COUNT_FIELD_SIZE)
	).readUInt32LE(0);
	if (
		BigInt(indexOffset) < BigInt(FIRST_PAYLOAD_OFFSET) ||
		BigInt(indexOffset) + BigInt(COUNT_FIELD_SIZE) > source.size
	)
		return undefined;
	const count = (
		await source.readAt(BigInt(indexOffset), COUNT_FIELD_SIZE)
	).readInt32LE(0);
	if (!isSaneCount(count + 1)) return undefined;
	const baseName = baseNameWithoutExtension(sourcePath);
	const entries: ChrEntry[] = [
		{
			name: `${baseName}#0.png`,
			offset: BigInt(FIRST_PAYLOAD_OFFSET),
			size: BigInt(indexOffset - FIRST_PAYLOAD_OFFSET),
			offsetX: 0,
			offsetY: 0,
			virtual: false,
		},
	];
	let cursor = BigInt(indexOffset + COUNT_FIELD_SIZE);
	for (let id = 1; id < count + 1; id += 1) {
		if (cursor >= source.size) return undefined;
		const nameLength = (await source.readAt(cursor, 1)).readUInt8(0);
		cursor += 1n;
		const recordSize = nameLength + 4;
		if (cursor + BigInt(recordSize) > source.size) return undefined;
		const record = await source.readAt(cursor, recordSize);
		const name = decodeCp932(record.subarray(0, nameLength));
		const size = BigInt(record.readUInt32LE(nameLength));
		cursor += BigInt(recordSize);
		if (size > BigInt(CHAR_HEADER_SIZE)) {
			if (
				!checkPlacement(
					cursor + BigInt(CHAR_HEADER_SIZE),
					size - BigInt(CHAR_HEADER_SIZE),
					source.size,
				)
			)
				return undefined;
			const header = await source.readAt(cursor, CHAR_HEADER_SIZE);
			entries.push({
				name: `${baseName}#${name}.png`,
				offset: cursor + BigInt(CHAR_HEADER_SIZE),
				size: size - BigInt(CHAR_HEADER_SIZE),
				offsetX: header.readInt16LE(0),
				offsetY: header.readInt16LE(2),
				virtual: false,
			});
			// The reference lists a blended stand-in for every frame.
			entries.push({
				name: `${baseName}#blend#${name}.png`,
				offset: 0n,
				size: 0n,
				offsetX: 0,
				offsetY: 0,
				virtual: true,
			});
		}
		cursor += size;
	}
	return entries;
}

export const paletteChrDescriptor: FormatDescriptor = {
	id: "palette-chr",
	name: "Palette multi-frame PNG archive",
	extensions: ["chr"],
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
			source: "ArcFormats/Palette/ArcCHR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const paletteChrFormat: ArchiveFormat = defineFixedArchive({
	descriptor: paletteChrDescriptor,
	detection: {
		signatures: [{ bytes: Buffer.from([0x63, 0x68, 0x61, 0x72]) }],
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readChrEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readChrEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Palette CHR index");
		const fixed: FixedEntry[] = entries.map((entry, id) => ({
			...createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: entry.size,
				metadata: {
					type: "image",
					offsetX: entry.offsetX,
					offsetY: entry.offsetY,
					virtual: entry.virtual,
				},
			}),
			// Extracted streams carry a rebuilt PNG signature and footer.
			sizeKnown: false,
		}));
		return {
			entries: fixed,
			metadata: { entryCount: fixed.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const meta = entry.metadata as
			| { offsetX?: number; offsetY?: number; virtual?: boolean }
			| undefined;
		if (meta?.virtual) return Readable.from([Buffer.alloc(0)]);
		const body = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const offsetX = meta?.offsetX ?? 0;
		const offsetY = meta?.offsetY ?? 0;
		// The first entry is the sprite sheet itself and never carries a frame offset.
		const inject = Number(entry.id) !== 0 && (offsetX !== 0 || offsetY !== 0);
		return Readable.from([wrapPalettePng(body, offsetX, offsetY, inject)]);
	},
});
