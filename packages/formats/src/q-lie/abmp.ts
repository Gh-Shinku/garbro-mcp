// Format reference: GARBro ArcFormats/Qlie/ArcABMP.cs, classes `AbmpOpener`, `Abmp7Opener` and `AbmpReader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decompressQliePack } from "@garbro-mcp/codecs";
import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "b";
/** The version word is two digits, one per byte, offset by a fixed constant. */
const VERSION_MAJOR_OFFSET = 4;
const VERSION_MINOR_OFFSET = 5;
const VERSION_DIGIT_BIAS = 11;
const VERSION_MINIMUM = 10;
const VERSION_MAXIMUM = 12;
const ZERO_OFFSET = 6;
/** The index begins behind the head and every record is tagged with a sixteen-byte name. */
const INDEX_OFFSET = 0x10;
const TAG_SIZE = 0x10;
/** A payload obfuscated by the sibling pack format starts with this word. */
const PACK_MARKER = 0xff435031;
/** Invalid characters in a stored name become underscores. */
const INVALID_NAME_CHARS = /[:/\\*?]/g;
const NAME_REPLACEMENT = "_";
/** Generated names count entries off. */
const GENERATED_NAME_DIGITS = 0;
/** Tags that carry a UTF-16 name and a version-dependent trailer. */
const IMAGE_DATA_TAG = "abimgdat15";
const SOUND_DATA_TAG = "absnddat12";
/** Image tags whose trailer is shortened, and two whose own trailer is longer. */
const IMAGE_TRAILER_OFFSETS = new Map<string, number>([
	["abimgdat13", 0x0c],
	["abimgdat14", 0x4c],
]);
/** Version two of an image sub-record carries a longer trailer. */
const IMAGE_DATA_VERSION_TWO = 2;
const IMAGE_DATA_OFFSET_V2 = 0x1d;
const IMAGE_DATA_OFFSET_V1 = 0x11;
/** A sound sub-record skips this many bytes of trailer. */
const SOUND_DATA_TRAILER = 7;
/** Bytes outside this range make a tag unprintable and therefore unknown. */
const PRINTABLE_MINIMUM = 0x20;
const PRINTABLE_MAXIMUM = 0x7e;

/** The seven-byte entry tag types in the head. */
const DATA_TAG = "abdata";
const IMAGE_TAG = "abimage10";
const SOUND_TAG = "absound10";
/** A record is tagged with sixteen bytes. */
const TAG_LOOKAHEAD = 0x10;
/** Version seven keeps its head at 0x0C and its frames behind a size word each. */
const V7_FIRST_SIZE_OFFSET = 0x0c;
const V7_FRAME_HEADER = 4;
const V7_GENERATED_NAME_DIGITS = 0;

const ATTRIBUTION = [
	{
		project: "GARbro",
		source: "ArcFormats/Qlie/ArcABMP.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
] as const;

export const abmpDescriptor: FormatDescriptor = {
	id: "qlie-abmp",
	name: "QLIE engine multi-frame archive",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

export const abmp7Descriptor: FormatDescriptor = {
	id: "qlie-abmp7",
	name: "QLIE engine multi-frame image archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

/** GARbro's `GetTypeName`: the tag's printable ASCII prefix, or a placeholder. */
function typeName(tag: Buffer): string {
	let length = 0;
	while (length < tag.length) {
		const byte = tag[length] ?? 0;
		if (byte === 0) break;
		if (byte < PRINTABLE_MINIMUM || byte > PRINTABLE_MAXIMUM) return "unknown";
		length += 1;
	}
	if (length === 0) return "";
	return tag.toString("ascii", 0, length).trim();
}

/** Reads a null-terminated tag out of a sixteen-byte field. */
function readTag(field: Buffer): string {
	const terminator = field.indexOf(0);
	return (terminator === -1 ? field : field.subarray(0, terminator)).toString(
		"ascii",
	);
}

/** The type a record's tag implies, which the reference infers from its prefix. */
function tagType(tag: string): string | undefined {
	if (tag.startsWith("abimg")) return "image";
	if (tag.startsWith("absnd")) return "audio";
	return undefined;
}

/** Builds an entry, applying the reference's name sanitisation and its optional content probe. */
function buildEntry(
	id: number,
	name: string,
	tag: string,
	offset: bigint,
	size: bigint,
	sanitize: boolean,
): FixedEntry {
	const cleaned = sanitize
		? name.replace(INVALID_NAME_CHARS, NAME_REPLACEMENT)
		: name;
	const type = tagType(tag);
	const entry = createFixedEntry({
		id,
		...normalizeEntryPath(cleaned),
		offset,
		size,
		...(type === undefined ? {} : { metadata: { inferredType: type } }),
	});
	return entry;
}

/**
 * GARBro `AbmpReader.ReadIndex`. The head is eight bytes wide and the index begins at 0x10, where sixteen-byte
 * tags are read until one comes up short. Three tag kinds are understood:
 *
 * `abdata` is a plain payload whose size follows the tag, named from the archive with a running number and a
 * `.dat` extension. `abimage10` and `absound10` are containers: a count byte then that many sub-records, each
 * with its own tag. The sub-records differ in their name and trailer layout — two carry UTF-16 names with
 * version-dependent trailers, and the rest a length-prefixed name whose trailers vary by tag. Any other tag
 * makes a single entry that runs to the end of the file, named from the archive, a running number and the tag's
 * printable prefix, or `unknown` when the tag holds unprintable bytes.
 *
 * A stored name whose characters are invalid in a path has them replaced with underscores, an entry with no
 * name gets a generated one, and a sub-record that declares no size contributes nothing at all. Payloads whose
 * first word is the sibling pack format's marker are expanded, and everything else is emitted verbatim.
 */
async function readAbmpIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const version =
		(header.readUInt8(VERSION_MAJOR_OFFSET) * 10 +
			header.readUInt8(VERSION_MINOR_OFFSET) -
			0x30 * VERSION_DIGIT_BIAS) |
		0;
	if (header.readUInt8(ZERO_OFFSET) !== 0) return undefined;
	if (version < VERSION_MINIMUM || version > VERSION_MAXIMUM) return undefined;

	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	let position = BigInt(INDEX_OFFSET);
	let counter = 0;
	for (;;) {
		if (position + BigInt(TAG_SIZE) > source.size) break;
		const tag = await source.readAt(position, TAG_SIZE);
		position += BigInt(TAG_SIZE);
		const tagText = readTag(tag);
		if (tagText === DATA_TAG) {
			if (position + 4n > source.size) break;
			const size = BigInt((await source.readAt(position, 4)).readUInt32LE(0));
			position += 4n;
			if (position + size > source.size) return undefined;
			entries.push(
				buildEntry(
					entries.length,
					`${baseName}#${counter}.dat`,
					"",
					position,
					size,
					false,
				),
			);
			counter += 1;
			position += size;
			continue;
		}
		if (tagText === IMAGE_TAG || tagText === SOUND_TAG) {
			if (position + 1n > source.size) break;
			const count = (await source.readAt(position, 1)).readUInt8(0);
			position += 1n;
			for (let index = 0; index < count; index += 1) {
				if (position + BigInt(TAG_SIZE) > source.size) break;
				const subTag = await source.readAt(position, TAG_SIZE);
				position += BigInt(TAG_SIZE);
				if (subTag.length !== TAG_SIZE) break;
				const subText = readTag(subTag);
				let name: string | undefined;
				if (subText === IMAGE_DATA_TAG) {
					if (position + 6n > source.size) return undefined;
					const sub = await source.readAt(position, 6);
					const dataVersion = sub.readInt32LE(0);
					const wideLength = sub.readUInt16LE(4);
					position += 6n;
					if (wideLength > 0) {
						if (position + BigInt(wideLength * 2) > source.size)
							return undefined;
						name = (await source.readAt(position, wideLength * 2)).toString(
							"utf16le",
						);
						position += BigInt(wideLength * 2);
					}
					if (position + 2n > source.size) return undefined;
					const narrowLength = (await source.readAt(position, 2)).readUInt16LE(
						0,
					);
					position += 2n;
					if (narrowLength > 0) {
						if (name === undefined || name.length === 0) {
							if (position + BigInt(narrowLength) > source.size)
								return undefined;
							name = decodeCp932(
								await source.readAt(position, narrowLength),
							).replace(/\0.*$/, "");
							position += BigInt(narrowLength);
						} else {
							position += BigInt(narrowLength);
						}
					}
					if (position + 1n > source.size) return undefined;
					position += 1n;
					position += BigInt(
						dataVersion === IMAGE_DATA_VERSION_TWO
							? IMAGE_DATA_OFFSET_V2
							: IMAGE_DATA_OFFSET_V1,
					);
				} else if (subText === SOUND_DATA_TAG) {
					if (position + 6n > source.size) return undefined;
					const sub = await source.readAt(position, 6);
					const wideLength = sub.readUInt16LE(4);
					position += 6n;
					if (wideLength > 0) {
						if (position + BigInt(wideLength * 2) > source.size)
							return undefined;
						name = (await source.readAt(position, wideLength * 2)).toString(
							"utf16le",
						);
						position += BigInt(wideLength * 2);
					}
					if (source.size - position <= BigInt(SOUND_DATA_TRAILER)) break;
					position += BigInt(SOUND_DATA_TRAILER);
				} else {
					if (position + 2n > source.size) return undefined;
					const narrowLength = (await source.readAt(position, 2)).readUInt16LE(
						0,
					);
					position += 2n;
					if (position + BigInt(narrowLength) > source.size) return undefined;
					name = decodeCp932(
						await source.readAt(position, narrowLength),
					).replace(/\0.*$/, "");
					position += BigInt(narrowLength);
					if (subText !== "abimgdat10" && subText !== "absnddat10") {
						if (position + 2n > source.size) return undefined;
						const skipped = (await source.readAt(position, 2)).readUInt16LE(0);
						position += 2n + BigInt(skipped);
						position += BigInt(IMAGE_TRAILER_OFFSETS.get(subText) ?? 0);
					}
					if (position + 1n > source.size) return undefined;
					position += 1n;
				}

				if (position + 4n > source.size) return undefined;
				const size = BigInt((await source.readAt(position, 4)).readUInt32LE(0));
				position += 4n;
				if (size !== 0n) {
					if (position + size > source.size) return undefined;
					const generated =
						name === undefined || name.length === 0
							? `${baseName}#${counter}`
							: name;
					if (name === undefined || name.length === 0) counter += 1;
					if (checkPlacement(position, size, source.size)) {
						entries.push(
							buildEntry(
								entries.length,
								generated,
								subText,
								position,
								size,
								true,
							),
						);
					}
				}
				position += size;
			}
			continue;
		}
		// An unknown tag makes one entry that runs to the end of the file.
		const size = source.size - position;
		if (size <= 0n) break;
		entries.push(
			buildEntry(
				entries.length,
				`${baseName}#${counter}#${typeName(tag)}`,
				"",
				position,
				size,
				false,
			),
		);
		counter += 1;
		position += size;
	}
	return entries;
}

/**
 * GARBro `Abmp7Opener.TryOpen`. Version seven announces itself with the digit `7` in its version word, keeps no
 * tag table and instead stores frames behind a size word each: the word at 0x0C gives the first frame's size and
 * the frame follows it, and every later frame repeats that shape. A zero size ends the list, and a frame whose
 * span leaves the file breaks it rather than rejecting the archive, so the entries found so far stand. The first
 * frame is named with a `.dat` extension and the rest without one, and only the later ones are classified as
 * images.
 */
async function readAbmp7Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(V7_FIRST_SIZE_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, V7_FIRST_SIZE_OFFSET + 4);
	if (header.readUInt16LE(4) !== 0x37) return undefined;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	let position = BigInt(V7_FIRST_SIZE_OFFSET);
	const firstSize = BigInt(header.readUInt32LE(V7_FIRST_SIZE_OFFSET));
	position += 4n;
	if (!checkPlacement(position, firstSize, source.size)) return undefined;
	const entries: FixedEntry[] = [
		buildEntry(
			0,
			`${baseName}#${V7_GENERATED_NAME_DIGITS}.dat`,
			"",
			position,
			firstSize,
			false,
		),
	];
	position += firstSize;
	let counter = 1;
	while (position < source.size) {
		if (position + 4n > source.size) break;
		const size = BigInt((await source.readAt(position, 4)).readUInt32LE(0));
		if (size === 0n) break;
		position += 4n;
		if (!checkPlacement(position, size, source.size)) break;
		entries.push(
			buildEntry(
				entries.length,
				`${baseName}#${counter}`,
				"abimg",
				position,
				size,
				false,
			),
		);
		counter += 1;
		position += size;
	}
	return entries;
}

/** GARBro `AbmpOpener.OpenEntry`: marked payloads go through the sibling pack codec, others are stored. */
async function openAbmpEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = await source.readAt(entry.offset, Number(entry.size));
	if (stored.length < 4 || stored.readUInt32LE(0) !== PACK_MARKER)
		return Readable.from([stored]);
	try {
		return Readable.from([decompressQliePack(stored)]);
	} catch {
		// The reference falls back to the stored bytes when its decompressor refuses the payload.
		return Readable.from([stored]);
	}
}

export const abmpFormat: ArchiveFormat = defineFixedArchive({
	descriptor: abmpDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("abmp", "ascii") }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAbmpIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAbmpIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid QLIE ABMP layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openAbmpEntry,
});

export const abmp7Format: ArchiveFormat = defineFixedArchive({
	descriptor: abmp7Descriptor,
	detection: { signatures: [{ bytes: Buffer.from("ABMP", "ascii") }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAbmp7Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAbmp7Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid QLIE ABMP7 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openAbmpEntry,
});
