// Format reference: GARbro "ArcFormats/Ffa/AudioWA1.cs", classes `Wa1Audio` and `Wa1Reader` (an FFA System
// sound of four kinds: the walk of its samples takes either a nibble of a byte or a code of two to eight
// places, and the sound is either of one channel or of two, whose channels stand one after the other in the
// walk and side by side in the sound). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { WA_SAMPLE_TABLE } from "./wa-core.js";

/** 'RIFF', which the plain shape of this engine carries behind its own first word. */
const RIFF_MARK = Buffer.from("RIFF", "latin1");
const RIFF_FIELD = 0x04;
/** Where the head of the wave file stands inside the file, and where it ends. */
const WAVE_HEADER_FIELD = 0x04;
const WAVE_HEADER_SIZE = 0x2c;
/** The marks of the chunk the samples stand in. */
const DATA_MARK = Buffer.from("data", "latin1");
const DATA_FIELD = 0x28;
const DATA_SIZE_FIELD = 0x2c;
/** The four kinds of sound the reference reads, and the two ways they differ. */
const KINDS: Record<number, { bits: boolean; stereo: boolean }> = {
	0: { bits: false, stereo: false },
	4: { bits: true, stereo: false },
	8: { bits: false, stereo: true },
	12: { bits: true, stereo: true },
};
/** The head of the shape whose samples stand wrapped up in a walk of runs of their own. */
const CONTAINER_SIZE = 8;
const PACKED_SIZE_FIELD = 0x00;
const UNPACKED_SIZE_FIELD = 0x04;
/** The step the walk stands at before it begins, and the least it may stand at. */
const INITIAL_STEP = 0x7f;
/** The greatest step the walk may stand at. */
const MAXIMUM_STEP = 0x6000;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface Wa1Layout {
	/** Which of the four kinds of sound at hand. */
	kind: number;
	/** The bytes of the samples, which the head of the wave file names. */
	dataSize: number;
}

export interface Wa1ContainerLayout {
	/** The bytes of the walk of runs. */
	packedSize: number;
	/** The bytes the walk gives. */
	unpackedSize: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Wa1Reader`: a plain sound begins with its own kind at nought — nought, four, eight or twelve — and then a
 * wave file: the word `RIFF` at four, the chunk named `data` at `0x28`, and the size of the samples at
 * `0x2C`. The head of the wave file stands from four and is thirty two bytes wide, the samples standing
 * behind it.
 */
export function readWa1Layout(
	data: Buffer,
	fileLength = data.length,
): Wa1Layout | undefined {
	if (data.length < WAVE_HEADER_SIZE) return undefined;
	const kind = data.readInt32LE(0);
	if (!(kind in KINDS)) return undefined;
	if (
		!data.subarray(RIFF_FIELD, RIFF_FIELD + RIFF_MARK.length).equals(RIFF_MARK)
	) {
		return undefined;
	}
	if (
		!data.subarray(DATA_FIELD, DATA_FIELD + DATA_MARK.length).equals(DATA_MARK)
	) {
		return undefined;
	}
	const dataSize = data.readInt32LE(DATA_SIZE_FIELD);
	if (dataSize < 0 || dataSize > LIMIT) return undefined;
	if (WAVE_HEADER_FIELD + WAVE_HEADER_SIZE > fileLength) return undefined;
	return { kind, dataSize };
}

/**
 * `Wa1Audio.TryOpen`, the shape whose samples stand wrapped up: where the first word of the file stands above
 * twelve it is the size of a walk of runs and the second word is what that walk gives, and the walk itself
 * stands behind the eight bytes of the two words and runs to the end of the file.
 */
export function readWa1ContainerLayout(
	data: Buffer,
	fileLength = data.length,
): Wa1ContainerLayout | undefined {
	if (data.length < CONTAINER_SIZE) return undefined;
	const packedSize = data.readInt32LE(PACKED_SIZE_FIELD);
	if (packedSize <= 12) return undefined;
	if (packedSize + CONTAINER_SIZE !== fileLength) return undefined;
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_FIELD);
	if (unpackedSize <= 0 || unpackedSize > LIMIT) return undefined;
	return { packedSize, unpackedSize };
}

interface Wa1Cursor {
	data: Buffer;
	position: number;
}

interface Wa1Walk {
	sample: number;
	step: number;
}

function walkStep(walk: Wa1Walk, code: number): number {
	const difference = (walk.step * (((code & 7) << 1) + 1)) >> 3;
	if (0 !== (code & 8)) {
		walk.sample -= difference;
		if (walk.sample < -32768) walk.sample = -32768;
	} else {
		walk.sample += difference;
		if (walk.sample > 32767) walk.sample = 32767;
	}
	const next = ((WA_SAMPLE_TABLE[code] ?? 0) * walk.step) >> 6;
	if (next < INITIAL_STEP) walk.step = INITIAL_STEP;
	else if (next > MAXIMUM_STEP) walk.step = MAXIMUM_STEP;
	else walk.step = next;
	return walk.sample & 0xffff;
}

/**
 * The walk of the first and the third kind takes a nibble at a time, the higher nibble of a byte first and the
 * lower one behind it. The reference holds what it reads in a byte with a mark over it: without the mark it
 * looks at the byte the walk stands at and keeps its higher nibble, and with the mark it takes that byte out
 * of the file and keeps its lower nibble. The port keeps which of the two it is about to do, which is the same
 * walk over the same bytes.
 */
interface Wa1NibbleState {
	/** Whether the higher nibble of the byte at hand is the next one. */
	high: boolean;
}

interface Wa1BitState {
	places: number;
	/** How many places stand there. */
	count: number;
}

function readNibble(cursor: Wa1Cursor, state: Wa1NibbleState): number {
	if (cursor.position >= cursor.data.length) {
		throw invalidSound("FFA System sound is cut short of its walk");
	}
	const byte = cursor.data[cursor.position] ?? 0;
	if (state.high) {
		state.high = false;
		return byte >> 4;
	}
	state.high = true;
	cursor.position += 1;
	return byte & 0x0f;
}

function readCode(cursor: Wa1Cursor, state: Wa1BitState): number {
	if (state.count < 8) {
		if (cursor.position >= cursor.data.length) {
			throw invalidSound("FFA System sound is cut short of its walk");
		}
		state.places |= (cursor.data[cursor.position] ?? 0) << state.count;
		cursor.position += 1;
		state.count += 8;
	}
	const places = state.places;
	let code: number;
	let used: number;
	if (2 === (places & 3)) {
		code = 0;
		used = 2;
	} else if (0 === (places & 3)) {
		code = 8;
		used = 2;
	} else if (5 === (places & 7)) {
		code = 1;
		used = 3;
	} else if (1 === (places & 7)) {
		code = 9;
		used = 3;
	} else if (11 === (places & 0xf)) {
		code = 2;
		used = 4;
	} else if (3 === (places & 0xf)) {
		code = 10;
		used = 4;
	} else if (23 === (places & 0x1f)) {
		code = 3;
		used = 5;
	} else if (7 === (places & 0x1f)) {
		code = 11;
		used = 5;
	} else if (47 === (places & 0x3f)) {
		code = 4;
		used = 6;
	} else if (15 === (places & 0x3f)) {
		code = 12;
		used = 6;
	} else if (95 === (places & 0x7f)) {
		code = 5;
		used = 7;
	} else if (31 === (places & 0x7f)) {
		code = 13;
		used = 7;
	} else {
		switch (places & 0xff) {
			case 0x7f:
				code = 6;
				break;
			case 0xff:
				code = 14;
				break;
			case 0xbf:
				code = 7;
				break;
			default:
				code = 15;
				break;
		}
		used = 8;
	}
	state.places >>>= used;
	state.count -= used;
	return code;
}

/**
 * `Wa1Reader.Unpack`: the samples stand behind the head of the wave file, as many bytes of them as the head
 * says. A sound of one channel takes a code a sample; a sound of two takes the first half of the codes for
 * its left channel and the second half for its right, the two standing side by side in the sound, and every
 * channel standing at the beginning of the walk again.
 */
export function decodeWa1(data: Buffer, layout: Wa1Layout): Buffer {
	const kind = KINDS[layout.kind];
	if (!kind) throw invalidSound("FFA System sound of a kind it does not know");
	const output: Buffer = Buffer.alloc(layout.dataSize, 0x00);
	// The head of the wave file stands from four, so the samples stand behind it at `0x30`.
	const cursor: Wa1Cursor = {
		data,
		position: WAVE_HEADER_FIELD + WAVE_HEADER_SIZE,
	};
	const places: Wa1BitState = { places: 0, count: 0 };
	if (!kind.stereo) {
		const samples = layout.dataSize >> 1;
		const walk: Wa1Walk = { sample: 0, step: INITIAL_STEP };
		const nibbles: Wa1NibbleState = { high: true };
		const nextCode = (): number =>
			kind.bits ? readCode(cursor, places) : readNibble(cursor, nibbles);
		for (let index = 0; index < samples; index += 1) {
			output.writeUInt16LE(walkStep(walk, nextCode()), index * 2);
		}
		return output;
	}
	const samples = layout.dataSize >> 2;
	for (let channel = 0; channel < 2; channel += 1) {
		// Every channel begins the walk again: a sound of two channels of the second kind stands at the
		// beginning of the walk and a sound of the fourth kind keeps the places it has read.
		const nibbles: Wa1NibbleState = { high: true };
		const nextCode = (): number =>
			kind.bits ? readCode(cursor, places) : readNibble(cursor, nibbles);
		const walk: Wa1Walk = { sample: 0, step: INITIAL_STEP };
		let dst = channel * 2;
		for (let index = 0; index < samples; index += 1) {
			output.writeUInt16LE(walkStep(walk, nextCode()), dst);
			dst += 4;
		}
	}
	return output;
}

/** The wave file a sound of this engine stands in: the head of the file and the samples behind it. */
export function buildWa1Wave(data: Buffer, samples: Buffer): Buffer {
	const wave = Buffer.concat([
		Buffer.from(
			data.subarray(WAVE_HEADER_FIELD, WAVE_HEADER_FIELD + WAVE_HEADER_SIZE),
		),
		samples,
	]);
	// The reference writes the size of the wave file at four, behind the word that stands there.
	wave.writeUInt32LE(wave.length - 8, 4);
	return wave;
}

/**
 * `Wa1Audio.TryOpen`: where the samples stand wrapped up in a walk of runs, that walk is unwrapped first. What
 * it gives is either a wave file of its own — and that is what is handed out — or the plain shape of this
 * engine, which is then walked.
 */
export async function readWa1Sound(
	stored: Buffer,
	fileLength: number,
): Promise<Buffer | undefined> {
	const plain = readWa1Layout(stored, fileLength);
	if (plain) return buildWa1Wave(stored, decodeWa1(stored, plain));
	const container = readWa1ContainerLayout(stored, fileLength);
	if (!container) return undefined;
	const unpacked = inflateLzss(
		stored.subarray(CONTAINER_SIZE, CONTAINER_SIZE + container.packedSize),
		{ outputLength: container.unpackedSize },
	);
	if (unpacked.subarray(0, RIFF_MARK.length).equals(RIFF_MARK)) {
		return Buffer.from(unpacked);
	}
	const layout = readWa1Layout(unpacked, unpacked.length);
	if (!layout) return undefined;
	return buildWa1Wave(unpacked, decodeWa1(unpacked, layout));
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ffaWa1AudioDescriptor: FormatDescriptor = {
	id: "ffa-wa1-audio",
	name: "FFA System wave audio format",
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
			source: "ArcFormats/Ffa/AudioWA1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ffaWa1AudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ffaWa1AudioDescriptor,
	// The reference registers no word at all and no name: its two shapes are told apart by what stands at the
	// beginning of the file.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(CONTAINER_SIZE)) return false;
		try {
			const wanted = Number(
				source.size < BigInt(WAVE_HEADER_SIZE)
					? source.size
					: BigInt(WAVE_HEADER_SIZE),
			);
			const header = Buffer.from(await source.readAt(0n, wanted));
			// Where the samples stand wrapped up, the walk of runs is unwrapped only on extraction, so the
			// word that tells the two shapes apart is enough here.
			return (
				readWa1Layout(header, Number(source.size)) !== undefined ||
				readWa1ContainerLayout(header, Number(source.size)) !== undefined
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const plain = readWa1Layout(stored, Number(source.size));
		const container = readWa1ContainerLayout(stored, Number(source.size));
		if (!plain && !container) {
			throw invalidSound("Not an FFA System sound");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(
					plain ? WAVE_HEADER_FIELD + WAVE_HEADER_SIZE : CONTAINER_SIZE,
				),
				size:
					source.size -
					BigInt(plain ? WAVE_HEADER_FIELD + WAVE_HEADER_SIZE : CONTAINER_SIZE),
				compressed: true,
				metadata: {
					type: "audio",
					kind: plain ? plain.kind : 0,
					dataSize: plain ? plain.dataSize : container?.unpackedSize,
				},
			}),
			// The samples are unwrapped and the head of the wave file stands as it is.
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				codec: "adpcm",
				kind: plain ? plain.kind : 0,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const wave = await readWa1Sound(stored, Number(source.size));
		if (!wave) throw invalidSound("Not an FFA System sound");
		return Readable.from([wave]);
	},
});
