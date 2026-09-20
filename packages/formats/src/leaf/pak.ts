// Format reference: GARbro "ArcFormats/Leaf/ArcLEAF.cs", classes `LeafPackOpener`, `LeafArchive` and
// `LeafPackScheme` (a Leaf resource archive: the places of the files stand at the front of the file, the walk
// of the names at its end, and every place of both stands under a walk of places the key of the title names).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The key of an archive of this kind stands in the reference's own list of games, which names a key for every
// title it knows, and in the settings of the reference where it knows no title. This project carries no such
// list, so the key of the titles the reference names first stands as the key of its own; an archive of another
// title is read with the wrong key, which its own walk of names and the places of its files tell apart.

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

/** The word the reference registers, and the word behind it. */
const SIGNATURE = Buffer.from("LEAF", "latin1");
const PACK_WORD = "PACK";
const PACK_WORD_FIELD = 0x04;
/** How many files the archive holds stands in the word at `0x08`, and the walk of their names stands at the
 * end of the file, four and twenty places a file. */
const COUNT_FIELD = 0x08;
const RECORD_SIZE = 0x18;
const NAME_SIZE = 0x08;
const EXTENSION_SIZE = 0x03;
const NAME_EXTENSION_FIELD = 0x08;
const OFFSET_FIELD = 0x0c;
const SIZE_FIELD = 0x10;
const HEADER_SIZE = 0x0a;
/** The key the reference names first, which stands as the key of this port. */
const DEFAULT_KEY = Buffer.from([
	0x71, 0x48, 0x6a, 0x55, 0x9f, 0x13, 0x58, 0xf7, 0xd1, 0x7c, 0x3e,
]);
/** How many files an archive of this kind may hold, past which the reference stands the count as mad. */
const MAXIMUM_COUNT = 0x10000;
/** A name that stands as the name of a file of this kind: the places the reference reads a name and the places
 * of an extension out of. */
const NAME_BYTES = /^[\x20-\x7e]*$/;

export interface LeafPackEntry {
	name: string;
	offset: number;
	size: number;
}

export interface LeafPackLayout {
	count: number;
	indexOffset: number;
	indexSize: number;
	entries: LeafPackEntry[];
}

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `LeafPackOpener.DecryptData`: every place of a walk stands under the place of the key that stands at the
 * same place of the key's own walk, the walk of the key standing over and over where the walk of the places is
 * longer than it. */
export function decryptLeafPlaces(
	data: Buffer,
	key: Buffer = DEFAULT_KEY,
): Buffer {
	const out: Buffer = Buffer.from(data);
	for (let at = 0; at < out.length; at += 1) {
		out[at] = ((out[at] ?? 0) - (key[at % key.length] ?? 0)) & 0xff;
	}
	return out;
}

/** The other way of the same walk, which stands the places of a file as the archive stands them. */
export function encryptLeafPlaces(
	data: Buffer,
	key: Buffer = DEFAULT_KEY,
): Buffer {
	const out: Buffer = Buffer.from(data);
	for (let at = 0; at < out.length; at += 1) {
		out[at] = ((out[at] ?? 0) + (key[at % key.length] ?? 0)) & 0xff;
	}
	return out;
}

/** A name of the walk of names: eight places of the name and three of the extension, the places behind the
 * name standing as nothing. */
function readName(index: Buffer, at: number): string | undefined {
	const nameField = index.subarray(at, at + NAME_SIZE);
	const extensionField = index.subarray(
		at + NAME_EXTENSION_FIELD,
		at + NAME_EXTENSION_FIELD + EXTENSION_SIZE,
	);
	if (
		!NAME_BYTES.test(nameField.toString("latin1")) ||
		!NAME_BYTES.test(extensionField.toString("latin1"))
	) {
		return undefined;
	}
	const name = nameField.toString("latin1").replace(/\0.*$/, "").trimEnd();
	const extension = extensionField
		.toString("latin1")
		.replace(/\0.*$/, "")
		.trimEnd();
	if (0 === name.length || name.includes("/") || name.includes("\\")) {
		return undefined;
	}
	return 0 === extension.length ? name : `${name}.${extension}`;
}

/**
 * `LeafPackOpener.TryOpen`: the word `LEAF` stands at the beginning of the file with the word `PACK` behind it,
 * how many files the archive holds in the word at `0x08`, and the walk of their names at the end of the file.
 */
export function readLeafPackLayout(
	data: Buffer,
	fileLength = data.length,
): LeafPackLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		data.toString("latin1", PACK_WORD_FIELD, PACK_WORD_FIELD + 4) !== PACK_WORD
	) {
		return undefined;
	}
	if (fileLength < HEADER_SIZE) return undefined;
	const count = data.readInt16LE(COUNT_FIELD);
	if (count <= 0 || count >= MAXIMUM_COUNT) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (indexSize >= fileLength) return undefined;
	const indexOffset = fileLength - indexSize;
	if (indexOffset + indexSize > data.length) return undefined;
	const index = decryptLeafPlaces(
		Buffer.from(data.subarray(indexOffset, indexOffset + indexSize)),
	);
	const entries: LeafPackEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const at = id * RECORD_SIZE;
		const name = readName(index, at);
		if (!name) return undefined;
		const offset = index.readUInt32LE(at + OFFSET_FIELD);
		const size = index.readUInt32LE(at + SIZE_FIELD);
		if (offset > fileLength || offset + size > fileLength) return undefined;
		entries.push({ name, offset, size });
	}
	return { count, indexOffset, indexSize, entries };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLeafPack(source: ByteSource) {
	const stored = await readStored(source);
	const layout = readLeafPackLayout(stored, Number(source.size));
	if (!layout) throw invalidArchive("Not a Leaf resource archive");
	return { stored, layout };
}

export const leafPakDescriptor: FormatDescriptor = {
	id: "leaf-pak",
	name: "Leaf resource archive",
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
			source: "ArcFormats/Leaf/ArcLEAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const leafPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafPakDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		void sourcePath;
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const stored = await readStored(source);
			return readLeafPackLayout(stored, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const { layout } = await readLeafPack(source);
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
				indexOffset: layout.indexOffset,
				encrypted: true,
			},
		};
	},
	async openEntry(source: ByteSource, entry) {
		const stored = await readStored(source);
		const start = Number(entry.offset);
		const end = start + Number(entry.size);
		if (start < 0 || end > stored.length) {
			throw invalidArchive("Leaf archive entry stands outside the archive");
		}
		// Every place of a file stands under the walk of the key of the title, which stands over from the front
		// of the file.
		return Readable.from([decryptLeafPlaces(stored.subarray(start, end))]);
	},
});
