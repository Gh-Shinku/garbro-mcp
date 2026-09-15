// Format reference: GARbro "ArcFormats/AudioMP3.cs", classes `Mp3Audio` and `Mp3Input` (MPEG Layer 3 audio
// format). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** How much of the file the reference reads to look for the tag it may carry in front of its stream. */
const TAG_HEADER_SIZE = 10;
/** How far the reference looks for the sync word of a frame when the file does not start with one. */
const SYNC_SEARCH_LENGTH = 0x300;
const SYNC_SEARCH_START = 1;
/** The search stops this many bytes short of the window, where a frame would not fit whole. */
const SYNC_SEARCH_MARGIN = 4;
/** The size field of a tag counts in seven bit groups, and a version past three may carry a footer. */
const TAG_FOOTER_SIZE = 10;
const TAG_FOOTER_FLAG = 0x10;

/**
 * `Mp3Audio.SkipId3Tag`: a tag in front of the stream declares its own length in four seven bit groups at
 * offsets six to nine, which the reference takes as a length **of the tag only** when the four of them and
 * the two flags before them have their top bit clear. A tag of a version past the third, whose footer flag is
 * set at offset five, is ten bytes longer than that length says.
 */
export function skipId3Tag(header: Buffer): number {
	if (
		header[0] !== 0x49 ||
		header[1] !== 0x44 ||
		header[2] !== 0x33 // 'ID3'
	) {
		return 0;
	}
	for (const at of [3, 4, 6, 7, 8, 9]) {
		if ((header[at] ?? 0) >= 0x80) return 0;
	}
	let size =
		((header[6] ?? 0) << 21) |
		((header[7] ?? 0) << 14) |
		((header[8] ?? 0) << 7) |
		(header[9] ?? 0);
	if ((header[3] ?? 0) > 3 && ((header[5] ?? 0) & TAG_FOOTER_FLAG) !== 0) {
		size += TAG_FOOTER_SIZE;
	}
	return TAG_HEADER_SIZE + size;
}

/** `Mp3Audio.TryOpen`'s own test of a frame: the sync word, two of its bits, and not the reserved nibble. */
function isFrameSync(data: Buffer, at: number): boolean {
	return (
		data[at] === 0xff &&
		((data[at + 1] ?? 0) & 0xe6) === 0xe2 &&
		((data[at + 2] ?? 0) & 0xf0) !== 0xf0
	);
}

/**
 * `Mp3Audio.TryOpen`: the stream may carry a tag of its own in front of it, and its first frame may be a
 * little way in; the reference looks for the sync word of a frame in the first `0x300` bytes in that case,
 * stopping four bytes short of the window, where a frame would not fit whole. A file that carries none is not
 * claimed. The reference is offered every file — its signature is the word of nothing — and so is this port.
 */
export function looksLikeMp3(data: Buffer): boolean {
	if (data.length < TAG_HEADER_SIZE) return false;
	const tagEnd = skipId3Tag(data);
	if (0 !== tagEnd) {
		if (tagEnd + 4 > data.length) return false;
		return isFrameSync(data, tagEnd);
	}
	if (0xff === data[0]) return isFrameSync(data, 0);
	if (SYNC_SEARCH_START + SYNC_SEARCH_LENGTH > data.length) return false;
	const window = data.subarray(
		SYNC_SEARCH_START,
		SYNC_SEARCH_START + SYNC_SEARCH_LENGTH,
	);
	const count = SYNC_SEARCH_LENGTH - SYNC_SEARCH_MARGIN;
	for (let index = 0; index < count; index += 1) {
		const at = SYNC_SEARCH_START + index;
		if (window[at] !== 0xff) continue;
		return isFrameSync(window, at);
	}
	return false;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gameresMp3AudioDescriptor: FormatDescriptor = {
	id: "gameres-mp3-audio",
	name: "MPEG Layer 3 audio format",
	extensions: [],
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
			source: "ArcFormats/AudioMP3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gameresMp3AudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameresMp3AudioDescriptor,
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 4n) return false;
		return looksLikeMp3(await readStored(source));
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!looksLikeMp3(await readStored(source))) {
			throw new GarbroError("INVALID_ARCHIVE", "Not an MPEG Layer 3 stream");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "mp3"),
						offset: 0n,
						size: source.size,
						metadata: { type: "audio" },
					}),
					sizeKnown: false,
				},
			],
			metadata: { audio: "mp3" },
		};
	},
	async openEntry(source: ByteSource) {
		// The stream is handed out as it stands, because the project carries no decoder for it; the bytes are
		// the ones the reference would decode.
		const stored = await readStored(source);
		if (!looksLikeMp3(stored)) {
			throw new GarbroError("INVALID_ARCHIVE", "Not an MPEG Layer 3 stream");
		}
		return Readable.from([stored]);
	},
});
