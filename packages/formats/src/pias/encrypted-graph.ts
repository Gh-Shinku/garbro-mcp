// Format reference: GARbro "Legacy/Pias/EncryptedGraphDat.cs", classes `EncryptedDatOpener`,
// `EncryptedIndexReader`, `KeyGenerator` and `PiasTransform`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeRiffHeader } from "../kapp/asd.js";
import { readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	AUDIO_HEADER_SIZE,
	buildPiasEntries,
	readClamped,
	readTextOffsets,
	resourceTypeOf,
	type PiasEntry,
} from "./dat.js";

/**
 * `EncryptedDatOpener.Signatures`: the plain signature of the encrypted text.dat list. The zero entry
 * covers lists that start with four zero bytes.
 */
const TEXT_SIGNATURES = new Set([0x02f3a62b, 0]);
/** The encrypted size field keeps twenty bits and adds the eight byte entry header. */
const SIZE_MASK = 0xfffff;
const ENTRY_HEADER_SIZE = 8;
/** The variant only serves these two archives. */
const SOUND_ARCHIVE = "sound.dat";
const GRAPHICS_ARCHIVE = "graph.dat";
const TEXT_NAME = "text.dat";
/** Audio entries are sixteen bit stereo PCM. */
const AUDIO_CHANNELS = 2;
const AUDIO_SAMPLE_RATE = 22050;
const AUDIO_BITS_PER_SAMPLE = 16;
const AUDIO_BLOCK_ALIGN = (AUDIO_CHANNELS * AUDIO_BITS_PER_SAMPLE) / 8;

/**
 * `KeyGenerator`: a shift register seeded per entry. Types select the graph, text and save key
 * constants; the returned word is the new state after one step.
 */
const KEY_PARAMETERS = [
	{ x: 0xd22, y: 0x849 },
	{ x: 0xf43, y: 0x356b },
	{ x: 0x292, y: 0x57a7 },
];

class KeyGenerator {
	readonly #x: number;
	readonly #y: number;
	#seed = 0;

	constructor(type: number) {
		const parameters = KEY_PARAMETERS[type] ?? { x: 0, y: 0 };
		this.#x = parameters.x;
		this.#y = parameters.y;
	}

	seed(value: number): void {
		this.#seed = value >>> 0;
	}

	next(): number {
		// The reference multiplies unsigned 32 bit values, and the product stays exact in a double.
		const value = (this.#x + this.#seed * this.#y) >>> 0;
		const feedback = ((value >>> 22) & 1) ^ ((value >>> 10) & 1) ^ (value & 1);
		this.#seed = ((value >>> 1) | (feedback << 31)) >>> 0;
		return this.#seed;
	}
}

/** `PiasTransform` and `EncryptedIndexReader.Decrypt`: every byte is masked with the key's low byte. */
function decryptWithKey(data: Buffer, key: KeyGenerator): Buffer {
	for (let index = 0; index < data.length; index += 1)
		data[index] = (data[index] ?? 0) ^ (key.next() & 0xff);
	return data;
}

/** Reads four bytes at an offset, refusing offsets that do not fit in the file. */
async function readUInt32At(
	source: ByteSource,
	offset: number,
): Promise<number | undefined> {
	if (offset < 0 || BigInt(offset + 4) > source.size) return undefined;
	return Buffer.from(await source.readAt(BigInt(offset), 4)).readUInt32LE(0);
}

/** Decrypts four bytes at an offset with a key seeded by the word in front of them. */
async function readEncryptedSize(
	source: ByteSource,
	offset: number,
): Promise<number | undefined> {
	const seed = await readUInt32At(source, offset);
	if (seed === undefined || BigInt(offset + ENTRY_HEADER_SIZE) > source.size)
		return undefined;
	const key = new KeyGenerator(0);
	key.seed(seed);
	const buffer = Buffer.from(await source.readAt(BigInt(offset + 4), 4));
	decryptWithKey(buffer, key);
	return (buffer.readUInt32LE(0) & SIZE_MASK) + ENTRY_HEADER_SIZE;
}

/**
 * `EncryptedIndexReader.GetIndex`: the text.dat list is decrypted with the text key, and its
 * signature has to be one the format knows.
 */
async function readEncryptedText(
	sourcePath: string,
	resourceType: "graphics" | "sound",
): Promise<{ offsets: number[]; plain: Buffer } | undefined> {
	const raw = await readCompanionFile(sourcePath, TEXT_NAME);
	if (!raw || raw.length < 4) return undefined;
	const signature = raw.readUInt32LE(0);
	if (!TEXT_SIGNATURES.has(signature)) return undefined;
	const key = new KeyGenerator(1);
	key.seed(signature);
	// The reference positions the stream at four before it attaches the cipher.
	const plain = decryptWithKey(Buffer.from(raw.subarray(4)), key);
	const offsets = readTextOffsets(plain, resourceType);
	if (!offsets) return undefined;
	return { offsets, plain };
}

async function buildEncryptedEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: PiasEntry[]; encrypted: boolean } | undefined> {
	const resourceType = resourceTypeOf(sourcePath);
	if (resourceType !== "sound" && resourceType !== "graphics") return undefined;
	const text = await readEncryptedText(sourcePath, resourceType);
	if (!text) return undefined;
	if (resourceType === "sound") {
		// Sound archives keep the plain index layout, they only encrypt the text list.
		const entries = await buildPiasEntries(source, sourcePath, text.plain);
		return entries ? { entries, encrypted: false } : undefined;
	}
	const entries: PiasEntry[] = text.offsets.map((offset, index) => ({
		name: index.toString().padStart(4, "0"),
		type: "image",
		offset,
		size: 0,
	}));
	// The reference walks the text list backwards, replacing every size with the encrypted one.
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (!entry) continue;
		const size = await readEncryptedSize(source, entry.offset);
		if (size === undefined) return undefined;
		entry.size = size;
	}
	// Then it walks the whole file and adds the entries the list did not mention.
	const known = new Set(entries.map((entry) => entry.offset));
	const limit = Number(source.size);
	let offset = 0;
	while (offset < limit) {
		if (offset + ENTRY_HEADER_SIZE > limit) break;
		const size = await readEncryptedSize(source, offset);
		if (size === undefined) return undefined;
		if (!known.has(offset)) {
			if (!checkPlacement(BigInt(offset), BigInt(size), source.size))
				return undefined;
			entries.push({
				name: `${offset.toString().padStart(8, "0")}_`,
				type: "image",
				offset,
				size,
			});
		}
		offset += size + 4;
	}
	return { entries, encrypted: true };
}

export const piasEncryptedDescriptor: FormatDescriptor = {
	id: "pias-encrypted-dat",
	name: "Pias encrypted resource archive",
	extensions: ["dat"],
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
			source: "Legacy/Pias/EncryptedGraphDat.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const piasEncryptedFormat: ArchiveFormat = defineFixedArchive({
	descriptor: piasEncryptedDescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from([0x2b, 0xa6, 0xf3, 0x02]) },
			{ bytes: Buffer.alloc(4) },
		],
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		const name = (sourcePath.split(/[\\/]/).pop() ?? "").toLowerCase();
		if (name !== SOUND_ARCHIVE && name !== GRAPHICS_ARCHIVE) return false;
		return (await buildEncryptedEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const parsed = await buildEncryptedEntries(source, sourcePath);
		if (!parsed)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pias encrypted index");
		const fixed: FixedEntry[] = parsed.entries.map((entry, id) => {
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: BigInt(entry.offset),
				size: BigInt(entry.size),
				encrypted: parsed.encrypted,
				metadata: { type: entry.type },
			});
			// Audio entries gain a RIFF header, and an encrypted image entry reads a fixed span that
			// can be cut short by the end of the file.
			return entry.type === "audio" || parsed.encrypted
				? { ...created, sizeKnown: false }
				: created;
		});
		return {
			entries: fixed,
			metadata: {
				entryCount: fixed.length,
				resourceType: resourceTypeOf(sourcePath),
				encrypted: parsed.encrypted,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const type = (entry.metadata as { type?: string } | undefined)?.type;
		if (type === "audio") {
			const dataSize = Number(entry.size) - AUDIO_HEADER_SIZE;
			const data = await readClamped(
				source,
				entry.offset + BigInt(AUDIO_HEADER_SIZE),
				dataSize,
			);
			// The encrypted flavour uses sixteen bit stereo PCM for sound.dat.
			const header = writeRiffHeader(
				{
					formatTag: 1,
					channels: AUDIO_CHANNELS,
					sampleRate: AUDIO_SAMPLE_RATE,
					averageBytesPerSecond: AUDIO_SAMPLE_RATE * AUDIO_BLOCK_ALIGN,
					blockAlign: AUDIO_BLOCK_ALIGN,
					bitsPerSample: AUDIO_BITS_PER_SAMPLE,
				},
				data.length,
			);
			return Readable.from([header, data]);
		}
		const seed = await readUInt32At(source, Number(entry.offset));
		if (seed === undefined) return Readable.from([]);
		const key = new KeyGenerator(0);
		key.seed(seed);
		// `OpenEncrypted` reads the recorded size from behind the seed word.
		const data = await readClamped(
			source,
			entry.offset + 4n,
			Number(entry.size),
		);
		return Readable.from([decryptWithKey(data, key)]);
	},
});
