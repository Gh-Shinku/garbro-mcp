// Format reference: GARbro "Legacy/Ags32i/AudioAGS.cs", class `AgsAudio`, with the cipher from
// "Legacy/Ags32i/ImageGSS.cs", class `Ags32Transform` (a standalone audio resource: an encrypted
// wave file; the whole stream is decrypted with a four byte block cipher).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * The reference declares the signature list `{ 0x66424047, 0 }`: the first four bytes are the
 * encrypted `RIFF` tag, so the key is that word exclusive-ored with `'RIFF'`.
 */
const SIGNATURES = [
	// 0x66424047 in little endian, then the zero word.
	Buffer.from([0x47, 0x40, 0x42, 0x66]),
	Buffer.alloc(4),
];
const RIFF_SIGNATURE = 0x46464952;
const HEADER_SIZE = 12;
const WAVE_OFFSET = 8;
const WAVE = Buffer.from("WAVE", "latin1");
/** `Ags32Transform` works on four byte blocks and rotates within a period of 31 blocks. */
const BLOCK_SIZE = 4;
const PERIOD = 31;

function rotateLeft32(value: number, count: number): number {
	const shift = count & 31;
	return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** The four byte keystream word for a block index, per `Ags32Transform.TransformBlock`. */
function keystreamWord(key: number, blockIndex: number): number {
	const quotient = Math.floor(blockIndex / PERIOD);
	const remainder = blockIndex % PERIOD;
	return rotateLeft32((key + quotient) >>> 0, remainder);
}

/**
 * Decrypts a range of the stream in place. The reference's `TransformFinalBlock` uses a buggy index
 * expression that garbles up to three trailing bytes; the port keeps the plain per-byte formula for
 * every byte and documents the deviation.
 */
function decrypt(data: Buffer, key: number, position = 0): Buffer {
	const output: Buffer = Buffer.alloc(data.length);
	for (let i = 0; i < data.length; i += 1) {
		const absolute = position + i;
		const word = keystreamWord(key, Math.floor(absolute / BLOCK_SIZE));
		const mask = (word >>> ((absolute % BLOCK_SIZE) * 8)) & 0xff;
		output[i] = (data[i] ?? 0) ^ mask;
	}
	return output;
}

/** GARbro `AgsAudio.TryOpen`: decrypt the header, then require `WAVE` at offset eight. */
async function readKey(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const stored = header.subarray(0, 4);
		if (!SIGNATURES.some((allowed) => allowed.equals(stored))) return undefined;
		const key = (stored.readUInt32LE(0) ^ RIFF_SIGNATURE) >>> 0;
		if (key === 0) return undefined;
		const plain = decrypt(header, key);
		return plain.subarray(WAVE_OFFSET, WAVE_OFFSET + 4).equals(WAVE)
			? key
			: undefined;
	} catch {
		return undefined;
	}
}

export const agsAudioDescriptor: FormatDescriptor = {
	id: "ags32i-wav-audio",
	name: "AGS32i engine encrypted wave audio",
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
			source: "Legacy/Ags32i/AudioAGS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const agsAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: agsAudioDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readKey(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const key = await readKey(source);
		if (key === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AGS32i wave audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "wav"),
			offset: 0n,
			size: source.size,
			encrypted: true,
			metadata: { type: "audio" } as Record<string, unknown>,
		});
		return { entries: [entry], metadata: { audio: "wav", key } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const key = await readKey(source);
		if (key === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AGS32i wave audio");
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		// The cipher is a keystream, so decrypting keeps the length.
		return Readable.from([decrypt(data, key)]);
	},
});
