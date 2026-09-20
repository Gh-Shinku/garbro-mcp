import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("CPB\x1a", "latin1");
const HEAD_SIZE = 0x20;
const TYPE_FIELD = 4;
const BPP_FIELD = 5;
const VERSION_FIELD = 6;
/** The places of a picture of a kind of its own behind the words of the head. */
const BITS_PER_PLACE_24 = 24;
const BITS_PER_PLACE_32 = 32;
const PLACES_PER_PLACE = 4;
const RECORDS = 4;
const WALK_HEAD_SIZE = 0x14;
const WALK_COUNT_FIELD = 4;
const WALK_PLACES_FIELD = 8;
const WALK_UNPACKED_FIELD = 0x10;
const WALK_START_MASK = 0x80;
const WALK_MATCH_BITS = 13;
const WALK_MATCH_LEAST = 3;
const RECORD_CRC_SIZE = 4;
const LIMIT = 256 * 1024 * 1024;

export interface CpbLayout {
	type: number;
	version: number;
	bitsPerPixel: number;
	width: number;
	height: number;
	channels: readonly number[];
	dataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readCpbLayout(
	data: Buffer,
	fileLength = data.length,
): CpbLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const type = data[TYPE_FIELD] ?? 0;
	const bitsPerPixel = data[BPP_FIELD] ?? 0;
	if (bitsPerPixel !== BITS_PER_PLACE_24 && bitsPerPixel !== BITS_PER_PLACE_32)
		return undefined;
	const version = data.readInt16LE(VERSION_FIELD);
	if (version !== 0 && version !== 1) return undefined;
	const channels: number[] = [];
	let width: number;
	let height: number;
	if (version === 1) {
		width = data.readUInt16LE(0xc);
		height = data.readUInt16LE(0xe);
		for (let at = 0; at < RECORDS; at += 1)
			channels.push(data.readUInt32LE(0x10 + at * 4));
	} else {
		width = data.readUInt16LE(8);
		height = data.readUInt16LE(0xa);
		for (let at = 0; at < RECORDS; at += 1)
			channels.push(data.readUInt32LE(0x10 + at * 4));
	}
	if (width <= 0 || height <= 0 || width * height > LIMIT) return undefined;
	return {
		type,
		version,
		bitsPerPixel,
		width,
		height,
		channels,
		dataOffset: HEAD_SIZE,
	};
}

export function decompressCpbChannel(
	input: Buffer,
	outputLength: number,
): Buffer {
	if (input.length < WALK_HEAD_SIZE)
		throw invalidPicture("The words of the walk of a picture stand short");
	const output = Buffer.alloc(outputLength);
	const walkAt = WALK_HEAD_SIZE;
	let matchesAt = walkAt + input.readInt32LE(WALK_COUNT_FIELD);
	let placesAt = matchesAt + input.readInt32LE(WALK_PLACES_FIELD);
	const remaining = input.readInt32LE(WALK_UNPACKED_FIELD);
	if (remaining < 0 || remaining > outputLength)
		throw invalidPicture(
			"The places of a picture stand past the places of a record",
		);
	let dst = 0;
	let walk = walkAt;
	let mask = WALK_START_MASK;
	while (dst < remaining) {
		let count: number;
		if (((input[walk] ?? 0) & mask) !== 0) {
			if (matchesAt + 2 > input.length)
				throw invalidPicture(
					"The places of the walk of a picture stand past them",
				);
			const word = input.readUInt16LE(matchesAt);
			matchesAt += 2;
			count = (word >> WALK_MATCH_BITS) + WALK_MATCH_LEAST;
			const offset = (word & 0x1fff) + 1;
			if (offset > dst)
				throw invalidPicture(
					"A place of the walk of a picture stands before it",
				);
			for (let at = 0; at < count; at += 1) {
				if (dst + at >= outputLength)
					throw invalidPicture("The places of a picture stand past a record");
				output[dst + at] = output[dst + at - offset] ?? 0;
			}
		} else {
			if (placesAt >= input.length)
				throw invalidPicture(
					"The places of a picture stand short of the walk of them",
				);
			count = (input[placesAt] ?? 0) + 1;
			placesAt += 1;
			if (placesAt + count > input.length || dst + count > outputLength)
				throw invalidPicture("The places of a picture stand past a record");
			input.copy(output, dst, placesAt, placesAt + count);
			placesAt += count;
		}
		dst += count;
		mask >>= 1;
		if (mask === 0) {
			walk += 1;
			mask = WALK_START_MASK;
		}
	}
	return output;
}

export async function unpackCpbPicture(
	data: Buffer,
	layout: CpbLayout,
): Promise<Buffer> {
	const streamMap = layout.version === 1 ? [0, 3, 1, 2] : [0, 1, 2, 3];
	const channelMap = layout.version === 1 ? [3, 0, 1, 2] : [2, 1, 0, 3];
	const places = layout.width * layout.height;
	const output = Buffer.alloc(places * PLACES_PER_PLACE);
	let start = layout.dataOffset;
	for (let i = 0; i < RECORDS; i += 1) {
		const packedSize = layout.channels[streamMap[i] ?? 0] ?? 0;
		if (packedSize === 0) continue;
		const end = start + packedSize;
		if (start >= data.length)
			throw invalidPicture(
				"The places of a record of a picture stand past them",
			);
		let record: Buffer;
		if (layout.version === 0 && layout.type === 3) {
			record = decompressCpbChannel(
				data.subarray(start, Math.min(end, data.length)),
				places,
			);
		} else {
			const from = start + RECORD_CRC_SIZE;
			if (from >= data.length)
				throw invalidPicture(
					"The places of a record of a picture stand past them",
				);
			record = await inflateZlibBufferCapped(
				data.subarray(from, Math.min(end, data.length)),
				places,
			);
		}
		let dst = channelMap[i] ?? 0;
		for (let at = 0; at < record.length; at += 1) {
			if (dst >= output.length)
				throw invalidPicture("The places of a picture stand past the picture");
			output[dst] = record[at] ?? 0;
			dst += PLACES_PER_PLACE;
		}
		start = end;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const azsysCpbImageDescriptor: FormatDescriptor = {
	id: "azsys-cpb-image",
	name: "AZ system image format",
	extensions: ["cpb"],
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
			source: "ArcFormats/AZSys/ImageCPB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const azsysCpbImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: azsysCpbImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, HEAD_SIZE));
			return readCpbLayout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readCpbLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
					offset: BigInt(HEAD_SIZE),
					size: source.size - BigInt(HEAD_SIZE),
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: layout.bitsPerPixel,
						pictureType: layout.type,
						version: layout.version,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				pictureType: layout.type,
				version: layout.version,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath?: string) {
		const stored = await readStored(source);
		const layout = readCpbLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return Readable.from([
			writeBmp32(
				layout.width,
				layout.height,
				await unpackCpbPicture(stored, layout),
				false,
			),
		]);
	},
});
