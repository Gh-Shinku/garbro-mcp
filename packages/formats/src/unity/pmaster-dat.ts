import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 0x400;
const RECORD_SIZE = 0x10;
const NAME_POSITION_FIELD = 0x00;
const OFFSET_FIELD = 0x04;
const SIZE_FIELD = 0x08;
const KEY_FIELD = 0x0c;
const NAMES_SEED_FIELD = 0x5c;
const INDEX_SEED_FIELD = 0xd4;
const MAXIMUM_COUNT = 0x100000;
/** The walk of a key of its own: how many places it holds, and the words it stands from. */
const KEY_SIZE = 0x100;
const KEY_PLACES = 0x2b;
const KEY_FIRST = 2281;
const KEY_FIRST_ADD = 59455;
const KEY_SHIFT = 17;
const KEY_MULTIPLY = 471;
const KEY_NEXT_ADD = 87;
const KEY_MASK = 91;
/** The places every place of a walk of places stands under, and the places that stand beside them. */
const PLACE_MASK = 0x23;
const PLACE_ADD = 0x4d;

export interface PMasterEntryLayout {
	name: string;
	offset: number;
	size: number;
	key: number;
}

export interface PMasterLayout {
	count: number;
	indexLength: number;
	entries: PMasterEntryLayout[];
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function generatePMasterKey(seed: number): Buffer {
	const key: Buffer = Buffer.alloc(KEY_SIZE, 0x00);
	let n = (Math.imul(seed, KEY_FIRST) + KEY_FIRST_ADD) >>> 0;
	let n2 = ((n << KEY_SHIFT) ^ n) >>> 0;
	for (let at = 0; at < KEY_SIZE; at += 1) {
		n = n >>> 5;
		n = (n ^ n2) >>> 0;
		n = Math.imul(n, KEY_MULTIPLY) >>> 0;
		n = (n - seed) >>> 0;
		n = (n + n2) >>> 0;
		n2 = (n + KEY_NEXT_ADD) >>> 0;
		n = (n ^ (n2 & KEY_MASK)) >>> 0;
		key[at] = n & 0xff;
		n = n >>> 1;
	}
	return key;
}

export function decryptPMasterPlaces(data: Buffer, seed: number): Buffer {
	const out: Buffer = Buffer.from(data);
	const key = generatePMasterKey(seed);
	for (let at = 0; at < out.length; at += 1) {
		const first = key[at & (KEY_SIZE - 1)] ?? 0;
		const second = key[at % KEY_PLACES] ?? 0;
		let place = (out[at] ?? 0) ^ first;
		place = (place + PLACE_ADD) & 0xff;
		place = (place + second) & 0xff;
		place = (place - first) & 0xff;
		out[at] = (place ^ PLACE_MASK) & 0xff;
	}
	return out;
}

export function encryptPMasterPlaces(data: Buffer, seed: number): Buffer {
	const out: Buffer = Buffer.from(data);
	const key = generatePMasterKey(seed);
	for (let at = 0; at < out.length; at += 1) {
		const first = key[at & (KEY_SIZE - 1)] ?? 0;
		const second = key[at % KEY_PLACES] ?? 0;
		let place = (out[at] ?? 0) ^ PLACE_MASK;
		place = (place + first) & 0xff;
		place = (place - second) & 0xff;
		place = (place - PLACE_ADD) & 0xff;
		out[at] = (place ^ first) & 0xff;
	}
	return out;
}

function readName(names: Buffer, at: number): string | undefined {
	if (at < 0 || at >= names.length) return undefined;
	let end = at;
	while (end < names.length && 0 !== names[end]) end += 1;
	const places = names.subarray(at, end);
	if (0 === places.length) return undefined;
	for (const place of places) {
		if (place < 0x20 || 0x7f === place) return undefined;
	}
	const name = places.toString("latin1");
	return name.includes("\\") ? undefined : name;
}

export function readPMasterLayout(
	data: Buffer,
	fileLength = data.length,
): PMasterLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (fileLength < HEADER_SIZE) return undefined;
	let count = 0;
	for (let at = 0; at < HEADER_SIZE; at += 4) {
		if (at + 4 > data.length) return undefined;
		count += data.readInt32LE(at);
	}
	if (count <= 0 || count >= MAXIMUM_COUNT) return undefined;
	const indexLength = count * RECORD_SIZE;
	if (indexLength >= fileLength) return undefined;
	if (HEADER_SIZE + indexLength > data.length) return undefined;
	const index = decryptPMasterPlaces(
		Buffer.from(data.subarray(HEADER_SIZE, HEADER_SIZE + indexLength)),
		data.readUInt32LE(INDEX_SEED_FIELD),
	);
	const firstOffset = index.readUInt32LE(OFFSET_FIELD);
	if (firstOffset >= fileLength || firstOffset <= HEADER_SIZE + indexLength) {
		return undefined;
	}
	const namesLength = firstOffset - (HEADER_SIZE + indexLength);
	if (HEADER_SIZE + indexLength + namesLength > data.length) return undefined;
	const names = decryptPMasterPlaces(
		Buffer.from(
			data.subarray(
				HEADER_SIZE + indexLength,
				HEADER_SIZE + indexLength + namesLength,
			),
		),
		data.readUInt32LE(NAMES_SEED_FIELD),
	);
	const entries: PMasterEntryLayout[] = [];
	for (let id = 0; id < count; id += 1) {
		const at = id * RECORD_SIZE;
		const name = readName(names, index.readInt32LE(at + NAME_POSITION_FIELD));
		if (!name) return undefined;
		const offset = index.readUInt32LE(at + OFFSET_FIELD);
		const size = index.readUInt32LE(at + SIZE_FIELD);
		if (offset > fileLength || offset + size > fileLength) return undefined;
		entries.push({
			name,
			offset,
			size,
			key: index.readUInt32LE(at + KEY_FIELD),
		});
	}
	return { count, indexLength, entries };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readPMaster(source: ByteSource) {
	const stored = await readStored(source);
	const layout = readPMasterLayout(stored, Number(source.size));
	if (!layout) throw invalidArchive("Not a Unity PMaster engine archive");
	return { stored, layout };
}

export const unityPMasterDatDescriptor: FormatDescriptor = {
	id: "unity-pmaster-dat",
	name: "Unity PMaster engine resource archive",
	extensions: [],
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
			source: "ArcFormats/Unity/PMaster/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const unityPMasterDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: unityPMasterDatDescriptor,
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			// The walk of the files stands behind the head, so the whole file is read.
			const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
			return readPMasterLayout(stored, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const { layout } = await readPMaster(source);
		const entries = layout.entries.map((entry, id) =>
			createFixedEntry({
				id,
				path: entry.name,
				offset: BigInt(entry.offset),
				size: BigInt(entry.size),
				encrypted: true,
				metadata: { type: "file" } as Record<string, unknown>,
			}),
		);
		return {
			entries,
			metadata: {
				count: layout.count,
				indexLength: layout.indexLength,
				encrypted: true,
			},
		};
	},
	async openEntry(source: ByteSource, entry) {
		const { stored, layout } = await readPMaster(source);
		const at = layout.entries[Number(entry.id)];
		if (!at) {
			throw invalidArchive("PMaster archive entry stands outside the archive");
		}
		const end = at.offset + at.size;
		if (end > stored.length) {
			throw invalidArchive("PMaster archive entry stands outside the archive");
		}
		return Readable.from([
			decryptPMasterPlaces(stored.subarray(at.offset, end), at.key),
		]);
	},
});
