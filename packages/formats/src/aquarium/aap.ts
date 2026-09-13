// Format reference: GARbro Legacy/Aquarium/ArcAAP.cs (with Cp2Reader.DecompressLz)
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("FPARC10\0", "binary");
const INDEX_POINTER_OFFSET = 0x10;
const COUNT_OFFSET = 0x14;
const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x30;
const OFFSET_OFFSET = 0x10;
const UNPACKED_SIZE_OFFSET = 0x14;
const SIZE_OFFSET = 0x18;

export const aapDescriptor: FormatDescriptor = {
	id: "aquarium-aap",
	name: "Aquarium resource archive",
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
			source: "Legacy/Aquarium/ArcAAP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** Mirrors `Cp2Reader.DecompressLz`: an 8-byte header then literal/back-reference tokens. */
function decompressAapLz(input: Buffer, outputLength: number): Buffer {
	let remaining = input.readInt32LE(0);
	let position = 8;
	const output = Buffer.alloc(outputLength);
	let written = 0;
	while (written < output.length && remaining > 0) {
		if (position >= input.length) break;
		const value = input[position++] ?? 0;
		if (value !== 0) {
			output[written++] = value;
			remaining -= 1;
			continue;
		}
		if (position >= input.length) break;
		const count = input[position++] ?? 0;
		if (count !== 0) {
			if (position + 2 > input.length) break;
			const offset = input.readUInt16LE(position);
			position += 2;
			let source = written - offset;
			for (
				let index = 0;
				index < count && written < output.length;
				index += 1
			) {
				output[written++] = output[source++] ?? 0;
			}
			remaining -= 4;
		} else {
			output[written++] = 0;
			remaining -= 2;
		}
	}
	return output;
}

const aapEntryOpener: FixedEntryOpener = async (source, entry) => {
	const unpacked = entry.metadata?.unpackedSize;
	const unpackedSize = Number(
		typeof unpacked === "string" ? unpacked : entry.size,
	);
	if (typeof unpacked !== "string" || unpackedSize === 0) {
		return source.createReadStream(entry.offset, entry.size);
	}
	if (!Number.isSafeInteger(unpackedSize) || unpackedSize < 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Aquarium AAP entry declares an invalid unpacked size",
		);
	}
	const compressed = await source.readAt(entry.offset, Number(entry.size));
	return Readable.from([decompressAapLz(compressed, unpackedSize)]);
};

interface AapHeader {
	count: number;
	indexOffset: bigint;
	dataOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<AapHeader | undefined> {
	if (source.size < BigInt(COUNT_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, COUNT_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_POINTER_OFFSET));
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count) || indexOffset >= source.size) return undefined;
	const dataOffset = indexOffset + BigInt(count * RECORD_SIZE);
	if (indexOffset + BigInt(count * RECORD_SIZE) > source.size) return undefined;
	return { count, indexOffset, dataOffset };
}

async function readAap(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Aquarium AAP layout");
	}
	const { count, indexOffset, dataOffset } = header;
	const index = await source.readAt(indexOffset, count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameField = index.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Aquarium AAP entry has an empty name",
			);
		}
		const offset =
			dataOffset + BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const unpackedSize = BigInt(
			index.readUInt32LE(recordOffset + UNPACKED_SIZE_OFFSET),
		);
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Aquarium AAP entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				compressed: unpackedSize !== 0n,
				metadata: { unpackedSize: unpackedSize.toString() },
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const aapFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aapDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readAap,
	openEntry: aapEntryOpener,
});
