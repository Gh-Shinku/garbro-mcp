// Format reference: GARbro "ArcFormats/Leaf/AudioG.cs", classes `GAudio` and `GStream` (a Leaf sound: an Ogg
// sound whose pages stand the way the engine wrote them, where the two bytes the codec names stand in the place
// of the word `vorbis` and where the marks of the pages are written afresh). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { crc32Normal } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The names the reference registers the format by: it declares no word of its own. */
const EXTENSION = "g";
/** The head the reference looks at before it walks the pages. */
const HEADER_SIZE = 0x1c;
/** The two words the reference turns away, and the three bytes it tells a sound of this engine by. */
const OGG_MARK = Buffer.from("OggS", "latin1");
const RIFF_MARK = Buffer.from("RIFF", "latin1");
const ZERO_FIELD = 0x04;
const TWO_FIELD = 0x05;
const LONG_ZERO_FIELD = 0x06;
/** Where the marks of an Ogg page stand: its twenty seven bytes, the count of its segments, its table of them
 * and the mark itself. */
const PAGE_HEADER_SIZE = 0x1b;
const SEGMENT_COUNT_FIELD = 0x1a;
const SEGMENT_TABLE_FIELD = 0x1b;
const PAGE_CRC_FIELD = 0x16;
const PAGE_WORD = "OggS";
/** The word every codec of the Ogg kind is named by, which stands in the place of the two bytes the engine
 * wrote. */
const CODEC_WORD = "vorbis";
/** The three places a sound of this engine has one page apiece for. */
const HEADER_ID = 1;
const COMMENT_ID = 3;
const SETUP_ID = 5;
/** How wide the page the reference walks stands. */
const PAGE_SIZE = 0x10000;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GAudioLayout {
	/** Where the pages of the sound begin, which is the beginning of the file itself. */
	pageOffset: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GAudio.TryOpen`: a sound of this engine is not a sound of the Ogg kind as it stands and not a wave file
 * either, the byte at four is nought, the byte behind it is two and the eight bytes behind those stand as
 * nought. The pages of the sound stand from the beginning of the file.
 */
export function readGAudioLayout(
	data: Buffer,
	fileLength = data.length,
): GAudioLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (fileLength < HEADER_SIZE) return undefined;
	const word = data.subarray(0, 4);
	if (word.equals(OGG_MARK) || word.equals(RIFF_MARK)) return undefined;
	if (0 !== (data[ZERO_FIELD] ?? 0)) return undefined;
	if (2 !== (data[TWO_FIELD] ?? 0)) return undefined;
	if (0n !== data.readBigInt64LE(LONG_ZERO_FIELD)) return undefined;
	return { pageOffset: 0 };
}

/** Where the pages of the sound stand, in which of the three places and what stands at each place of them. */
type GState = "header" | "comment" | "setup" | "payload" | "broken";

interface GCursor {
	data: Buffer;
	position: number;
}

function readByte(cursor: GCursor): number {
	if (cursor.position >= cursor.data.length) return -1;
	const value = cursor.data[cursor.position] ?? 0;
	cursor.position += 1;
	return value;
}

/** Reads as many bytes as stand at hand, at most `count`, the way a stream's own read does. */
function readBytes(
	cursor: GCursor,
	page: Buffer,
	at: number,
	count: number,
): number {
	if (count <= 0) return 0;
	const available = Math.min(count, cursor.data.length - cursor.position);
	for (let index = 0; index < available; index += 1) {
		page[at + index] = cursor.data[cursor.position + index] ?? 0;
	}
	cursor.position += available;
	return available;
}

/** `GStream.UpdateCrc`: the mark of a page stands over the whole of it, its own four bytes standing as
 * nought while the mark is worked out. */
function updatePageCrc(page: Buffer, length: number): void {
	page.fill(0x00, PAGE_CRC_FIELD, PAGE_CRC_FIELD + 4);
	const crc = crc32Normal(page.subarray(0, length));
	page.writeUInt32LE(crc >>> 0, PAGE_CRC_FIELD);
}

export function decodeG(data: Buffer): Buffer {
	const cursor: GCursor = { data, position: 0 };
	const page: Buffer = Buffer.alloc(PAGE_SIZE, 0x00);
	const pages: Buffer[] = [];
	let state: GState = "header";
	for (;;) {
		let length = PAGE_HEADER_SIZE;
		let read = readBytes(cursor, page, 0, length);
		if (read < length) {
			// What stands at hand is given as it is, however little of the page stands there.
			if (read !== 0) pages.push(Buffer.from(page.subarray(0, read)));
			break;
		}
		page.write(PAGE_WORD, 0, "latin1");
		const segmentCount = page[SEGMENT_COUNT_FIELD] ?? 0;
		if (0 === segmentCount) {
			updatePageCrc(page, length);
			pages.push(Buffer.from(page.subarray(0, length)));
			continue;
		}
		read = readBytes(cursor, page, length, segmentCount);
		length += read;
		if (read < segmentCount) {
			updatePageCrc(page, length);
			pages.push(Buffer.from(page.subarray(0, length)));
			break;
		}
		let segmentsSize = 0;
		for (let index = 0; index < segmentCount; index += 1) {
			segmentsSize += page[SEGMENT_TABLE_FIELD + index] ?? 0;
		}
		let again = true;
		while (again) {
			again = false;
			if ("header" === state) {
				const id = readByte(cursor);
				if (-1 === id) break;
				page[length] = id;
				length += 1;
				const next = readByte(cursor);
				segmentsSize -= 2;
				if (HEADER_ID === id) {
					page.write(CODEC_WORD, length, "latin1");
					length += CODEC_WORD.length;
					page[SEGMENT_TABLE_FIELD] =
						((page[SEGMENT_TABLE_FIELD] ?? 0) + 5) & 0xff;
					state = "comment";
				} else {
					page[length] = next & 0xff;
					length += 1;
					state = "broken";
				}
			} else if ("comment" === state) {
				const id = readByte(cursor);
				if (-1 === id) break;
				page[length] = id;
				length += 1;
				const next = readByte(cursor);
				segmentsSize -= 2;
				if (COMMENT_ID === id) {
					page.write(CODEC_WORD, length, "latin1");
					length += CODEC_WORD.length;
					const wanted = Math.max(0, (page[SEGMENT_TABLE_FIELD] ?? 0) - 2);
					const carved = readBytes(cursor, page, length, wanted);
					length += carved;
					segmentsSize -= carved;
					page[SEGMENT_TABLE_FIELD] =
						((page[SEGMENT_TABLE_FIELD] ?? 0) + 5) & 0xff;
					state = "setup";
					if (segmentsSize > 0) again = true;
				} else {
					page[length] = next & 0xff;
					length += 1;
					state = "broken";
				}
			} else if ("setup" === state) {
				const id = readByte(cursor);
				if (-1 === id) break;
				page[length] = id;
				length += 1;
				const next = readByte(cursor);
				segmentsSize -= 2;
				if (SETUP_ID === id) {
					page.write(CODEC_WORD, length, "latin1");
					length += CODEC_WORD.length;
					const last = SEGMENT_TABLE_FIELD + segmentCount - 1;
					page[last] = ((page[last] ?? 0) + 5) & 0xff;
					state = "payload";
				} else {
					page[length] = next & 0xff;
					length += 1;
					state = "broken";
				}
			}
		}
		const walked = readBytes(cursor, page, length, segmentsSize);
		length += walked;
		updatePageCrc(page, length);
		pages.push(Buffer.from(page.subarray(0, length)));
	}
	return Buffer.concat(pages);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The reference tells a sound of this engine by the name of the file, which has to be `g`. */
function hasGName(sourcePath: string | undefined): boolean {
	if (!sourcePath) return false;
	return sourcePath.toLowerCase().endsWith(`.${EXTENSION}`);
}

export const leafGAudioDescriptor: FormatDescriptor = {
	id: "leaf-g-audio",
	name: "Leaf audio format (Ogg/Vorbis)",
	extensions: [EXTENSION],
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
			source: "ArcFormats/Leaf/AudioG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const leafGAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafGAudioDescriptor,
	// The reference registers no word at all, only the name of the format, which its own catalog holds to.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!hasGName(sourcePath)) return false;
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readGAudioLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readGAudioLayout(stored, Number(source.size));
		if (!layout) throw invalidSound("Not a Leaf sound");
		if (stored.length > LIMIT)
			throw invalidSound("Leaf sound stands beyond what this project holds");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "ogg"),
				offset: BigInt(layout.pageOffset),
				size: source.size,
				compressed: true,
				metadata: { type: "audio" },
			}),
			// The pages of the sound are written afresh with the words of their codecs.
		};
		return { entries: [entry], metadata: { audio: "ogg", codec: "vorbis" } };
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readGAudioLayout(stored, Number(source.size));
		if (!layout) throw invalidSound("Not a Leaf sound");
		return Readable.from([decodeG(stored)]);
	},
});
