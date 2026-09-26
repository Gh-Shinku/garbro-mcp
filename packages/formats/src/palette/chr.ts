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
import { writeBmp32 } from "../shared/bmp.js";
import { readPngImage, type PngImage } from "../shared/png-image.js";
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
	/** The frame a blended stand-in lays over the sheet, which stands of no payload of its own. */
	source?: number;
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
	// `CharOpener.OpenEntry` copies the leading chunk - its length word, its name, its own bytes and its
	// check word alike - before it writes the oFFs chunk: the count it reads is the count of the own bytes
	// of the chunk, so the whole chunk stands of twelve bytes more than that count.
	const chunkLength = body.length >= 4 ? body.readInt32BE(0) : -1;
	const headSize = chunkLength + 12;
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
			// The reference lists a blended stand-in for every frame: the sheet itself with the frame laid
			// over it at the place the frame names.
			entries.push({
				name: `${baseName}#blend#${name}.bmp`,
				offset: 0n,
				size: 0n,
				offsetX: header.readInt16LE(0),
				offsetY: header.readInt16LE(2),
				virtual: true,
				// The frame behind this stand-in is the entry that was just listed.
				source: entries.length - 1,
			});
		}
		cursor += size;
	}
	return entries;
}

/** A picture of the archive: the entry at the given place, rebuilt as the PNG the reference stands around it. */
async function readChrPicture(
	source: ByteSource,
	sourcePath: string,
	id: number,
	offsetX: number,
	offsetY: number,
	inject: boolean,
): Promise<PngImage> {
	const entries = await readChrEntries(source, sourcePath);
	const entry = entries?.[id];
	if (!entry) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"A blended stand-in names no frame",
		);
	}
	const body = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const picture = await readPngImage(
		wrapPalettePng(body, offsetX, offsetY, inject),
	);
	if (!picture) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"A picture of the archive stands of no picture of its own",
		);
	}
	return picture;
}

/**
 * `CharOpener.BlendEntry`: the sheet with the frame drawn over it at the place that frame names. The
 * reference draws both into a premultiplied surface through the rendering stack of its platform, which
 * covers the places of the sheet with the places of the frame as the alpha of the frame asks; this port
 * lays the places of the frame over the places of the sheet the same way, both of them with straight alpha,
 * and hands out a bitmap of the size of the sheet.
 */
function blendChrPictures(
	sheet: PngImage,
	overlay: PngImage,
	offsetX: number,
	offsetY: number,
): Buffer {
	const width = sheet.width;
	const height = sheet.height;
	const output: Buffer = Buffer.alloc(width * height * 4, 0x00);
	for (let at = 0; at < width * height; at += 1) {
		const from = at * (sheet.bitsPerPixel / 8);
		output[at * 4] = sheet.pixels[from] ?? 0;
		output[at * 4 + 1] = sheet.pixels[from + 1] ?? 0;
		output[at * 4 + 2] = sheet.pixels[from + 2] ?? 0;
		output[at * 4 + 3] =
			32 === sheet.bitsPerPixel ? (sheet.pixels[from + 3] ?? 0) : 0xff;
	}
	for (let y = 0; y < overlay.height; y += 1) {
		const toY = y + offsetY;
		if (toY < 0 || toY >= height) continue;
		for (let x = 0; x < overlay.width; x += 1) {
			const toX = x + offsetX;
			if (toX < 0 || toX >= width) continue;
			const from = (y * overlay.width + x) * (overlay.bitsPerPixel / 8);
			const alpha =
				32 === overlay.bitsPerPixel ? (overlay.pixels[from + 3] ?? 0) : 0xff;
			if (0 === alpha) continue;
			const dst = (toY * width + toX) * 4;
			if (255 === alpha) {
				output[dst] = overlay.pixels[from] ?? 0;
				output[dst + 1] = overlay.pixels[from + 1] ?? 0;
				output[dst + 2] = overlay.pixels[from + 2] ?? 0;
				output[dst + 3] = 0xff;
				continue;
			}
			const behind = output[dst + 3] ?? 0;
			const inverse = 255 - alpha;
			const outAlpha = alpha + Math.trunc((behind * inverse) / 255);
			for (let channel = 0; channel < 3; channel += 1) {
				const top = (overlay.pixels[from + channel] ?? 0) * alpha;
				const bottom = ((output[dst + channel] ?? 0) * behind * inverse) / 255;
				output[dst + channel] =
					0 === outAlpha
						? 0
						: Math.min(255, Math.round((top + bottom) / outAlpha));
			}
			output[dst + 3] = outAlpha;
		}
	}
	return writeBmp32(width, height, output);
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
					...(undefined === entry.source ? {} : { source: entry.source }),
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
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		const meta = entry.metadata as
			| {
					offsetX?: number;
					offsetY?: number;
					virtual?: boolean;
					source?: number;
			  }
			| undefined;
		const offsetX = meta?.offsetX ?? 0;
		const offsetY = meta?.offsetY ?? 0;
		if (meta?.virtual) {
			// `CharOpener.BlendEntry`: the first entry of the archive is the sheet, and the frame a blended
			// stand-in names is drawn over it at the place that frame carries. The reference draws both into
			// a premultiplied surface through the rendering stack of its platform and hands the result out.
			// This port reads both pictures with its own reader of the PNG interchange format and lays the
			// frame over the sheet as that reader gives them, both with straight alpha.
			if (undefined === meta.source)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"A blended stand-in names no frame",
				);
			const sheet = await readChrPicture(source, sourcePath, 0, 0, 0, false);
			const overlay = await readChrPicture(
				source,
				sourcePath,
				meta.source,
				offsetX,
				offsetY,
				offsetX !== 0 || offsetY !== 0,
			);
			return Readable.from([
				blendChrPictures(sheet, overlay, offsetX, offsetY),
			]);
		}
		const body = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		// The first entry is the sprite sheet itself and never carries a frame offset.
		const inject = Number(entry.id) !== 0 && (offsetX !== 0 || offsetY !== 0);
		return Readable.from([wrapPalettePng(body, offsetX, offsetY, inject)]);
	},
});
