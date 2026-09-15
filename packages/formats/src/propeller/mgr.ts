// Format reference: GARBro ArcFormats/Propeller/ArcMGR.cs, class `MgrOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const EXTENSION = "mgr";
const FRAME_HEADER_SIZE = 8;
/** The first frame's `BM` marker is probed nine bytes into the frame record. */
const BMP_MARKER_OFFSET = 9;
const BMP_MARKER = Buffer.from("BM", "ascii");
/** The reference rejects frames smaller than an empty bitmap. */
const MIN_UNPACKED_SIZE = 0x36;
const MAX_FRAME_COUNT = 0x100;
/** Literal runs are shorter than this control-byte value; everything else is a back reference. */
const LITERAL_LIMIT = 0x20;

/**
 * GARbro `MgrOpener.Decompress`. Control bytes below 0x20 introduce a literal run of `control + 1`
 * bytes, while larger values encode a back reference: the low five bits shifted left by eight plus one
 * give the distance, and the top three bits give the length minus two, with a top value of seven
 * extending the length by one more byte. Zero bytes are never copied and the reference raises an
 * invalid-format error when a reference reaches past the start of the output. With `strict` set, a stream
 * that stops before the output is full is refused rather than padded with zeroes.
 */
export function decompressMgrFrame(
	input: Buffer,
	unpackedSize: number,
	strict = false,
): Buffer {
	const output = Buffer.alloc(unpackedSize);
	let source = 0;
	let destination = 0;
	while (destination < output.length) {
		if (source >= input.length) break;
		let count = input[source++] ?? 0;
		if (count < LITERAL_LIMIT) {
			count = Math.min(count + 1, output.length - destination);
			const available = input.length - source;
			const read = Math.min(count, available);
			input.copy(output, destination, source, source + read);
			source += read;
			destination += read;
			if (read < count) break;
		} else {
			let offset = ((count & 0x1f) << 8) + 1;
			count >>= 5;
			if (count === 7) {
				count += input[source++] ?? 0;
			}
			offset += input[source++] ?? 0;
			if (offset > destination)
				throw new GarbroError("INVALID_ARCHIVE", "Invalid MGR back reference");
			count = Math.min(count + 2, output.length - destination);
			for (let index = 0; index < count; index += 1) {
				output[destination + index] = output[destination - offset + index] ?? 0;
			}
			destination += count;
		}
	}
	// The callers that unfold a fixed amount — the header of a bitmap, or the whole of one — check that the
	// stream gave as much as was asked for, which the reference does by comparing the count its own
	// decompressor returns.
	if (strict && destination < output.length) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"MGR stream is cut short of its frame",
		);
	}
	return output;
}

/**
 * GARbro `MgrOpener.TryOpen`. Multi-frame images list a frame count at offset zero and, when more than
 * one frame is present, a 32-bit offset table whose first entry must point just past the table. Every
 * frame is a header of unpacked and stored sizes followed by a compressed bitmap; the reference probes
 * the first stored byte after that header for a `BM` marker nine bytes into the record.
 *
 * Framed entries are named `<base>#<index>.bmp`; single-frame archives have no table and reuse the
 * source name.
 */
async function readMgrIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(BMP_MARKER_OFFSET)) return undefined;
	if (sourceExtension(sourcePath ?? "") !== EXTENSION) return undefined;
	const header = await source.readAt(0n, Math.min(6, Number(source.size)));
	const count = header.readInt16LE(0);
	if (count <= 0 || count >= MAX_FRAME_COUNT) return undefined;

	let firstOffset = 2n;
	const offsets: bigint[] = [];
	if (count > 1) {
		const tableLength = count * 4;
		if (BigInt(2 + tableLength) > source.size) return undefined;
		const table = await source.readAt(2n, tableLength);
		for (let id = 0; id < count; id += 1)
			offsets.push(BigInt(table.readUInt32LE(id * 4)));
		firstOffset = offsets[0] ?? 0n;
		if (firstOffset !== BigInt(2 + tableLength)) return undefined;
	}

	const probeOffset = firstOffset + BigInt(BMP_MARKER_OFFSET);
	if (probeOffset + BigInt(BMP_MARKER.length) > source.size) return undefined;
	const probe = await source.readAt(probeOffset, BMP_MARKER.length);
	if (!probe.equals(BMP_MARKER)) return undefined;

	const baseName =
		(sourcePath ?? "")
			.split(/[\\/]/)
			.pop()
			?.replace(/\.[^.]*$/, "") ?? "";
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = count > 1 ? (offsets[id] ?? 0n) : 2n;
		if (count > 1) {
			if (recordOffset < firstOffset || recordOffset >= source.size)
				return undefined;
		}
		const frameHeader = await source.readAt(recordOffset, FRAME_HEADER_SIZE);
		const unpackedSize = BigInt(frameHeader.readUInt32LE(0));
		const storedSize = BigInt(frameHeader.readUInt32LE(4));
		if (unpackedSize < BigInt(MIN_UNPACKED_SIZE)) return undefined;
		if (storedSize > source.size - recordOffset) return undefined;
		const name =
			count > 1
				? `${baseName}#${String(id).padStart(4, "0")}.bmp`
				: `${baseName}.bmp`;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset: recordOffset + BigInt(FRAME_HEADER_SIZE),
			size: unpackedSize,
			packedSize: storedSize,
			compressed: true,
			metadata: { type: "image" },
		});
		entries.push(entry);
	}
	return entries;
}

/** GARbro `MgrOpener.OpenEntry`: each frame expands to exactly its declared unpacked size. */
const mgrEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	return Readable.from([decompressMgrFrame(stored, Number(entry.size))]);
};

export const propellerMgrDescriptor: FormatDescriptor = {
	id: "propeller-mgr",
	name: "Propeller multi-frame image",
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
			source: "ArcFormats/Propeller/ArcMGR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const propellerMgrFormat: ArchiveFormat = defineFixedArchive({
	descriptor: propellerMgrDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		return (await readMgrIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readMgrIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MGR layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: mgrEntryOpener,
});
