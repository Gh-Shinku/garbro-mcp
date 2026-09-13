// Format reference: GARbro ArcFormats/DaiSystem/ArcPAC.cs, class `PacOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
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
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("DAI_SYSTEM_01000", "latin1");
const COUNT_FIELD = 0x10;
const INDEX_SIZE_FIELD = 0x12;
const INDEX_OFFSET = 0x16;
/** The index is stored with a running subtraction over its own position. */
const INDEX_KEY_BIAS = 0x28;
const NAME_TERMINATOR = 0x2c;
/** An entry offset field is a big-endian word followed by one unused byte. */
const OFFSET_FIELD_SIZE = 5;
/** Payloads of the engine's own image format carry a header. */
const HA0_MARKER = Buffer.from("HA0", "latin1");
const HA0_HEADER_SIZE = 0x10;
const HA0_HEADER_LENGTH_OFFSET = 3;
const HA0_PATTERN_OFFSET = 8;
const HA0_PATTERN_CODES = 4;
const METHOD_NONE = 0;
const METHOD_INTERLEAVE = 2;
const METHOD_DELTA = 3;
const METHOD_PACKED = 4;
/** The unpacked header of a packed payload holds its size, its control size and its data offset. */
const PACKED_HEADER_SIZE = 12;
const PACKED_UNPACKED_SIZE_FIELD = 0;
const PACKED_CONTROL_SIZE_FIELD = 4;
const LZ_INITIAL_BITS = 2;
const LZ_CONTROL_BASE = 0x100;
/** Method bytes the reference knows; anything else makes it hand back the stored payload. */
const KNOWN_METHODS = new Set([
	METHOD_NONE,
	METHOD_INTERLEAVE,
	METHOD_DELTA,
	METHOD_PACKED,
]);

interface DaiEntry {
	name: string;
	offset: bigint;
	size: bigint;
	kind: "raw" | "ha0" | "protected";
	streamOffset: number;
	/** The pipeline bytes of an `HA0` payload, most significant first, without its trailing zeroes. */
	methods: number[];
	type: string;
}

/** `PacOpener.Decrypt2`: three interleaved streams are put back together in order. */
function undoCInterleave(input: Buffer): Buffer {
	const output = Buffer.alloc(input.length);
	let source = 0;
	for (let stream = 0; stream < 3; stream += 1) {
		for (let target = stream; target < output.length; target += 3)
			output[target] = input[source++] ?? 0;
	}
	return output;
}

/** `PacOpener.Decrypt3`: every byte is the sum of all bytes up to it. */
function undoDelta(input: Buffer): Buffer {
	for (let index = 1; index < input.length; index += 1)
		input[index] = ((input[index] ?? 0) + (input[index - 1] ?? 0)) & 0xff;
	return input;
}

/**
 * `PacOpener.Unpack4`: the same bit ladder the engine uses elsewhere. One control byte holds eight
 * decisions, a clear bit is a literal byte and a set bit is a two byte back reference with an offset and
 * a count.
 */
export function unpackDaiPacked(input: Buffer): Buffer {
	if (input.length < PACKED_HEADER_SIZE) return Buffer.alloc(0);
	const unpackedSize = input.readInt32BE(PACKED_UNPACKED_SIZE_FIELD);
	if (unpackedSize < 0) return Buffer.alloc(0);
	const controlSize = input.readInt32BE(PACKED_CONTROL_SIZE_FIELD);
	const output = Buffer.alloc(unpackedSize);
	const controlStart = PACKED_HEADER_SIZE;
	let cursor = controlStart + controlSize;
	let target = 0;
	let control = 0;
	let bits = LZ_INITIAL_BITS;
	while (target < output.length) {
		bits >>= 1;
		if (bits === 1) {
			if (control >= controlSize) break;
			bits = (input[controlStart + control] ?? 0) | LZ_CONTROL_BASE;
			control += 1;
		}
		if ((bits & 1) === 0) {
			if (cursor >= input.length) break;
			output[target++] = input[cursor++] ?? 0;
			continue;
		}
		if (cursor + 2 > input.length) break;
		const offset = input[cursor++] ?? 0;
		const count = input[cursor++] ?? 0;
		if (offset === 0 || target - offset < 0)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"DAI_SYSTEM copy starts behind the unpacked payload",
			);
		if (target + count > output.length)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"DAI_SYSTEM copy leaves the unpacked payload",
			);
		for (let step = 0; step < count; step += 1) {
			output[target] = output[target - offset] ?? 0;
			target += 1;
		}
	}
	return output.subarray(0, target);
}

function extractMethods(pattern: Buffer): number[] {
	const methods: number[] = [];
	let value = pattern.readUInt32LE(0);
	for (let index = 0; index < HA0_PATTERN_CODES && value !== 0; index += 1) {
		methods.push((value >>> 24) & 0xff);
		value = (value << 8) >>> 0;
	}
	return methods;
}

async function readDaiIndex(
	source: ByteSource,
): Promise<DaiEntry[] | undefined> {
	const header = Buffer.from(
		await source.readAt(0n, Math.min(Number(source.size), INDEX_OFFSET)),
	);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readUInt16BE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexSize = header.readUInt32BE(INDEX_SIZE_FIELD);
	// The reference reads a truncated index without complaining, so an index behind the file is simply read
	// as far as it goes.
	const available =
		source.size > BigInt(INDEX_OFFSET)
			? Number(
					BigInt(indexSize) < source.size - BigInt(INDEX_OFFSET)
						? BigInt(indexSize)
						: source.size - BigInt(INDEX_OFFSET),
				)
			: 0;
	const index = Buffer.from(
		await source.readAt(BigInt(INDEX_OFFSET), available),
	);
	for (let position = 0; position < index.length; position += 1)
		index[position] =
			((index[position] ?? 0) - ((position + INDEX_KEY_BIAS) & 0xff)) & 0xff;

	const entries: DaiEntry[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		const end = index.indexOf(NAME_TERMINATOR, position);
		if (end === -1) return undefined;
		const name = decodeCp932(index.subarray(position, end));
		position = end + 1;
		if (position + OFFSET_FIELD_SIZE > index.length) return undefined;
		const offset = BigInt(index.readUInt32BE(position));
		position += OFFSET_FIELD_SIZE;
		if (offset > source.size) return undefined;
		entries.push({
			name,
			offset,
			size: 0n,
			kind: "raw",
			streamOffset: 0,
			methods: [],
			type: "data",
		});
	}
	if (entries.length === 0) return undefined;
	// Sizes are the distances between neighbouring payloads; the last one reaches to the end of the file.
	for (const [id, entry] of entries.entries()) {
		const next = entries[id + 1];
		const size = next ? next.offset - entry.offset : source.size - entry.offset;
		if (size < 0n) return undefined;
		if (!checkPlacement(entry.offset, size, source.size)) return undefined;
		entry.size = size;
	}
	// `PacOpener.OpenEntry` decides what a payload is when it is read; the port resolves that while listing
	// so that the reported sizes and the extracted payload agree.
	for (const entry of entries) {
		const probeLength = Number(
			entry.size < BigInt(HA0_HEADER_SIZE)
				? entry.size
				: BigInt(HA0_HEADER_SIZE),
		);
		const probe = Buffer.from(await source.readAt(entry.offset, probeLength));
		if (!probe.subarray(0, HA0_MARKER.length).equals(HA0_MARKER)) continue;
		entry.type = "image";
		if (probe.length <= HA0_HEADER_LENGTH_OFFSET) continue;
		const headerLength = probe[HA0_HEADER_LENGTH_OFFSET] ?? 0;
		const streamOffset = HA0_HEADER_SIZE + headerLength;
		if (BigInt(streamOffset) >= entry.size) continue;
		if (probe.length < HA0_PATTERN_OFFSET + 4) continue;
		const methods = extractMethods(
			probe.subarray(HA0_PATTERN_OFFSET, HA0_PATTERN_OFFSET + 4),
		);
		// A step the reference does not know makes it hand back the stored payload, header included.
		if (methods.some((method) => !KNOWN_METHODS.has(method))) continue;
		entry.kind = "ha0";
		entry.streamOffset = streamOffset;
		entry.methods = methods;
	}
	return entries;
}

function toFixedEntries(entries: readonly DaiEntry[]): FixedEntry[] {
	return entries.map((entry, id) => {
		const compressed = entry.kind === "ha0";
		// Only a packed step hides the length of its output; the other methods keep it.
		const dynamic = entry.methods.includes(METHOD_PACKED);
		const fixed = createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset + BigInt(entry.streamOffset),
			size: compressed ? entry.size - BigInt(entry.streamOffset) : entry.size,
			packedSize: compressed
				? entry.size - BigInt(entry.streamOffset)
				: entry.size,
			compressed,
			metadata: {
				type: entry.type,
				kind: entry.kind,
				methods: entry.methods,
			},
		});
		return compressed && dynamic ? { ...fixed, sizeKnown: false } : fixed;
	});
}

/**
 * `PacOpener.OpenEntry`: an `HA0` payload is walked through its pipeline before it is handed over. A step
 * the reference does not know makes it fall back to the stored payload, which is what the port does too,
 * and a payload that is protected by an unknown method is reported as such at extraction time.
 */
async function openDaiEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (entry.metadata?.kind !== "ha0") {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		return Readable.from([stored]);
	}
	let current: Buffer = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	const methods = Array.isArray(entry.metadata?.methods)
		? (entry.metadata?.methods as number[])
		: [];
	for (const method of methods) {
		if (method === METHOD_NONE) continue;
		if (method === METHOD_INTERLEAVE) {
			current = undoCInterleave(current);
			continue;
		}
		if (method === METHOD_DELTA) {
			current = undoDelta(current);
			continue;
		}
		if (method === METHOD_PACKED) current = unpackDaiPacked(current);
	}
	return Readable.from([current]);
}

export const daiPacDescriptor: FormatDescriptor = {
	id: "dai-system-pac",
	name: "DAI system resource archive",
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
			source: "ArcFormats/DaiSystem/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const daiPacFormat = defineFixedArchive({
	descriptor: daiPacDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDaiIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readDaiIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DAI_SYSTEM PAC layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	openEntry: openDaiEntry,
});
