// Circus differential picture (CRXD), of the reference `ArcFormats/Circus/ImageCRXD.cs` (`CrxdFormat`)
// standing over the reader of `ArcFormats/Circus/ImageCRX.cs` (`CrxFormat`, `Reader`).
//
// A CRXD stands of a head of its own (the offset of the base picture within the archive of the engine, the
// name of the base beside itself, and the kind of the places of the differences) and of a CRX picture of the
// differences behind that head. The reference reaches the base picture and - of the kind `CRXJ` - the picture
// of the differences themselves by offset within the CRM archive that holds them, and a picture of its own
// cannot stand of such an offset: this port stands of the picture of the differences within the file (the
// kind `CRXG`, the kind of no offset of an archive) and of the base picture beside the name of it, and every
// `CRXJ` of no archive under it stands undetected, which is where the reference stands without an archive as
// well (`OpenByOffset` hands back nothing and its metadata walk ends in nothing).
//
// The places of the picture of the differences stand over the places of the base rather than within them: a
// place of a colour of the base of the places of the differences stands of the two added, and a place of an
// alpha of them stands of the one less the other, over the places of the two pictures that stand of both.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import { decodeCStringField } from "../shared/fixed-archive.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	crxImageOf,
	type CrxLayout,
	type CrxPlaces,
	readCrxLayout,
	unpackCrxPlaces,
} from "./crx-image.js";

/** `'CRXD'`, the mark the reference registers. */
const MARK = Buffer.from("CRXD", "latin1");
const HEAD_SIZE = 0x24;
const BASE_OFFSET_FIELD = 0x08;
const BASE_NAME_FIELD = 0x0c;
const BASE_NAME_SIZE = 0x14;
const DIFF_KIND_FIELD = 0x20;
/** The kind of the head whose picture of the differences stands within the file itself. */
const DIFF_WITHIN = "CRXG";
/** The kind `CRXJ` names the picture of the differences behind an offset of the archive of the engine, and
 * the offset of it stands at 0x28 of the head: a file of its own cannot stand of it. */
/** The place of the picture of the differences within a file of the kind `CRXG`. */
const DIFF_PLACE = 0x20;
const PLACES_PER_COLOUR = 4;
const ALPHA_PLACE = 3;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The head of a difference of a picture: the places of the picture of the differences, and the base. */
export interface CrxdLayout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	bitsPerPixel: number;
	/** The offset of the base picture within the archive of the engine, which a file of its own has not. */
	baseOffset: number;
	/** The name of the base picture beside the file of the differences. */
	baseFileName: string;
	/** The place of the picture of the differences within the file. */
	diffPlace: number;
}

/**
 * `CrxdFormat.ReadMetaData`: the head of the picture, of the places of it and of the name of the base. The
 * kind `CRXJ` stands of the picture of the differences of the archive of the engine behind it, so a file of
 * no archive under it stands undetected, the way the reference stands without one.
 */
export function readCrxdLayout(data: Buffer): CrxdLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const kind = data.toString("latin1", DIFF_KIND_FIELD, DIFF_KIND_FIELD + 4);
	if (DIFF_WITHIN !== kind) return undefined;
	const diff = readCrxLayout(data.subarray(DIFF_PLACE));
	if (!diff) return undefined;
	return {
		width: diff.width,
		height: diff.height,
		offsetX: diff.offsetX,
		offsetY: diff.offsetY,
		bitsPerPixel: diff.bitsPerPixel,
		baseOffset: data.readUInt32LE(BASE_OFFSET_FIELD),
		baseFileName: decodeCStringField(data, BASE_NAME_FIELD, BASE_NAME_SIZE),
		diffPlace: DIFF_PLACE,
	};
}

/**
 * `CrxdFormat.Read`: the places of the base picture, of the places of the picture of the differences over
 * them. The places of the two pictures stand of both where they stand of the two, which is the crossing of
 * the places of a picture of the head of each of them.
 */
export function blendCrxd(
	base: CrxLayout,
	basePlaces: CrxPlaces,
	diff: CrxLayout,
	diffPlaces: CrxPlaces,
): CrxPlaces {
	const placeSize = Math.trunc(base.bitsPerPixel / 8);
	const pixels = Buffer.from(basePlaces.pixels);
	const left = Math.max(base.offsetX, diff.offsetX);
	const top = Math.max(base.offsetY, diff.offsetY);
	const right = Math.min(base.offsetX + base.width, diff.offsetX + diff.width);
	const bottom = Math.min(
		base.offsetY + base.height,
		diff.offsetY + diff.height,
	);
	if (right <= left || bottom <= top) {
		// The two pictures stand apart: the reference hands the base picture out as it stands.
		return { ...basePlaces, pixels };
	}
	let to =
		(top - base.offsetY) * basePlaces.stride +
		placeSize * (left - base.offsetX);
	let from =
		(top - diff.offsetY) * diffPlaces.stride +
		placeSize * (left - diff.offsetX);
	const rowSize = (right - left) * placeSize;
	for (let row = 0; row < bottom - top; row += 1) {
		for (let place = 0; place < rowSize; place += placeSize) {
			for (let channel = 0; channel < 3; channel += 1) {
				pixels[to + place + channel] =
					((pixels[to + place + channel] ?? 0) +
						(diffPlaces.pixels[from + place + channel] ?? 0)) &
					0xff;
			}
			if (PLACES_PER_COLOUR === placeSize) {
				pixels[to + place + ALPHA_PLACE] =
					((pixels[to + place + ALPHA_PLACE] ?? 0) -
						(diffPlaces.pixels[from + place + ALPHA_PLACE] ?? 0)) &
					0xff;
			}
		}
		to += basePlaces.stride;
		from += diffPlaces.stride;
	}
	return { ...basePlaces, pixels };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The base picture of a difference, of the name the head of it names beside it. */
async function readCrxdBase(
	sourcePath: string,
	layout: CrxdLayout,
): Promise<Buffer> {
	const stored = await readCompanionFile(sourcePath, layout.baseFileName);
	if (!stored) {
		throw invalidPicture(
			`The base picture ${layout.baseFileName} of the difference stands nowhere`,
		);
	}
	return stored;
}

/** The two pictures of a difference and their heads, of the walk of each of them. */
async function readCrxdPictures(
	data: Buffer,
	sourcePath: string,
	layout: CrxdLayout,
): Promise<{
	base: CrxLayout;
	basePlaces: CrxPlaces;
	diff: CrxLayout;
	diffPlaces: CrxPlaces;
}> {
	const diff = readCrxLayout(data.subarray(layout.diffPlace));
	if (!diff)
		throw invalidPicture("The picture of the differences stands of no walk");
	const baseData = await readCrxdBase(sourcePath, layout);
	const base = readCrxLayout(baseData);
	if (!base) {
		throw invalidPicture(
			"The base picture of the difference stands of no walk",
		);
	}
	if (base.bitsPerPixel !== diff.bitsPerPixel) {
		throw invalidPicture(
			"The base picture of the difference stands of another count of places",
		);
	}
	return {
		base,
		basePlaces: await unpackCrxPlaces(baseData, base),
		diff,
		diffPlaces: await unpackCrxPlaces(data.subarray(layout.diffPlace), diff),
	};
}

export const crxdImageDescriptor: FormatDescriptor = {
	id: "circus-crxd-image",
	name: "Circus differential image",
	extensions: ["crx"],
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
			source: "ArcFormats/Circus/ImageCRXD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const crxdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crxdImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readCrxdLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readCrxdLayout(data);
		if (!layout) throw invalidPicture("Not a difference of a picture");
		const baseData = await readCrxdBase(sourcePath, layout);
		const base = readCrxLayout(baseData);
		if (!base) {
			throw invalidPicture(
				"The base picture of the difference stands of no walk",
			);
		}
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(layout.baseFileName, "bmp"),
				offset: 0n,
				size: BigInt(baseData.length),
				compressed: true,
				metadata: {
					type: "image",
					base: layout.baseFileName,
					width: base.width,
					height: base.height,
					bitsPerPixel: base.bitsPerPixel,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			// The places of the picture of the differences stand of the walk of the head of it rather than of
			// the base, and the reference names those of the metadata of the file.
			metadata: {
				image: "bmp",
				base: layout.baseFileName,
				width: layout.width,
				height: layout.height,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		void entry;
		const data = await readStored(source);
		const layout = readCrxdLayout(data);
		if (!layout) throw invalidPicture("Not a difference of a picture");
		const { base, basePlaces, diff, diffPlaces } = await readCrxdPictures(
			data,
			sourcePath,
			layout,
		);
		return Readable.from([
			crxImageOf(base, blendCrxd(base, basePlaces, diff, diffPlaces)),
		]);
	},
});
