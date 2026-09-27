// Port of GARbro "ArcFormats/LiveMaker/ImageGALX.cs" (tag "GAL/X200", class GalXFormat) and of
// "ArcFormats/LiveMaker/ArcGALX.cs" (tag "GAL/X", class GalXOpener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The pictures of the engine of LiveMaker of the
// shape `GaleX200`: a head of XML that stands of zlib, and the counts of the places of a picture behind it.
//
// The head of such a file is the word `GaleX200`, the count of the places of the XML behind it and the XML
// itself, of zlib. The reference reads the XML with `XmlDocument` after replacing every `<Frame …>` with
// `<Frame>` ("duplicate attributes which causes LoadXml to fail"), takes the counts of the picture from the
// `/Frames` node (the counts of a place, the count of the places of a colour, the walk of the places of the
// picture and the counts of a block) and then, for every frame, the counts of the frame from `Frame/Layers`
// (the count of the counts of places of it, the counts of the picture of it and its places of the colours
// where the picture stands of eight places of a colour or fewer) and the place of the count of the places of
// the picture from the `AlphaOn` of every `<Layer>`.
//
// Behind the XML, at the place the count of the XML names, the places of a frame stand one count of places
// behind the other: the count of the places of the count of places, the places themselves, and then the same
// again for its places of the colour where the frame stands of one. Every one of those counts stands of the
// walk of the places of a picture of the engine itself, which this project carries as `gal-image.ts`, and the
// port stands of that walk (`unpackGalLayer`, `galFrameStride`, `flattenGal`) rather than of a second one.
//
// What the port does not carry: the walk of the places of a picture of the engine itself where the XML names
// it (`CompType` of two, `JpegBitmapDecoder` of the reference), and a file whose `/Frames` node stands of
// `Randomized` (the reference throws `NotImplementedException` for such a file itself).

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { basename } from "node:path";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { changeExtension } from "../shared/companion.js";
import {
	flattenGal,
	galBitmap,
	galFrameStride,
	type GalFrame,
	type GalHeader,
	type GalLayer,
	unpackGalLayer,
} from "./gal-image.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";

/** `GalXFormat.ReadMetaData`: the word of the head, the count of the places of the XML and the XML. */
const SIGNATURE = Buffer.from("GaleX200", "latin1");
const HEAD_SIZE_AT = 8;
const XML_AT = 12;
/** The counts of the places of a place of a picture of the engine, of the XML. */
const PLACES_PER_COLOUR = 4;
const MOST_PLACES = 0xff;
/** `GalXFormat.ReadMetaData`: the count of the version of the picture stands behind this count. */
const LEAST_VERSION = 100;
/** The place of the counts of the places of the counts itself, of the picture of the engine. */
const FIRST_FRAME = 0;
const MOST_FRAMES = 0x1000;
/** The count of the places of a colour of a picture of the engine the reference takes a place of. */
const LEAST_COLOURS = 8;

/** The counts of one frame of a picture of the engine, of the XML of the head of it. */
export interface GalxFrame {
	width: number;
	height: number;
	bitsPerPixel: number;
	layerCount: number;
	/** `AlphaOn` of every count of places of the frame, as the XML stands of them. */
	alphaOn: boolean[];
	/** The places of the colours of the picture, as the XML stands of them where it holds any. */
	rgb?: string;
	/** Where the count of the places of the picture stands: behind every frame in front of it. */
	offset: number;
	size: number;
}

/** The head of a picture of the engine, of the XML of it and of the counts of its frames. */
export interface GalxHead {
	header: GalHeader;
	frames: GalxFrame[];
	meta: {
		version: number;
		frameCount: number;
		bgColor: number;
		blockWidth: number;
		blockHeight: number;
	};
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The counts of an XML element, of the places of it as they stand. */
function attributesOf(tag: string): Record<string, string> {
	const out: Record<string, string> = {};
	for (const found of tag.matchAll(/([A-Za-z]+)="([^"]*)"/g)) {
		if (undefined !== found[1] && undefined !== found[2]) {
			out[found[1]] = found[2];
		}
	}
	return out;
}

function number(text: string | undefined): number | undefined {
	if (undefined === text) return undefined;
	const value = Number.parseInt(text, 10);
	return Number.isFinite(value) ? value : undefined;
}

/**
 * `GalXFormat.ReadMetaData`: the head of a picture of the engine, of the XML of it. The XML stands of zlib
 * behind the count of its places, and both the head and the frames of it stand read here as the reference
 * reads them through `XmlDocument`.
 */
export async function readGalxHead(
	data: Buffer,
): Promise<GalxHead | undefined> {
	if (data.length < XML_AT) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const headSize = data.readInt32LE(HEAD_SIZE_AT);
	if (headSize <= 0 || XML_AT + headSize > data.length) return undefined;
	let text: string;
	try {
		text = (
			await inflateZlibBuffer(data.subarray(XML_AT, XML_AT + headSize))
		).toString("utf8");
	} catch {
		return undefined;
	}
	// `GalXFormat.ReadXml`: the XML of the engine holds the counts of a frame twice, which the reader of
	// the reference refuses, so every `<Frame …>` stands of `<Frame>` here as well.
	text = text.replace(/<Frame\s[^>]*>/g, "<Frame>");
	const framesTag = text.match(/<Frames[^>]*>/)?.[0];
	if (!framesTag) return undefined;
	const frames = attributesOf(framesTag);
	const width = number(frames["Width"]);
	const height = number(frames["Height"]);
	const bitsPerPixel = number(frames["Bpp"]);
	const version = number(frames["Version"]);
	const frameCount = number(frames["Count"]);
	const compression = number(frames["CompType"]);
	const blockWidth = number(frames["BlockWidth"]);
	const blockHeight = number(frames["BlockHeight"]);
	const bgColor = number(frames["BGColor"]);
	if (
		undefined === width ||
		undefined === height ||
		undefined === bitsPerPixel ||
		undefined === version ||
		undefined === frameCount ||
		undefined === compression ||
		undefined === blockWidth ||
		undefined === blockHeight ||
		version < LEAST_VERSION ||
		frameCount <= 0 ||
		frameCount > MOST_FRAMES ||
		width <= 0 ||
		height <= 0
	) {
		return undefined;
	}
	const shuffled = "0" !== frames["Randomized"];
	const header: GalHeader = {
		version,
		dataOffset: XML_AT + headSize,
		shuffled,
		compression,
		blockWidth,
		blockHeight,
		width,
		height,
		bitsPerPixel,
		frameCount,
	};
	const parts = text.split("<Frame>").slice(1);
	const walked: GalxFrame[] = [];
	let offset = header.dataOffset;
	for (const part of parts) {
		if (walked.length >= frameCount) break;
		const layersTag = part.match(/<Layers[^>]*>/)?.[0];
		if (!layersTag) return undefined;
		const layers = attributesOf(layersTag);
		const layerCount = number(layers["Count"]);
		const frameWidth = number(layers["Width"]);
		const frameHeight = number(layers["Height"]);
		const frameBits = number(layers["Bpp"]);
		if (
			undefined === layerCount ||
			undefined === frameWidth ||
			undefined === frameHeight ||
			undefined === frameBits ||
			layerCount <= 0 ||
			frameWidth <= 0 ||
			frameHeight <= 0
		) {
			return undefined;
		}
		const tags = [...part.matchAll(/<Layer\s[^>]*>/g)].map((found) => found[0]);
		if (0 === tags.length) return undefined;
		const alphaOn = tags.map((tag) => "0" !== attributesOf(tag)["AlphaOn"]);
		const rgb = part.match(/<RGB>([^<]*)<\/RGB>/)?.[1];
		const frame: GalxFrame = {
			width: frameWidth,
			height: frameHeight,
			bitsPerPixel: frameBits,
			layerCount,
			alphaOn,
			offset,
			size: 0,
		};
		if (undefined !== rgb) frame.rgb = rgb;
		// `GalXOpener.TryOpen`: the count of the places of a frame stands of every count of places of it,
		// of the count of the places of the count and of the counts of the places of the colour of it.
		let at = offset;
		const count = Math.min(layerCount, tags.length);
		for (let index = 0; index < count; index += 1) {
			if (at + 4 > data.length) return undefined;
			const layerSize = data.readInt32LE(at);
			at += 4;
			if (layerSize < 0 || at + layerSize > data.length) return undefined;
			at += layerSize;
			if (true === alphaOn[index]) {
				if (at + 4 > data.length) return undefined;
				const alphaSize = data.readInt32LE(at);
				at += 4;
				if (alphaSize < 0 || at + alphaSize > data.length) return undefined;
				at += alphaSize;
			}
		}
		frame.size = at - offset;
		walked.push(frame);
		offset = at;
	}
	if (walked.length !== frameCount) return undefined;
	return {
		header,
		frames: walked,
		meta: {
			version,
			frameCount,
			bgColor: bgColor ?? 0,
			blockWidth,
			blockHeight,
		},
	};
}

/** The places of the colours of a picture of the engine, of the counts of the XML of it. */
function paletteOf(rgb: string | undefined): Buffer | undefined {
	if (undefined === rgb) return undefined;
	const colours = Math.min(
		MOST_PLACES + 1,
		Math.trunc(rgb.length / (PLACES_PER_COLOUR + 2)),
	);
	const palette = Buffer.alloc(PLACES_PER_COLOUR * colours, 0x00);
	for (let at = 0; at < colours; at += 1) {
		const source = at * (PLACES_PER_COLOUR + 2);
		const red = Number.parseInt(rgb.slice(source, source + 2), 16);
		const green = Number.parseInt(rgb.slice(source + 2, source + 4), 16);
		const blue = Number.parseInt(rgb.slice(source + 4, source + 6), 16);
		if (
			!Number.isFinite(red) ||
			!Number.isFinite(green) ||
			!Number.isFinite(blue)
		) {
			return undefined;
		}
		// The places of a colour of a picture of this project stand blue first, and the colour of a place
		// of a palette of the engine stands of no sign of its own.
		palette[at * PLACES_PER_COLOUR] = blue;
		palette[at * PLACES_PER_COLOUR + 1] = green;
		palette[at * PLACES_PER_COLOUR + 2] = red;
		palette[at * PLACES_PER_COLOUR + 3] = MOST_PLACES;
	}
	return palette;
}

/**
 * The places of a frame of a picture of the engine, of the XML of the head of it. The reference stands of
 * every count of places of a frame for a picture of the name `GAL/X200` and of the **first** of them for a
 * picture of an archive of the name `GAL/X`.
 */
export async function readGalxFrame(
	data: Buffer,
	head: GalxHead,
	index: number,
	mostLayers: number,
): Promise<GalFrame | undefined> {
	const frame = head.frames[index];
	if (!frame) return undefined;
	const { stride, alphaStride } = galFrameStride(
		frame.width,
		frame.bitsPerPixel,
	);
	const built: GalFrame = {
		width: frame.width,
		height: frame.height,
		bitsPerPixel: frame.bitsPerPixel,
		stride,
		alphaStride,
		layers: [],
		placedAt: 0,
	};
	if (frame.bitsPerPixel <= LEAST_COLOURS) {
		const palette = paletteOf(frame.rgb);
		if (palette) built.palette = palette;
	}
	let at = frame.offset;
	const count = Math.min(frame.layerCount, Math.max(1, mostLayers));
	for (let layer = 0; layer < count; layer += 1) {
		if (at + 4 > data.length) return undefined;
		const layerSize = data.readInt32LE(at);
		at += 4;
		if (layerSize < 0 || at + layerSize > data.length) return undefined;
		const pixels = await unpackGalLayer(
			built,
			head.header,
			data.subarray(at, at + layerSize),
			layerSize,
			false,
			built.layers,
		);
		if (!pixels) return undefined;
		at += layerSize;
		const places: GalLayer = { pixels };
		if (true === frame.alphaOn[layer]) {
			if (at + 4 > data.length) return undefined;
			const alphaSize = data.readInt32LE(at);
			at += 4;
			if (alphaSize < 0 || at + alphaSize > data.length) return undefined;
			const alpha = await unpackGalLayer(
				built,
				head.header,
				data.subarray(at, at + alphaSize),
				alphaSize,
				true,
				built.layers,
			);
			if (!alpha) return undefined;
			at += alphaSize;
			places.alpha = alpha;
		}
		built.layers.push(places);
	}
	return built;
}

/** The picture of a frame of the engine, of the places of a picture of the project. */
async function galxBitmap(
	data: Buffer,
	head: GalxHead,
	index: number,
	mostLayers: number,
): Promise<Buffer | undefined> {
	const frame = await readGalxFrame(data, head, index, mostLayers);
	if (!frame) return undefined;
	return galBitmap(flattenGal(frame));
}

export const galxImageDescriptor: FormatDescriptor = {
	id: "livemaker-galx-image",
	name: "LiveMaker engine picture of the shape GaleX200",
	extensions: ["gal"],
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
			source: "ArcFormats/LiveMaker/ImageGALX.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

export const galxArchiveDescriptor: FormatDescriptor = {
	id: "livemaker-galx-archive",
	name: "LiveMaker engine multi-frame picture",
	extensions: ["galx"],
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
			source: "ArcFormats/LiveMaker/ArcGALX.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

/** The one picture of a file of the name `GaleX200`, of the first frame of it. */
export const galxImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: galxImageDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }],
		// The shape of the picture of the name `GAL` stands of `ImageGAL.cs` and stands of the walk of that
		// name; a file of this shape stands of this one.
		priority: -1,
	},
	async detect(source: ByteSource): Promise<boolean> {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		return (await readGalxHead(data)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const head = await readGalxHead(data);
		if (!head) {
			throw invalidPicture("Not a picture of the shape GaleX200");
		}
		const first = head.frames[FIRST_FRAME];
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(basename(sourcePath), "bmp"),
					offset: 0n,
					size: source.size,
					metadata: {
						type: "image",
						image: "bmp",
						frame: FIRST_FRAME,
					} as Record<string, unknown>,
				}),
			],
			metadata: {
				width: first?.width ?? 0,
				height: first?.height ?? 0,
				frames: head.frames.length,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const head = await readGalxHead(data);
		if (!head) throw invalidPicture("Not a picture of the shape GaleX200");
		const picture = await galxBitmap(
			data,
			head,
			FIRST_FRAME,
			head.frames.length,
		);
		if (!picture)
			throw invalidPicture("The picture stands of no walk of this port");
		return Readable.from([picture]);
	},
});

export const galxEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = Buffer.from(await source.readAt(0n, Number(source.size)));
	const head = await readGalxHead(data);
	if (!head) throw invalidPicture("Not a picture of the shape GaleX200");
	const index = Number(entry.metadata?.frame ?? 0);
	// `GalXDecoder.UnpackFrame`: the archive stands of the first count of places of a frame alone.
	const picture = await galxBitmap(data, head, index, 1);
	if (!picture)
		throw invalidPicture("The picture stands of no walk of this port");
	return Readable.from([picture]);
};

/** `GalXOpener.TryOpen`: the frames of a picture of the engine, every one of them a picture of its own. */
export const galxArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: galxArchiveDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }],
		// The shape of the picture of the name `GAL` stands of `ImageGAL.cs`.
		priority: -1,
	},
	async detect(source: ByteSource): Promise<boolean> {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const head = await readGalxHead(data);
		return undefined !== head && head.frames.length > 0;
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const head = await readGalxHead(data);
		if (!head) throw invalidPicture("Not a picture of the shape GaleX200");
		const base = basename(changeExtension(sourcePath, ""));
		const entries: FixedEntry[] = head.frames.map((frame, index) => ({
			...createFixedEntry({
				id: index,
				path: `${base}#${String(index).padStart(4, "0")}`,
				offset: BigInt(frame.offset),
				size: BigInt(frame.size),
				metadata: {
					type: "image",
					image: "bmp",
					frame: index,
				} as Record<string, unknown>,
			}),
			sizeKnown: true,
		}));
		return {
			entries,
			metadata: {
				count: entries.length,
				version: head.meta.version,
				width: head.frames[FIRST_FRAME]?.width ?? 0,
				height: head.frames[FIRST_FRAME]?.height ?? 0,
			},
		};
	},
	openEntry: galxEntryOpener,
});
