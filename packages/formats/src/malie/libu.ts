// Format reference: GARBro ArcFormats/Malie/ArcLIBU.cs, class `LibUOpener` and its `LibUReader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("LIBU", "ascii");
const HEADER_SIZE = 0x10;
const COUNT_OFFSET = 8;
/** Directory blocks point at their children with an int64 offset. */
const RELATIVE_OFFSET_SIZE = 8;
/** Names are read as thirty-four UTF-16 code units. */
const NAME_UNITS = 0x22;
const NAME_SIZE = NAME_UNITS * 2;
/** A crafted archive could point a directory at itself. */
const MAX_DEPTH = 64;

/**
 * GARBro `LibUReader.ReadName`. The reference reuses one character buffer across calls, so a short read
 * leaves the previous name's characters in place; the port keeps the same buffer for the same reason and
 * only takes the characters that were actually read.
 */
class NameReader {
	readonly #buffer = Buffer.alloc(NAME_SIZE);

	read(stored: Buffer, available: number): string {
		stored.copy(this.#buffer, 0, 0, available);
		// The reference searches for the first null character, not the first null byte.
		let end = available - (available % 2);
		for (let index = 0; index + 2 <= available; index += 2) {
			if (this.#buffer[index] === 0 && this.#buffer[index + 1] === 0) {
				end = index;
				break;
			}
		}
		return this.#buffer.subarray(0, end).toString("utf16le");
	}
}

/**
 * GARBro `LibUReader.ReadDir`. Directory blocks nest inside the archive: a block starts with the `LIBU`
 * signature, two words and an entry count, and its entries follow from 0x10 as variable-length records —
 * a thirty-four-code-unit UTF-16 name, a 32-bit size and a 64-bit offset relative to the block.
 *
 * A name without a dot is tried as a nested block first; when that block parses, its children are added
 * with the directory as their path prefix and the directory itself is not listed. Names that do parse as
 * a directory, or that carry a dot, are listed as stored ranges.
 *
 * The reference recurses without a depth limit; the port stops at a generous depth so a crafted archive
 * cannot exhaust the stack.
 */
async function readDirectory(
	source: ByteSource,
	baseOffset: bigint,
	root: string,
	entries: FixedEntry[],
	names: NameReader,
	depth: number,
): Promise<boolean> {
	if (depth > MAX_DEPTH) return false;
	if (baseOffset + BigInt(HEADER_SIZE) > source.size) return false;
	const header = await source.readAt(baseOffset, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return false;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return false;

	let indexOffset = baseOffset + BigInt(HEADER_SIZE);
	for (let id = 0; id < count; id += 1) {
		if (indexOffset + BigInt(NAME_SIZE) > source.size) return false;
		const record = await source.readAt(indexOffset, NAME_SIZE);
		const name = names.read(record, NAME_SIZE);
		const tail = await source.readAt(
			indexOffset + BigInt(NAME_SIZE),
			4 + RELATIVE_OFFSET_SIZE,
		);
		const size = BigInt(tail.readUInt32LE(0));
		const offset = baseOffset + tail.readBigInt64LE(4);
		indexOffset += BigInt(NAME_SIZE + 4 + RELATIVE_OFFSET_SIZE);

		const hasExtension = name.includes(".");
		const path = root.length === 0 ? name : `${root}\\${name}`;
		if (!hasExtension) {
			const nested = await readDirectory(
				source,
				offset,
				path,
				entries,
				names,
				depth + 1,
			).catch(() => false);
			if (nested) continue;
		}
		if (!checkPlacement(offset, size, source.size)) return false;
		entries.push(
			createFixedEntry({
				id: `${entries.length}`,
				...normalizeEntryPath(path),
				offset,
				size,
			}),
		);
	}
	return true;
}

/** GARBro `LibUReader.ReadIndex`: the root block has to parse and yield at least one entry. */
async function readLibuIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (!(await hasSignature(source, 0n))) return undefined;
	const entries: FixedEntry[] = [];
	const names = new NameReader();
	const parsed = await readDirectory(source, 0n, "", entries, names, 0);
	if (!parsed || entries.length === 0) return undefined;
	return entries;
}

async function hasSignature(
	source: ByteSource,
	offset: bigint,
): Promise<boolean> {
	if (offset + BigInt(SIGNATURE.length) > source.size) return false;
	const stored = await source.readAt(offset, SIGNATURE.length);
	return stored.equals(SIGNATURE);
}

/** GARbro's base opener: LIBU entries are stored as is. */
const libuEntryOpener: FixedEntryOpener = async (source, entry) =>
	source.createReadStream(entry.offset, entry.packedSize);

export const malieLibuDescriptor: FormatDescriptor = {
	id: "malie-libu",
	name: "Malie engine resource archive",
	extensions: ["lib"],
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
			source: "ArcFormats/Malie/ArcLIBU.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const malieLibuFormat: ArchiveFormat = defineFixedArchive({
	descriptor: malieLibuDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readLibuIndex(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const entries = await readLibuIndex(source).catch(() => undefined);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LIBU layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: libuEntryOpener,
});
