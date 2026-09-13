// Format reference: GARbro Legacy/Witch/ArcPCD.cs, class `ImageDataOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("IMAGEDATE ", "latin1");
const COUNT_FIELD = 0xa;
const INDEX_OFFSET = 0xe;
/** Every record starts with a 0x18 byte frame rectangle, then two length prefixed strings. */
const RECTANGLE_SIZE = 0x18;
const POSITION_FIELD = 8;
const LENGTH_FIELD_SIZE = 4;
const OFFSET_FIELD_SIZE = 4;
const FORMAT_FIELD = 0;
const UNPACKED_SIZE_FIELD = 4;
/** Payloads with a format id of one or two carry a 0x20 byte header. */
const PAYLOAD_HEADER_SIZE = 0x20;
const FRAME_NAME = "NO NAME";
const FULLWIDTH_SLASH = "\uFF0F";
const NAME_KEY = 0xff;
const FORMAT_NONE = 0;
const FORMAT_ZLIB = 1;
const FORMAT_BZIP2 = 2;
/** Reported for payloads that are too short to hold a format id. */
const FORMAT_UNKNOWN = -1;

interface PcdRecord {
	name: string;
	frameName: string;
	offset: bigint;
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
}

async function readBytes(
	source: ByteSource,
	offset: number,
	length: number,
): Promise<Buffer | undefined> {
	if (offset < 0 || length < 0) return undefined;
	if (BigInt(offset) + BigInt(length) > source.size) return undefined;
	return Buffer.from(await source.readAt(BigInt(offset), length));
}

/** Reads a length prefixed string whose bytes are complemented. */
async function readIndexString(
	source: ByteSource,
	position: number,
): Promise<{ value: string; end: number } | undefined> {
	const header = await readBytes(source, position, LENGTH_FIELD_SIZE);
	if (!header) return undefined;
	const length = header.readInt32LE(0);
	if (length <= 0) return undefined;
	const bytes = await readBytes(source, position + LENGTH_FIELD_SIZE, length);
	if (!bytes) return undefined;
	// `ImageDataOpener.DecryptName` complements every byte of both strings.
	for (let index = 0; index < bytes.length; index += 1)
		bytes[index] = (bytes[index] ?? 0) ^ NAME_KEY;
	const end = bytes.indexOf(0);
	return {
		value: decodeCp932(end === -1 ? bytes : bytes.subarray(0, end)),
		end: position + LENGTH_FIELD_SIZE + length,
	};
}

/**
 * GARbro `ImageDataOpener.TryOpen`. The archive keeps a list of frames, each with a rectangle, a name, an
 * optional frame name and the offset of its payload. Sizes are not stored: a frame ends where the next one
 * begins and the last one reaches to the end of the file.
 */
async function readPcdIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	const header = await readBytes(source, 0, INDEX_OFFSET);
	if (!header?.subarray(0, SIGNATURE.length).equals(SIGNATURE))
		return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const records: PcdRecord[] = [];
	let position = INDEX_OFFSET;
	for (let id = 0; id < count; id += 1) {
		const rectangle = await readBytes(source, position, RECTANGLE_SIZE);
		if (!rectangle) return undefined;
		const left = rectangle.readInt32LE(POSITION_FIELD);
		const top = rectangle.readInt32LE(POSITION_FIELD + 4);
		const right = rectangle.readInt32LE(POSITION_FIELD + 8);
		const bottom = rectangle.readInt32LE(POSITION_FIELD + 12);
		position += RECTANGLE_SIZE;
		const name = await readIndexString(source, position);
		if (!name) return undefined;
		position = name.end;
		const frame = await readIndexString(source, position);
		if (!frame) return undefined;
		position = frame.end;
		const offsetField = await readBytes(source, position, OFFSET_FIELD_SIZE);
		if (!offsetField) return undefined;
		const offset = BigInt(offsetField.readUInt32LE(0));
		position += OFFSET_FIELD_SIZE;
		if (offset > source.size) return undefined;
		records.push({
			name: name.value,
			frameName: frame.value,
			offset,
			width: (right - left) >>> 0,
			height: (bottom - top) >>> 0,
			offsetX: left,
			offsetY: top,
		});
	}
	if (records.length === 0) return undefined;

	const entries: FixedEntry[] = [];
	for (const [id, record] of records.entries()) {
		const adjacent =
			id + 1 === records.length
				? source.size - record.offset
				: (records[id + 1]?.offset ?? 0n) - record.offset;
		if (adjacent <= 0n) return undefined;
		const probe = await readBytes(
			source,
			Number(record.offset),
			Number(
				adjacent < BigInt(PAYLOAD_HEADER_SIZE)
					? adjacent
					: BigInt(PAYLOAD_HEADER_SIZE),
			),
		);
		if (!probe) return undefined;
		const formatId =
			probe.length >= 8 ? probe.readUInt32LE(FORMAT_FIELD) : FORMAT_UNKNOWN;
		const path =
			record.frameName === FRAME_NAME
				? record.name
				: `${record.name}/${record.frameName.replaceAll("/", FULLWIDTH_SLASH)}`;
		const metadata = {
			type: "image",
			formatId,
			width: record.width,
			height: record.height,
			offsetX: record.offsetX,
			offsetY: record.offsetY,
		};
		if (formatId === FORMAT_NONE) {
			if (adjacent < BigInt(PAYLOAD_HEADER_SIZE)) return undefined;
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(path),
					offset: record.offset + BigInt(PAYLOAD_HEADER_SIZE),
					size: adjacent - BigInt(PAYLOAD_HEADER_SIZE),
					metadata,
				}),
			);
			continue;
		}
		if (formatId === FORMAT_ZLIB || formatId === FORMAT_BZIP2) {
			if (adjacent < BigInt(PAYLOAD_HEADER_SIZE)) return undefined;
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(path),
					offset: record.offset + BigInt(PAYLOAD_HEADER_SIZE),
					size: BigInt(probe.readUInt32LE(UNPACKED_SIZE_FIELD)),
					packedSize: adjacent - BigInt(PAYLOAD_HEADER_SIZE),
					compressed: true,
					metadata,
				}),
			);
			continue;
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(path),
				offset: record.offset,
				size: adjacent,
				metadata,
			}),
		);
	}
	return entries;
}

export const pcdImageDescriptor: FormatDescriptor = {
	id: "witch-pcd",
	name: "Witch images archive",
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
			source: "Legacy/Witch/ArcPCD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pcdImageFormat = defineFixedArchive({
	descriptor: pcdImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPcdIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readPcdIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Witch PCD layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	/** `ImageDataOpener.OpenEntry`: format zero drops the header, format one inflates, two is unsupported. */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const formatId = Number(entry.metadata?.formatId ?? FORMAT_UNKNOWN);
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (formatId === FORMAT_ZLIB)
			return Readable.from([inflateZlibBuffer(stored, Number(entry.size))]);
		if (formatId === FORMAT_BZIP2)
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"Witch PCD bzip2 payloads are not supported",
			);
		return Readable.from([stored]);
	},
});
