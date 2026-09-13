// Format reference: GARbro ArcFormats/Tail/ArcCAF.cs, class `CafOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("CAF0", "latin1");
const COUNT_FIELD = 8;
const INDEX_OFFSET_FIELD = 0xc;
const INDEX_SIZE_FIELD = 0x10;
const NAMES_OFFSET_FIELD = 0x14;
const NAMES_SIZE_FIELD = 0x18;
const INDEX_RECORD_SIZE = 0x14;
const DIR_NAME_FIELD = 4;
const NAME_FIELD = 8;
const DATA_OFFSET_FIELD = 0xc;
const DATA_SIZE_FIELD = 0x10;

/** Payload signatures that select a chained unpacker, compared as little endian words. */
const PREN_SIGNATURE = 0x4e455250;
const RP_SIGNATURE = 0x00005052;
const CFP0_SIGNATURE = 0x30504643;
const HP_SIGNATURE = 0x00005048;

const PREN_UNPACKED_FIELD = 8;
const PREN_CODE_FIELD = 0xc;
const PREN_DATA_OFFSET = 0x10;
const CFP0_UNPACKED_FIELD = 8;
const CFP0_DATA_OFFSET = 0xc;
const HP_UNPACKED_FIELD = 8;
const HP_ROOT_FIELD = 0xc;
const HP_NODE_COUNT_FIELD = 0x10;
const HP_PACKED_COUNT_FIELD = 0x14;
const HP_TREE_SIZE = 0x400;
const HP_ROOT_ADJUST = 0xff;
const HP_NODE_STRIDE = 2;
const HP_TERMINAL = -1;
const HP_HIGH_BIT = 0x80;
const MAX_CHAIN_DEPTH = 8;

interface CafEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

function readCString(blob: Buffer, offset: number): string | undefined {
	if (offset < 0 || offset >= blob.length) return undefined;
	const end = blob.indexOf(0, offset);
	return decodeCp932(
		end === -1 ? blob.subarray(offset) : blob.subarray(offset, end),
	);
}

/** `CafOpener.UnpackPren`: a run length escape selected by a code byte from the header. */
export function inflateCafPren(input: Buffer): Buffer {
	if (input.length < PREN_DATA_OFFSET) return Buffer.alloc(0);
	const unpackedSize = input.readInt32LE(PREN_UNPACKED_FIELD);
	if (unpackedSize <= 0) return Buffer.alloc(0);
	const code = input[PREN_CODE_FIELD] ?? 0;
	const output = Buffer.alloc(unpackedSize);
	let position = PREN_DATA_OFFSET;
	let written = 0;
	while (written < output.length && position < input.length) {
		const value = input[position] ?? 0;
		position += 1;
		if (value !== code) {
			output[written] = value;
			written += 1;
			continue;
		}
		const count = input[position] ?? 0;
		position += 1;
		let repeated = code;
		if (count > 2) {
			repeated = input[position] ?? 0;
			position += 1;
		}
		for (let index = 0; index < count && written < output.length; index += 1) {
			output[written] = repeated;
			written += 1;
		}
	}
	return output;
}

/** `CafOpener.UnpackCfp0`: command bytes that introduce raw runs, repeats, or back references. */
export function inflateCafCfp0(input: Buffer): Buffer {
	if (input.length < CFP0_DATA_OFFSET) return Buffer.alloc(0);
	const unpackedSize = input.readInt32LE(CFP0_UNPACKED_FIELD);
	if (unpackedSize <= 0) return Buffer.alloc(0);
	const output = Buffer.alloc(unpackedSize);
	let position = CFP0_DATA_OFFSET;
	let written = 0;
	while (written < output.length) {
		if (position >= input.length) break;
		const command = input[position] ?? 0;
		position += 1;
		let count = 0;
		if (command === 0 || command === 1) {
			count =
				command === 0
					? (input[position] ?? 0)
					: input.readInt32LE(position) | 0;
			position += command === 0 ? 1 : 4;
			if (count < 0) break;
			const available = Math.min(count, input.length - position);
			for (
				let index = 0;
				index < available && written < output.length;
				index += 1
			) {
				output[written] = input[position + index] ?? 0;
				written += 1;
			}
			position += available;
			continue;
		}
		if (command === 2 || command === 3) {
			count =
				command === 2
					? (input[position] ?? 0)
					: input.readInt32LE(position) | 0;
			position += command === 2 ? 1 : 4;
			const value = input[position] ?? 0;
			position += 1;
			if (count < 0) break;
			for (
				let index = 0;
				index < count && written < output.length;
				index += 1
			) {
				output[written] = value;
				written += 1;
			}
			continue;
		}
		if (command === 6) {
			const offset = input.readUInt16LE(position);
			count = input.readUInt16LE(position + 2);
			position += 4;
			for (
				let index = 0;
				index < count && written < output.length;
				index += 1
			) {
				const from = written - offset;
				output[written] = from >= 0 ? (output[from] ?? 0) : 0;
				written += 1;
			}
			continue;
		}
		// The reference leaves `count` at zero for unknown commands, which loops forever; end instead.
		break;
	}
	return output;
}

/** `CafOpener.UnpackHp`: a bit walked tree that emits one byte per token. */
export function inflateCafHp(input: Buffer): Buffer {
	if (input.length < HP_PACKED_COUNT_FIELD + 4) return Buffer.alloc(0);
	const unpackedSize = input.readInt32LE(HP_UNPACKED_FIELD);
	const rootToken = input.readInt32LE(HP_ROOT_FIELD);
	const nodeCount =
		input.readInt32LE(HP_NODE_COUNT_FIELD) + rootToken - HP_ROOT_ADJUST;
	const packedCount = input.readInt32LE(HP_PACKED_COUNT_FIELD);
	if (unpackedSize <= 0 || packedCount <= 0) return Buffer.alloc(0);
	const tree = new Int32Array(HP_TREE_SIZE);
	let position = HP_PACKED_COUNT_FIELD + 4;
	for (let index = 0; index < nodeCount; index += 1) {
		if (position + 12 > input.length) return Buffer.alloc(0);
		const node = input.readInt32LE(position) * HP_NODE_STRIDE;
		if (node < 0 || node + 1 >= tree.length) return Buffer.alloc(0);
		tree[node] = input.readInt32LE(position + 4);
		tree[node + 1] = input.readInt32LE(position + 8);
		position += 12;
	}
	const output = Buffer.alloc(unpackedSize);
	let written = 0;
	let bits = 0;
	let mask = 0;
	for (let index = 0; index < packedCount; index += 1) {
		let symbol = rootToken;
		for (;;) {
			if (mask === 0) {
				if (position >= input.length) return output;
				bits = input[position] ?? 0;
				position += 1;
				mask = HP_HIGH_BIT;
			}
			if (symbol < 0 || symbol * HP_NODE_STRIDE + 1 >= tree.length)
				return output;
			let node = symbol * HP_NODE_STRIDE;
			node += (bits & mask) !== 0 ? 1 : 0;
			symbol = tree[node] ?? 0;
			mask >>= 1;
			if (tree[symbol * HP_NODE_STRIDE] === HP_TERMINAL) break;
		}
		if (written >= output.length) break;
		output[written] = symbol & 0xff;
		written += 1;
	}
	return output;
}

/** `CafOpener.OpenEntry`: unpacks as many chained layers as the payload announces. */
export function unpackCafEntry(stored: Buffer): Buffer {
	let current = stored;
	for (let depth = 0; depth < MAX_CHAIN_DEPTH; depth += 1) {
		if (current.length < 4) return current;
		const signature = current.readUInt32LE(0);
		let next: Buffer;
		if (signature === PREN_SIGNATURE || signature === RP_SIGNATURE)
			next = inflateCafPren(current);
		else if (signature === CFP0_SIGNATURE) next = inflateCafCfp0(current);
		else if (signature === HP_SIGNATURE) next = inflateCafHp(current);
		else return current;
		if (next.length === 0) return next;
		current = next;
	}
	return current;
}

async function readEntries(
	source: ByteSource,
): Promise<CafEntry[] | undefined> {
	if (source.size < BigInt(NAMES_SIZE_FIELD + 4)) return undefined;
	const header = await source.readAt(0n, NAMES_SIZE_FIELD + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	const indexSize = BigInt(header.readUInt32LE(INDEX_SIZE_FIELD));
	const namesOffset = BigInt(header.readUInt32LE(NAMES_OFFSET_FIELD));
	const namesSize = BigInt(header.readUInt32LE(NAMES_SIZE_FIELD));
	if (
		indexSize < BigInt(INDEX_RECORD_SIZE * count) ||
		indexOffset + indexSize > source.size
	)
		return undefined;
	if (namesOffset + namesSize > source.size) return undefined;
	const index = await source.readAt(indexOffset, Number(indexSize));
	const names = await source.readAt(namesOffset, Number(namesSize));
	const dataOffset = namesOffset + namesSize;
	const directories = new Map<number, string>();
	const entries: CafEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const base = id * INDEX_RECORD_SIZE;
		if (base + INDEX_RECORD_SIZE > index.length) return undefined;
		const dirNameOffset = index.readInt32LE(base + DIR_NAME_FIELD);
		const nameOffset = index.readInt32LE(base + NAME_FIELD);
		const name = readCString(names, nameOffset);
		if (name === undefined) return undefined;
		let path = name;
		if (dirNameOffset >= 0) {
			let directory = directories.get(dirNameOffset);
			if (directory === undefined) {
				const raw = readCString(names, dirNameOffset);
				if (raw === undefined) return undefined;
				// The reference rewrites separators for Windows; normalisation happens on the way out.
				directory = raw;
				directories.set(dirNameOffset, directory);
			}
			path = `${directory}/${name}`;
		}
		const offset =
			BigInt(index.readUInt32LE(base + DATA_OFFSET_FIELD)) + dataOffset;
		const size = BigInt(index.readUInt32LE(base + DATA_SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({ name: path, offset, size });
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const tailCafDescriptor: FormatDescriptor = {
	id: "tail-caf",
	name: "Tail resource archive",
	extensions: ["caf"],
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
			source: "ArcFormats/Tail/ArcCAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tailCafFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tailCafDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readEntries(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readEntries(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tail CAF index");
		return {
			entries: entries.map((entry, id) => ({
				...createFixedEntry({
					id,
					...normalizeEntryPath(entry.name),
					offset: entry.offset,
					size: entry.size,
				}),
				// Payloads are unpacked on extraction, so the stored size is only a lower bound.
				sizeKnown: false,
			})),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		return Readable.from([unpackCafEntry(stored)]);
	},
});
