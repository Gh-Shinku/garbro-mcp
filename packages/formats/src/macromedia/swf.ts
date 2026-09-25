// Format reference: GARbro "ArcFormats/Macromedia/ArcSWF.cs", classes `SwfOpener`, `SwfReader`,
// `SwfChunk`, `LosslessImageDecoder`, `SwfJpeg2Decoder` and `SwfJpeg3Decoder`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { Readable } from "node:stream";
import { inflateZlibBuffer, MsbBitReader } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	RGB565_MASKS,
	writeBmp8Palette,
	writeBmp16,
	writeBmp32,
} from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 8;
const PLAIN = "FWS";
const COMPRESSED = "CWS";
const LETTERS = 3;
const RECT_BITS = 5;
const SPEC_SIDES = 4;
const DEFINE_SPRITE = 39;
const LONG_TAG = 0x3f;
const TAG_HEADER = 2;
/** The places of the file of the walk of the engine of the sound of the stream of the picture of it. */
const SOUND_OFFSET = 4;

/** The tags of the picture of the engine of the walk of the places of the file of it. */
const TYPES = {
	Jpeg: 6,
	JpegTables: 8,
	Action: 12,
	Sound: 14,
	SoundHead: 18,
	SoundBlock: 19,
	Lossless: 20,
	Jpeg2: 21,
	Jpeg3: 35,
	Lossless2: 36,
	SoundHead2: 45,
} as const;

/** The kinds of the entries of the picture of the engine, of the places of the file of the walk of it. */
const KIND_BY_TYPE: Record<number, string> = {
	[TYPES.Jpeg]: "image",
	[TYPES.Jpeg2]: "image",
	[TYPES.Jpeg3]: "image",
	[TYPES.Lossless]: "image",
	[TYPES.Lossless2]: "image",
	[TYPES.Sound]: "audio",
	[TYPES.Action]: "",
	[TYPES.JpegTables]: "JpegTables",
};

/** The count of the places of the file of a colour of a place of the picture of the table of it. */
const PALETTE_8 = 8;
const BITS_16 = 16;
const BITS_32 = 32;
const PLACES_32 = 4;
const ARGB_PLACES = 4;

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	const size = Number(source.size);
	if (!Number.isSafeInteger(size) || size < 0) {
		throw invalidPicture("A picture of the engine of no places of the file");
	}
	const data = await source.readAt(0n, size);
	return Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
}

/** The head of a picture of the engine, of the walk of the places of the file of it. */
export interface SwfLayout {
	version: number;
	compressed: boolean;
	width: number;
	height: number;
	frameRate: number;
	frameCount: number;
	/** The places of the file of the picture of the engine behind the head of it. */
	body: Buffer;
	/** The places of the file of the walk of the places of the file of the engine of the tags of it. */
	tagsAt: number;
}

function signed(value: number, count: number): number {
	if (0 === count) return 0;
	const top = value >> (count - 1);
	return 0 !== top ? value | (-1 << count) : value;
}

/** `SwfOpener.TryOpen` and `SwfReader.Parse`: the head of the picture of the engine and of the walk. */
export async function readSwfLayout(
	data: Buffer,
): Promise<SwfLayout | undefined> {
	if (data.length < HEAD_SIZE) return undefined;
	const letters = data.toString("latin1", 0, LETTERS);
	if (PLAIN !== letters && COMPRESSED !== letters) return undefined;
	const version = data[3] ?? 0;
	const compressed = COMPRESSED === letters;
	const stored = data.subarray(HEAD_SIZE);
	let body: Buffer;
	if (compressed) {
		try {
			body = await inflateZlibBuffer(stored);
		} catch {
			return undefined;
		}
	} else {
		body = stored;
	}
	if (body.length < 1) return undefined;
	const bits = new MsbBitReader(body, 0);
	const size = bits.readBits(RECT_BITS);
	const rectBits = RECT_BITS + SPEC_SIDES * size;
	const x = signed(bits.readBits(size), size);
	const width = signed(bits.readBits(size), size) - x;
	const y = signed(bits.readBits(size), size);
	const height = signed(bits.readBits(size), size) - y;
	const at = (rectBits + 7) >> 3;
	if (at + 4 > body.length) return undefined;
	return {
		version,
		compressed,
		width,
		height,
		frameRate: body.readUInt16LE(at),
		frameCount: body.readUInt16LE(at + 2),
		body,
		tagsAt: at + 4,
	};
}

/** The places of the file of a tag of the picture of the engine. */
export interface SwfChunk {
	type: number;
	places: number;
	body: Buffer;
}

/** `SwfReader.ReadChunk` and `SwfReader.Parse`: the tags of the picture of the engine. */
export function readSwfChunks(layout: SwfLayout): SwfChunk[] {
	const chunks: SwfChunk[] = [];
	let at = layout.tagsAt;
	const body = layout.body;
	for (;;) {
		if (at + TAG_HEADER > body.length) break;
		const header = body.readUInt16LE(at);
		at += TAG_HEADER;
		const type = header >> 6;
		let length = header & LONG_TAG;
		if (LONG_TAG === length) {
			if (at + 4 > body.length) break;
			length = body.readInt32LE(at);
			at += 4;
		}
		if (length < 0) break;
		if (DEFINE_SPRITE === type) length = 4;
		if (at + length > body.length) break;
		const places = at;
		at += length;
		chunks.push({ type, places, body: body.subarray(places, places + length) });
	}
	return chunks;
}

/** The places of the file of the name of an entry of the engine. */
function idOf(chunk: SwfChunk): number {
	return chunk.body.length > 2 ? chunk.body.readUInt16LE(0) : -1;
}

/** `SwfOpener.IsSoundStream`. */
function isSoundStream(chunk: SwfChunk): boolean {
	return (
		TYPES.SoundHead === chunk.type ||
		TYPES.SoundHead2 === chunk.type ||
		TYPES.SoundBlock === chunk.type
	);
}

/** `SwfOpener.TryOpen`'s walk of the places of the file of the sound of the stream of the engine. */
function soundBlocks(chunks: SwfChunk[], head: SwfChunk): SwfChunk[] {
	const blocks: SwfChunk[] = [];
	for (const chunk of chunks) {
		if (chunk.places <= head.places) continue;
		if (isSoundStream(chunk) && TYPES.SoundBlock !== chunk.type) break;
		if (TYPES.SoundBlock === chunk.type) blocks.push(chunk);
	}
	return blocks;
}

/** The places of the file of the picture of the engine of the walk of the engine of the table of it. */
function jpegOf(chunk: SwfChunk): Buffer | undefined {
	if (TYPES.Jpeg === chunk.type) {
		return chunk.body.subarray(2);
	}
	if (TYPES.Jpeg2 === chunk.type) {
		const at = findJpegSignature(chunk.body);
		return at < 0 ? undefined : chunk.body.subarray(at);
	}
	if (TYPES.Jpeg3 === chunk.type) {
		const length = chunk.body.readInt32LE(2);
		if (length < 0 || 6 + length > chunk.body.length) return undefined;
		// The places of the file of the alpha of the picture of the engine stand of the walk of the places
		// of the file of it behind the places of the file of the picture of the engine itself: this port
		// stands of the places of the file of the picture of the engine alone.
		return chunk.body.subarray(6, 6 + length);
	}
	return undefined;
}

/** `SwfJpeg2Decoder.FindJpegSignature`: the places of the file of the picture of the engine. */
export function findJpegSignature(body: Buffer): number {
	let at = 2;
	while (at < body.length - 4) {
		if (0xff !== body[at]) {
			at += 1;
		} else if (0xd8 === body[at + 1]) {
			return at;
		} else if (0xd9 !== body[at + 1]) {
			at += 1;
		} else if (0xff !== body[at + 2]) {
			at += 3;
		} else if (0xd8 !== body[at + 3]) {
			at += 2;
		} else {
			return at + 4;
		}
	}
	return -1;
}

/** `SwfOpener.ExtractAudio`: the places of the file of the sound of the picture of the engine. */
function soundOf(chunk: SwfChunk): Buffer {
	const flags = chunk.body[2] ?? 0;
	const format = flags >> 4;
	if (2 === format) {
		return chunk.body.subarray(9);
	}
	return chunk.body.subarray(2);
}

/** `LosslessImageDecoder.GetImageData`: the picture of the engine of the walk of the places of it. */
export async function unpackSwfLossless(chunk: SwfChunk): Promise<Buffer> {
	const body = chunk.body;
	if (body.length < 7)
		throw invalidPicture(
			"A picture of the engine of no places of the file of it",
		);
	const format = body[2] ?? 0;
	const width = body.readUInt16LE(3);
	const height = body.readUInt16LE(5);
	let at = 7;
	let colors = 0;
	let bitsPerPixel = BITS_32;
	if (3 === format) {
		bitsPerPixel = PALETTE_8;
		colors = (body[at] ?? 0) + 1;
		at += 1;
	} else if (4 === format) {
		bitsPerPixel = BITS_16;
	} else if (5 !== format) {
		throw invalidPicture(
			"A picture of the engine of no places of the file of the walk of it",
		);
	}
	const places = await inflateZlibBuffer(body.subarray(at));
	const hasAlpha = TYPES.Lossless2 === chunk.type;
	let palette: Buffer | undefined;
	if (PALETTE_8 === bitsPerPixel) {
		if (places.length < colors * 4) {
			throw invalidPicture(
				"A picture of the engine of no places of the file of the table of it",
			);
		}
		palette = Buffer.alloc(colors * 4, 0);
		for (let i = 0; i < colors; i += 1) {
			const red = places[i * 4] ?? 0;
			const green = places[i * 4 + 1] ?? 0;
			const blue = places[i * 4 + 2] ?? 0;
			const alpha = hasAlpha ? (places[i * 4 + 3] ?? 0) : 0xff;
			palette[i * 4] = blue;
			palette[i * 4 + 1] = green;
			palette[i * 4 + 2] = red;
			palette[i * 4 + 3] = alpha;
		}
	}
	// The reference reads the colour table and the places of the picture of the engine from the same walk
	// of the engine one behind the other, so the places of the file of the picture of the engine stand of
	// the places of the file of the table of the colours of it behind them.
	const size = width * height * (bitsPerPixel / 8);
	const tableSize = PALETTE_8 === bitsPerPixel ? colors * ARGB_PLACES : 0;
	if (places.length < tableSize + size) {
		throw invalidPicture(
			"A picture of the engine of no places of the file of the picture of it",
		);
	}
	const picture = places.subarray(tableSize, tableSize + size);
	const pixels =
		PLACES_32 === bitsPerPixel / 8 ? Buffer.from(picture) : picture;
	if (BITS_32 === bitsPerPixel) {
		for (let i = 0; i + ARGB_PLACES <= pixels.length; i += ARGB_PLACES) {
			const alpha = pixels[i] ?? 0;
			const red = pixels[i + 1] ?? 0;
			const green = pixels[i + 2] ?? 0;
			const blue = pixels[i + 3] ?? 0;
			pixels[i] = blue;
			pixels[i + 1] = green;
			pixels[i + 2] = red;
			pixels[i + 3] = alpha;
		}
		return writeBmp32(width, height, pixels, false);
	}
	if (BITS_16 === bitsPerPixel) {
		return writeBmp16(width, height, pixels, false, RGB565_MASKS);
	}
	return writeBmp8Palette(
		width,
		height,
		pixels,
		palette ?? Buffer.alloc(4, 0),
		false,
	);
}

/** The places of the file of an entry of the picture of the engine, of the walk of the engine of it. */
async function readEntry(
	chunk: SwfChunk,
	stream: SwfChunk[] | undefined,
): Promise<Buffer> {
	if (undefined !== stream) {
		const parts: Buffer[] = [];
		for (const block of stream) {
			const body = block.body.subarray(SOUND_OFFSET);
			parts.push(body);
		}
		return Buffer.concat(parts);
	}
	if (TYPES.Lossless === chunk.type || TYPES.Lossless2 === chunk.type) {
		return await unpackSwfLossless(chunk);
	}
	const jpeg = jpegOf(chunk);
	if (jpeg) return jpeg;
	if (TYPES.Sound === chunk.type) return soundOf(chunk);
	return Buffer.from(chunk.body);
}

function kindOf(type: number): string {
	return KIND_BY_TYPE[type] ?? String(type);
}

function extensionOf(type: number): string {
	if (TYPES.Sound === type) return "mp3";
	if (TYPES.Jpeg === type || TYPES.Jpeg2 === type || TYPES.Jpeg3 === type) {
		return "jpg";
	}
	if (TYPES.Lossless === type || TYPES.Lossless2 === type) return "bmp";
	return "bin";
}

export const swfArchiveDescriptor: FormatDescriptor = {
	id: "macromedia-swf-archive",
	name: "Shockwave Flash presentation",
	extensions: ["swf"],
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
			source: "ArcFormats/Macromedia/ArcSWF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const swfArchiveFormat: ArchiveFormat = defineFixedArchive({
	descriptor: swfArchiveDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from(PLAIN, "latin1") },
			{ bytes: Buffer.from(COMPRESSED, "latin1") },
		],
		priority: 0,
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return (await readSwfLayout(await readStored(source))) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = await readSwfLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the engine");
		const chunks = readSwfChunks(layout);
		const base = sourcePath.replace(/^.*[/\\]/, "").replace(/\.[^.]*$/, "");
		const entries: FixedEntry[] = [];
		for (const chunk of chunks) {
			if (chunk.body.length <= 2) continue;
			if (undefined === KIND_BY_TYPE[chunk.type]) continue;
			const id = idOf(chunk);
			entries.push(
				createFixedEntry({
					id: entries.length,
					path: `${base}#${String(id).padStart(5, "0")}.${extensionOf(chunk.type)}`,
					offset: BigInt(chunk.places),
					size: BigInt(chunk.body.length),
					compressed: true,
					metadata: {
						type: kindOf(chunk.type),
						tag: chunk.type,
						id,
					},
				}),
			);
		}
		for (const chunk of chunks) {
			if (!isSoundStream(chunk)) continue;
			if (TYPES.SoundBlock === chunk.type) continue;
			if (0x20 !== ((chunk.body[1] ?? 0) & 0x30)) continue;
			const blocks = soundBlocks(chunks, chunk);
			const size = blocks.reduce(
				(sum, block) => sum + Math.max(0, block.body.length - SOUND_OFFSET),
				0,
			);
			entries.push(
				createFixedEntry({
					id: entries.length,
					path: `${base}#${String(idOf(chunk)).padStart(5, "0")}.mp3`,
					offset: BigInt(chunk.places),
					size: BigInt(size),
					packedSize: BigInt(chunk.body.length + size),
					compressed: true,
					metadata: { type: "audio", tag: chunk.type, id: idOf(chunk) },
				}),
			);
		}
		return {
			entries,
			metadata: {
				version: layout.version,
				compressed: layout.compressed,
				width: layout.width,
				height: layout.height,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = await readStored(source);
		const layout = await readSwfLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the engine");
		const chunks = readSwfChunks(layout);
		const tag = Number(entry.metadata?.tag ?? -1);
		const id = Number(entry.metadata?.id ?? -1);
		const chunk = chunks.find(
			(candidate) => candidate.type === tag && idOf(candidate) === id,
		);
		if (!chunk)
			throw invalidPicture(
				"The places of the file of the entry of the engine stand of no places of it",
			);
		if (TYPES.SoundHead === tag || TYPES.SoundHead2 === tag) {
			return Readable.from([
				await readEntry(chunk, soundBlocks(chunks, chunk)),
			]);
		}
		return Readable.from([await readEntry(chunk, undefined)]);
	},
});
