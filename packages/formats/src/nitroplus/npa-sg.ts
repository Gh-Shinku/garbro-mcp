// Format reference: GARbro "ArcFormats/NitroPlus/ArcSteinsGate.cs", classes `NpaSteinsGateOpener`,
// `SteinsGateEncryptedStream` and `SteinsGateOptions`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decodeCp932, decodeBinaryString, GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * `NpaSteinsGateOpener.KeyString`: 'BUCK' and 'TICK' with every bit flipped. The key repeats over both
 * the index and the entry payloads, with the phase taken from the start of each encrypted region.
 */
const KEY = Buffer.from([
	0x42 ^ 0xff,
	0x55 ^ 0xff,
	0x43 ^ 0xff,
	0x4b ^ 0xff,
	0x54 ^ 0xff,
	0x49 ^ 0xff,
	0x43 ^ 0xff,
	0x4b ^ 0xff,
]);
const KEY_LENGTH = KEY.length;
/** The little endian index size sits at the very start of the file, outside the encrypted region. */
const INDEX_SIZE_OFFSET = 0n;
const INDEX_SIZE_OFFSET_BYTES = 4;
const MIN_INDEX_SIZE = 0x14;
const MAX_INDEX_SIZE = 0xffffff;
/** The index starts with the entry count; every record is a length, a name, a size and an offset. */
const COUNT_SIZE = 4;
const RECORD_FIXED_SIZE = 0x10;
const NAME_LENGTH_SIZE = 4;
const SIZE_SIZE = 4;
const MIN_AVERAGE_ENTRY_SIZE = 0x11;

/** GARbro `SteinsGateEncryptedStream.Read`: a repeating eight byte key from a given phase. */
function decryptSteinsGate(data: Buffer, phase = 0): Buffer {
	const output = Buffer.from(data);
	for (let index = 0; index < output.length; index += 1) {
		output[index] =
			(output[index] ?? 0) ^ (KEY[(phase + index) % KEY_LENGTH] ?? 0);
	}
	return output;
}

/** GARbro `NpaSteinsGateOpener.GuessEncoding`: UTF-16LE when any byte is zero, else cp932 or ASCII. */
function decodeSteinsGateName(raw: Buffer): string {
	let hasZero = false;
	let hasNonAscii = false;
	for (const symbol of raw) {
		if (symbol === 0) {
			hasZero = true;
			break;
		}
		if (symbol > 0x7f) hasNonAscii = true;
	}
	if (hasZero) return raw.toString("utf16le");
	if (hasNonAscii) return decodeCp932(raw);
	return decodeBinaryString(raw, "ascii");
}

interface SteinsGateParsedEntry {
	path: string;
	rawPath?: string;
	offset: bigint;
	size: bigint;
}

/** GARbro `NpaSteinsGateOpener.TryOpen`: an encrypted index of name, size and offset records. */
async function readSteinsGateIndex(
	source: ByteSource,
): Promise<SteinsGateParsedEntry[] | undefined> {
	if (source.size < BigInt(MIN_INDEX_SIZE)) return undefined;
	const head = Buffer.from(
		await source.readAt(INDEX_SIZE_OFFSET, INDEX_SIZE_OFFSET_BYTES),
	);
	const indexSize = head.readInt32LE(0);
	if (indexSize < MIN_INDEX_SIZE) return undefined;
	if (indexSize >= source.size) return undefined;
	if (indexSize > MAX_INDEX_SIZE) return undefined;
	const encrypted = Buffer.from(await source.readAt(4n, indexSize));
	const index = decryptSteinsGate(encrypted);
	try {
		const entryCount = index.readInt32LE(0);
		if (!isSaneCount(entryCount)) return undefined;
		let remaining = indexSize - COUNT_SIZE;
		if (Math.floor(remaining / entryCount) < MIN_AVERAGE_ENTRY_SIZE)
			return undefined;
		const entries: SteinsGateParsedEntry[] = [];
		let position = COUNT_SIZE;
		for (let i = 0; i < entryCount; i += 1) {
			if (position + NAME_LENGTH_SIZE > index.length) return undefined;
			const nameLength = index.readInt32LE(position);
			if (nameLength + RECORD_FIXED_SIZE > remaining) return undefined;
			if (nameLength < 0) return undefined;
			const raw = index.subarray(
				position + NAME_LENGTH_SIZE,
				position + NAME_LENGTH_SIZE + nameLength,
			);
			const name = decodeSteinsGateName(raw);
			const size = BigInt(
				index.readUInt32LE(position + NAME_LENGTH_SIZE + nameLength),
			);
			const offset = index.readBigInt64LE(
				position + NAME_LENGTH_SIZE + nameLength + SIZE_SIZE,
			);
			if (!checkPlacement(offset, size, source.size)) return undefined;
			entries.push({ ...normalizeEntryPath(name), offset, size });
			// The stream advances by the name plus the four fields around it, matching the reference.
			position += nameLength + RECORD_FIXED_SIZE;
			remaining -= nameLength + RECORD_FIXED_SIZE;
		}
		if (entries.length === 0) return undefined;
		return entries;
	} catch {
		return undefined;
	}
}

export const nitroplusNpaSteinsGateDescriptor: FormatDescriptor = {
	id: "nitroplus-npa-sg",
	name: "NitroPlus Steins;Gate resource archive",
	extensions: ["npa"],
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
			source: "ArcFormats/NitroPlus/ArcSteinsGate.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nitroplusNpaSteinsGateFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nitroplusNpaSteinsGateDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSteinsGateIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const parsed = await readSteinsGateIndex(source);
		if (!parsed)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Steins;Gate layout");
		const entries: FixedEntry[] = parsed.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				...(entry.rawPath !== undefined ? { rawPath: entry.rawPath } : {}),
				offset: entry.offset,
				size: entry.size,
				encrypted: true,
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		// Payloads are encrypted with their own key phase, so every entry restarts at the first key byte.
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		return Readable.from([decryptSteinsGate(data)]);
	},
});
