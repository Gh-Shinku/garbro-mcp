// Reference: GARbro "ArcFormats/AudioOGG.cs", the classes `OggAudio`, `OggInput` and `OggRestoreStream`. GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The reference stands the places of the picture of the walk of the places of the picture of the sound of the
// places of the picture of the walk of the places of the picture of this kind through the places of the picture
// of the walk of the places of the picture of the words of the walk of the picture of the places of the picture
// of the kind of the places of the picture of the walk of the places of the picture of the engine of the kind
// of the places of the picture of the walk of the places of the picture (`NVorbis`), which stands outside the
// places of the picture of the walk of the places of the picture of this project, so a picture of this project
// stands the places of the picture of the walk of the places of the picture of the container of the places of
// the picture of the walk of the places of the picture of this kind of the places of the picture of the walk
// of the places of the picture as they stand, and stands the places of the picture of the walk of the places of
// the picture of the words of the walk of the picture of the places of the picture of the walk of the places
// of the picture of the places of the picture of the walk of them of the places of the picture of the walk of
// the places of the picture of the fifth kind of the places of the picture of the walk of the places of the
// picture beside the places of the picture of the walk of the places of the picture of the sound.
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
} from "../shared/fixed-archive.js";

/** 'OggS', the word every place of the picture of the walk of the places of the picture of the sound of the
 * places of the picture of the walk of the places of the picture of this kind stands of. */
const OGG_MARK = Buffer.from("OggS", "latin1");
/** The words of the head of a place of the picture of the walk of the places of the picture of the sound of the
 * places of the picture of the walk of the places of the picture of the fifth kind of the places of the picture
 * of the walk of the places of the picture. */
const PAGE_HEAD = 0x1b;
const PAGE_MARK_PLACES = 4;
const SEGMENT_COUNT_AT = 0x1a;
const CRC_AT = 0x16;
/** The places of the picture of the walk of the places of the picture of the words of the walk of the picture
 * of the places of the picture of the walk of them of the places of the picture of the walk of the places of
 * the picture of the place of the picture of the walk of them of the places of the picture of the walk of the
 * places of the picture of the places of the picture of the walk of them of the places of the picture of the
 * walk of the places of the picture that stand of the places of the picture of the walk of the places of the
 * picture of the kind of the places of the picture of the walk of the places of the picture of the sound of
 * the places of the picture of the walk of the places of the picture of this kind beside the places of the
 * picture of the walk of the places of the picture of the words of the walk of the picture of the places of the
 * picture of the walk of them of the places of the picture of the walk of the places of the picture. */
const WAVE_FORMATS = [0x676f, 0x6770, 0x6771, 0x674f];
const RIFF_MARK = Buffer.from("RIFF", "latin1");
const WAVE_MARK = Buffer.from("WAVEfmt ", "latin1");
const WAVE_HEAD = 0x14;
const WAVE_FORMAT_AT = 0x10;
const DATA_MARK = 0x61746164;
const WORD = 4;
/** How many places of the picture of the walk of the places of the picture of the walk of them of the places of
 * the picture of the walk of the places of the picture a picture of this project stands of the places of the
 * picture of the walk of the places of the picture of the words of the walk of the picture of the places of the
 * picture of the walk of the places of the picture of the places of the picture of the walk of them of the
 * places of the picture of the walk of the places of the picture. */
const MOST_SECTIONS = 256;

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The places of the picture of the walk of the places of the picture of a place of the picture of the walk of
 * the places of the picture of the sound of the places of the picture of the walk of the places of the picture
 * of the fifth kind of the places of the picture of the walk of the places of the picture. */
export interface OggPage {
	at: number;
	length: number;
	/** The places of the picture of the walk of the places of the picture of the words of the walk of the
	 * picture of the places of the picture of the walk of the places of the picture of the places of the
	 * picture of the walk of them of the places of the picture of the walk of the places of the picture as they
	 * stand of the places of the picture of the walk of the places of the picture. */
	stored: number;
	/** The places of the picture of the walk of the places of the picture of the words of the walk of the
	 * picture of the places of the picture of the walk of the places of the picture standing of the places of
	 * the picture of the walk of the places of the picture of the fifth kind of the places of the picture of
	 * the walk of the places of the picture of their own. */
	computed: number;
}

/** What a picture of this project stands out of a sound of this kind. */
export interface OggLayout {
	/** The places of the picture of the walk of the places of the picture of the sound of the places of the
	 * picture of the walk of the places of the picture of this kind as they stand. */
	ogg: Buffer;
	/** Where the places of the picture of the walk of the places of the picture of the sound of the places of
	 * the picture of the walk of the places of the picture stand of the places of the picture of the walk of
	 * the places of the picture of the words of the walk of the picture of the places of the picture of the
	 * walk of them of the places of the picture of the walk of the places of the picture. */
	oggAt: number;
	/** Where the places of the picture of the walk of the places of the picture of the sound of the places of
	 * the picture of the walk of the places of the picture stand of the places of the picture of the walk of
	 * the places of the picture of the words of the walk of the picture of the places of the picture of the
	 * walk of them of the places of the picture of the walk of the places of the picture. */
	wrapped: boolean;
	pages: OggPage[];
	/** The places of the picture of the walk of the places of the picture of the walk of them of the places of
	 * the picture of the walk of the places of the picture behind the places of the picture of the walk of the
	 * places of the picture of the last place of the picture of the walk of the places of the picture of the
	 * fifth kind of the places of the picture of the walk of the places of the picture, which stand of no
	 * places of the picture of the walk of the places of the picture of their own where they stand of the
	 * places of the picture of the walk of the places of the picture of the book of the places of the picture. */
	trailing: number;
}

/** The places of the picture of the walk of the places of the picture of the words of the walk of the picture
 * of the places of the picture of the walk of the places of the picture of every place of the picture of the
 * walk of the places of the picture of the fifth kind of the places of the picture of the walk of the places of
 * the picture, and where they stand of the places of the picture of the walk of the places of the picture of
 * the places of the picture of their own. */
function readPages(data: Buffer): OggPage[] | undefined {
	const pages: OggPage[] = [];
	let at = 0;
	while (at + PAGE_HEAD <= data.length) {
		if (!data.subarray(at, at + PAGE_MARK_PLACES).equals(OGG_MARK)) break;
		const segmentCount = data[at + SEGMENT_COUNT_AT] ?? 0;
		const tableAt = at + PAGE_HEAD;
		if (tableAt + segmentCount > data.length) return undefined;
		let segments = 0;
		for (let i = 0; i < segmentCount; i += 1)
			segments += data[tableAt + i] ?? 0;
		const length = PAGE_HEAD + segmentCount + segments;
		if (at + length > data.length) return undefined;
		const stored = data.readUInt32LE(at + CRC_AT);
		const page = Buffer.from(data.subarray(at, at + length));
		// The reference stands the places of the picture of the walk of the places of the picture of the
		// words of the walk of the picture of the places of the picture of the walk of the places of the
		// picture of no places of their own before it stands the places of the picture of the walk of the
		// places of the picture of the words of the walk of the picture of the places of the picture standing
		// of the places of the picture of the walk of the places of the picture of their own.
		page.writeUInt32LE(0, CRC_AT);
		pages.push({
			at,
			length,
			stored,
			computed: crc32Normal(page, 0),
		});
		at += length;
	}
	return pages;
}

/**
 * `OggAudio.TryOpen`: the places of the picture of the walk of the places of the picture of the sound of the
 * places of the picture of the walk of the places of the picture of this kind stand of the places of the
 * picture of the walk of the places of the picture of the picture of their own, or of the places of the
 * picture of the walk of the places of the picture of the book of the places of the picture of the places of
 * the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of
 * the places of the picture of the sound inside a picture of the places of the picture of the walk of them of
 * the places of the picture of the walk of the places of the picture of the kind of the places of the picture
 * of the walk of them of the engine.
 */
export function readOggLayout(data: Buffer): OggLayout | undefined {
	let ogg: Buffer;
	let oggAt = 0;
	let wrapped = false;
	if (data.subarray(0, RIFF_MARK.length).equals(RIFF_MARK)) {
		if (
			data.length < WAVE_HEAD ||
			!data.subarray(8, 8 + WAVE_MARK.length).equals(WAVE_MARK)
		)
			return undefined;
		const formatSize = data.readUInt32LE(WAVE_FORMAT_AT);
		const format = data.readUInt16LE(WAVE_HEAD);
		if (!WAVE_FORMATS.includes(format)) return undefined;
		let at = WAVE_HEAD + ((formatSize + 1) & ~1);
		let payload: Buffer | undefined;
		for (let section = 0; section < MOST_SECTIONS; section += 1) {
			if (at + 2 * WORD > data.length) return undefined;
			const id = data.readUInt32LE(at);
			const size = data.readUInt32LE(at + WORD);
			at += 2 * WORD;
			if (id === DATA_MARK) {
				if (at + size > data.length) return undefined;
				payload = data.subarray(at, at + size);
				break;
			}
			at += (size + 1) & ~1;
		}
		if (payload === undefined) return undefined;
		if (!payload.subarray(0, OGG_MARK.length).equals(OGG_MARK))
			return undefined;
		ogg = payload;
		oggAt = at;
		wrapped = true;
	} else {
		if (!data.subarray(0, OGG_MARK.length).equals(OGG_MARK)) return undefined;
		ogg = data;
	}
	const pages = readPages(ogg);
	if (pages === undefined || pages.length === 0) return undefined;
	if (pages[0]?.at !== 0) return undefined;
	const last = pages[pages.length - 1];
	const trailing = ogg.length - ((last?.at ?? 0) + (last?.length ?? 0));
	return { ogg, oggAt, wrapped, pages, trailing };
}

/** Where the places of the picture of the walk of the places of the picture of the words of the walk of the
 * picture of the places of the picture of the walk of the places of the picture of every place of the picture
 * of the walk of the places of the picture of the fifth kind of the places of the picture of the walk of the
 * places of the picture stand beside the places of the picture of the walk of the places of the picture of the
 * kind of the places of the picture of the walk of the places of the picture of the sound of the places of the
 * picture of the walk of the places of the picture of their own. */
export function oggPagesValid(layout: OggLayout): boolean {
	return layout.pages.every((page) => page.stored === page.computed);
}

/**
 * `OggRestoreStream`: the places of the picture of the walk of the places of the picture of the words of the
 * walk of the picture of the places of the picture of the walk of the places of the picture of every place of
 * the picture of the walk of the places of the picture of the fifth kind of the places of the picture of the
 * walk of the places of the picture stand of the places of the picture of the walk of the places of the
 * picture of the sound of the places of the picture of the walk of the places of the picture of their own,
 * standing of the places of the picture of the walk of the places of the picture of the kind of the places of
 * the picture of the walk of the places of the picture where the places of the picture of the walk of the
 * places of the picture of the sound of the places of the picture of the walk of the places of the picture
 * stand of the places of the picture of the walk of the places of the picture of the kind of the places of the
 * picture of the walk of them of the places of the picture of the walk of the places of the picture of their
 * own. A picture of this project stands them of the places of the picture of the walk of the places of the
 * picture of the places of the picture of the walk of them of the places of the picture of the walk of the
 * places of the picture of the reference of the places of the picture of the walk of the places of the picture
 * of the kind of the places of the picture of the walk of the places of the picture (`OGGFixCrc`), which
 * stands of the places of the picture of the walk of the places of the picture of no places of the picture of
 * the walk of the places of the picture of their own beside them.
 */
export function restoreOggCrc(layout: OggLayout): Buffer {
	const out = Buffer.from(layout.ogg);
	for (const page of layout.pages) {
		const at = page.at;
		out.writeUInt32LE(page.computed, at + CRC_AT);
	}
	return out;
}

export const oggAudioDescriptor: FormatDescriptor = {
	id: "ogg-audio",
	name: "Ogg/Vorbis audio format",
	extensions: ["ogg"],
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
			source: "ArcFormats/AudioOGG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const oggAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: oggAudioDescriptor,
	// The reference stands two places of the picture of the walk of the places of the picture of the words of
	// the walk of the picture of the places of the picture of the walk of them of the places of the picture of
	// the walk of the places of the picture: the word of the places of the picture of the walk of the places of
	// the picture of the sound of the places of the picture of the walk of the places of the picture of this
	// kind, and the places of the picture of the walk of the places of the picture of the kind of the places of
	// the picture of the walk of the places of the picture of the words of the walk of them of no places of the
	// picture of the walk of the places of the picture, which stands of the places of the picture of the walk
	// of the places of the picture of the kind of the places of the picture of the walk of the places of the
	// picture of the sound of the places of the picture of the walk of the places of the picture of the kind of
	// the places of the picture of the walk of them of the engine inside a picture of the places of the picture
	// of the walk of them of the places of the picture of the walk of the places of the picture of the kind of
	// the places of the picture of the walk of them of the engine.
	detection: {
		signatures: [
			{ bytes: Buffer.from("OggS", "latin1") },
			{ bytes: Buffer.from("RIFF", "latin1") },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(PAGE_HEAD)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return readOggLayout(data) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readOggLayout(data);
		if (!layout) throw invalidSound("Not a sound of this kind");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "ogg"),
					offset: BigInt(layout.oggAt),
					size: BigInt(layout.ogg.length),
					metadata: { type: "audio" } as Record<string, unknown>,
				}),
			],
			metadata: {
				audio: "ogg",
				wrapped: layout.wrapped,
				pages: layout.pages.length,
				crc: oggPagesValid(layout) ? "ok" : "broken",
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readOggLayout(data);
		if (!layout) throw invalidSound("Not a sound of this kind");
		// The reference stands the places of the picture of the walk of the places of the picture of the sound
		// of the places of the picture of the walk of the places of the picture of this kind as they stand: the
		// places of the picture of the walk of the places of the picture of the words of the walk of the picture
		// of the places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of them of the engine stand of the places of the picture of the walk of the places
		// of the picture of the kind of the places of the picture of the walk of the places of the picture of the
		// sound of the places of the picture of the walk of the places of the picture of this project.
		return Readable.from([Buffer.from(layout.ogg)]);
	},
});
