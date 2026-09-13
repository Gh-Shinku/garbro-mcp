// Format reference: GARBro ArcFormats/ScenePlayer/ArcPMX.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	DecodedArchiveHandle,
	ZLIB_FIRST_BYTE,
	readPmxStream,
} from "./decoded-archive.js";

const EXTENSION = "pmx";
const COUNT_SIZE = 4;
const NAME_SIZE = 0x20;
const RECORD_SIZE = NAME_SIZE + 4;

export const pmxDescriptor: FormatDescriptor = {
	id: "sceneplayer-pmx",
	name: "ScenePlayer scripts archive",
	extensions: ["pmx"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/ScenePlayer/ArcPMX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** Mirrors `Path.IsPathRooted` for the names GARbro rejects. */
function isRooted(name: string): boolean {
	return /^[\\/]/.test(name) || /^[A-Za-z]:/.test(name);
}

/**
 * GARbro `PmxOpener.TryOpen`. The container is XORed with 0x21 and inflated; the decoded stream
 * holds a 32-bit record count and records of a 0x20-byte name plus the script size. Payloads follow
 * the index in order, so every entry is a slice of the decoded stream.
 */
async function readPmxIndex(
	decoded: Buffer,
	_sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (decoded.length < COUNT_SIZE) return undefined;
	const count = decoded.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (COUNT_SIZE + indexSize > decoded.length) return undefined;
	let dataOffset = BigInt(COUNT_SIZE + indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const position = COUNT_SIZE + id * RECORD_SIZE;
		const name = decodeCStringField(decoded, position, NAME_SIZE);
		if (name.trim().length === 0 || isRooted(name)) return undefined;
		const size = BigInt(decoded.readUInt32LE(position + NAME_SIZE));
		if (!checkPlacement(dataOffset, size, BigInt(decoded.length)))
			return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: dataOffset,
				size,
			}),
		);
		dataOffset += size;
	}
	return entries;
}

export const pmxFormat: ArchiveFormat = {
	descriptor: pmxDescriptor,
	detection: { signatures: [{ bytes: Buffer.from([ZLIB_FIRST_BYTE]) }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== EXTENSION) return false;
		if (source.size < 1n) return false;
		if ((await source.readAt(0n, 1))[0] !== ZLIB_FIRST_BYTE) return false;
		const decoded = await readPmxStream(source);
		if (!decoded) return false;
		return (await readPmxIndex(decoded, sourcePath)) !== undefined;
	},
	async open(source: ByteSource, sourcePath: string) {
		const decoded = await readPmxStream(source);
		if (!decoded)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid ScenePlayer PMX stream",
			);
		const entries = await readPmxIndex(decoded, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid ScenePlayer PMX layout",
			);
		return new DecodedArchiveHandle(
			source,
			sourcePath,
			pmxDescriptor,
			entries,
			decoded,
		);
	},
};
