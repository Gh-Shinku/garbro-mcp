// Format reference: GARbro "Legacy/Pisckiss/Audio0.cs", class `Audio1` (Pisckiss encrypted audio; the class
// name and the file name disagree in the reference itself).
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
import { readWave, writeWave } from "../shared/wav.js";

/** The two bits of the first byte that say how much of the file is not payload. */
const VARIANT_BITS = 0x42;
/** Those bits are masked out of the key; every other bit of the first byte seeds it. */
const KEY_MASK = 0xbd;
const KEY_SEED = 0x6a8cd4e7;
/** The payload always starts after the first byte. */
const PAYLOAD_OFFSET = 1;
/** The first byte plus the four the marker is read from. */
const HEADER_SIZE = 5;

/**
 * One step of the reference's thirty two bit shift register: the new bit is the exclusive or of bits 31 and 16.
 * The step reads the register as **unsigned**, so the shift that fetches bit 31 has to be logical.
 */
function stepKey(key: number): number {
	const feedback = ((key & 0x10000) ^ (key >>> 15)) >>> 16;
	return ((key << 1) | (feedback & 1)) >>> 0;
}

/** The key is stepped once per byte and only its low eight bits are used. */
function decrypt(data: Buffer, key: number): Buffer {
	const out: Buffer = Buffer.alloc(data.length);
	let state = key;
	for (let index = 0; index < data.length; index += 1) {
		out[index] = (data[index] ?? 0) ^ (state & 0xff);
		state = stepKey(state);
	}
	return out;
}

interface PisckissAudioLayout {
	/** Which container the decrypted marker named. */
	kind: "wav" | "ogg";
	/** How many bytes of the file are payload, counted from the first byte's end. */
	payloadLength: number;
	key: number;
}

/**
 * The first byte is a key seed and a length tag at once. Its two high value bits, 0x40 and 0x02, are read as a
 * three way switch: both set means the last **two** bytes of the file are not payload, exactly one set means the
 * last byte is not, and neither set means this is not a Pisckiss file at all. Every other bit of that byte seeds
 * the key, and the key is the same one the marker check and the extraction use.
 *
 * The marker is the decrypted first four bytes after that byte, and only `RIFF` and `OggS` are accepted.
 */
async function readFields(
	source: ByteSource,
): Promise<PisckissAudioLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE - 1)) return undefined;
	let head: Buffer;
	try {
		// A file this short cannot supply the four bytes the marker is read from, and the reference's read
		// would fail, so such a file is simply not recognised.
		head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	} catch {
		return undefined;
	}
	const first = head[0] ?? 0;
	const bits = first & VARIANT_BITS;
	let trimmed: number;
	if (bits === VARIANT_BITS) trimmed = 3;
	else if (bits === 0x02 || bits === 0x40) trimmed = 1;
	else return undefined;
	const key = ((first & KEY_MASK) ^ KEY_SEED) >>> 0;
	const marker = decrypt(
		Buffer.from(head.subarray(1, HEADER_SIZE)),
		key,
	).toString("latin1");
	const kind =
		marker === "RIFF" ? "wav" : marker === "OggS" ? "ogg" : undefined;
	if (!kind) return undefined;
	return { kind, payloadLength: Number(source.size) - trimmed, key };
}

export const pisckissAudioDescriptor: FormatDescriptor = {
	id: "pisckiss-audio",
	name: "Pisckiss encrypted audio",
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
			source: "Legacy/Pisckiss/Audio0.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pisckissAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pisckissAudioDescriptor,
	// No signature: the seeded first byte and the decrypted marker are what identify the format.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pisckiss audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const extension = layout.kind === "wav" ? "wav" : "ogg";
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, extension),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// The output drops the file's first byte and its trailing bytes, and a wave is re-serialised.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: { audio: layout.kind },
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pisckiss audio");
		const stored = Buffer.from(
			await source.readAt(BigInt(PAYLOAD_OFFSET), layout.payloadLength),
		);
		const decoded = decrypt(stored, layout.key);
		if (layout.kind === "ogg") {
			// The payload is an Ogg stream, which the port carries over rather than decoding.
			return Readable.from([decoded]);
		}
		const wave = readWave(decoded);
		if (!wave)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pisckiss wave");
		// The reference hands the decrypted bytes to its wave reader and re-serialises the samples.
		const pcm = decoded.subarray(
			wave.dataOffset,
			wave.dataOffset + wave.dataSize,
		);
		return Readable.from([writeWave(wave.format, pcm)]);
	},
});
