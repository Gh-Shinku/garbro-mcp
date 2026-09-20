// Format reference: GARbro "ArcFormats/ShiinaRio/AudioPAD.cs", class `PadAudio` and the `PadDecoder` it
// hands the packed stream to. The decoder's own table indices are kept, because it reads its filter
// coefficients out of the same table it loads the residuals into and seeds only some of the slots.
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
import type { WavFormat } from "../shared/wav.js";

/** 'PAD', the format signature as a little endian word. The rest of the file opens like a wave. */
const SIGNATURE = Buffer.from("PAD", "latin1");
/** The header the reference rereads, and the size of the samples it declares at the end of it. */
const HEADER_SIZE = 0x2c;
const PCM_SIZE_FIELD = 0x28;
const CHANNELS_FIELD = 0x16;
/** The parts of that header the reference's wave reader insists on. */
const WAVE_TAG_FIELD = 0x08;
const FORMAT_TAG_FIELD = 0x0c;
const FORMAT_SIZE_FIELD = 0x10;
const DATA_TAG_FIELD = 0x24;
const FORMAT_CHUNK_MINIMUM = 16;
/** The fields the sound is described with; the samples are always sixteen bit. */
const WAVE_FORMAT_TAG_FIELD = 0x14;
const SAMPLE_RATE_FIELD = 0x18;
const AVERAGE_BYTES_FIELD = 0x1c;
const BLOCK_ALIGN_FIELD = 0x20;
const BITS_PER_SAMPLE_FIELD = 0x22;
const PCM_FORMAT = 1;
const BITS_PER_SAMPLE = 16;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/**
 * The reference's table of doubles. Slots 13 to 40 hold a block of the left channel and 41 to 68 a block of
 * the right one; a filter index picks its coefficient pair out of the low slots, which is why the seeded
 * coefficients and the loaded residuals share the one table.
 */
const TABLE_SIZE = 69;
const LEFT_SLOT = 13;
const RIGHT_SLOT = 41;
/** A block carries twenty eight samples a channel, and fourteen bytes of nibbles load them. */
const BLOCK_SAMPLES = 28;
const LOAD_BYTES = 14;
/** The low slots the reference seeds: the coefficient pairs filter indices two to four reach. */
const SEEDED_COEFFICIENTS: readonly (readonly [number, number])[] = [
	[4, 0.9375],
	[6, 1.796875],
	[7, -0.8125],
	[8, 1.53125],
	[9, -0.859375],
	[10, 1.90625],
	[11, -0.9375],
];
/** The byte that ends the packed stream. */
const STREAM_END = 0xff;
const CHANNEL_PAIR = 2;
/**
 * The reference allocates its output past the samples the header declares; the write of a last block that
 * overruns the declared size is absorbed by those bytes. A stream that overruns even them is refused.
 */
const OUTPUT_SLACK = 0x9c;

export interface PadLayout {
	format: WavFormat;
	/** How many bytes of samples the header declares. */
	pcmSize: number;
	channels: number;
	/** Where the packed stream starts and how long it is. */
	packedOffset: number;
	packedSize: number;
}

function invalidAudio(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PadAudio.TryOpen`: the file opens with the word `PAD` in front of a wave header, and the field that a
 * wave file would use for the samples holds the length of them. The reference reads the header as it stands
 * and then builds its wave reader around a copy of it, so the header has to be one that reader accepts:
 * the `WAVE` marker, a `fmt ` chunk of at least sixteen bytes and a `data` marker at the twenty four byte
 * mark, which is where a canonical header of forty four bytes puts them.
 */
export function readPadLayout(data: Buffer): PadLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (data.toString("latin1", WAVE_TAG_FIELD, WAVE_TAG_FIELD + 4) !== "WAVE")
		return undefined;
	if (
		data.toString("latin1", FORMAT_TAG_FIELD, FORMAT_TAG_FIELD + 4) !== "fmt "
	)
		return undefined;
	if (data.readUInt32LE(FORMAT_SIZE_FIELD) < FORMAT_CHUNK_MINIMUM)
		return undefined;
	if (data.toString("latin1", DATA_TAG_FIELD, DATA_TAG_FIELD + 4) !== "data")
		return undefined;
	const pcmSize = data.readInt32LE(PCM_SIZE_FIELD);
	if (pcmSize <= 0 || pcmSize > LIMIT) return undefined;
	const channels = data.readUInt16LE(CHANNELS_FIELD);
	if (channels !== 1 && channels !== CHANNEL_PAIR) return undefined;
	if (data.readUInt16LE(WAVE_FORMAT_TAG_FIELD) !== PCM_FORMAT) return undefined;
	if (data.readUInt16LE(BITS_PER_SAMPLE_FIELD) !== BITS_PER_SAMPLE)
		return undefined;
	return {
		format: {
			formatTag: PCM_FORMAT,
			channels,
			sampleRate: data.readUInt32LE(SAMPLE_RATE_FIELD),
			averageBytesPerSecond: data.readUInt32LE(AVERAGE_BYTES_FIELD),
			blockAlign: data.readUInt16LE(BLOCK_ALIGN_FIELD),
			bitsPerSample: BITS_PER_SAMPLE,
		},
		pcmSize,
		channels,
		packedOffset: HEADER_SIZE,
		packedSize: data.length - HEADER_SIZE,
	};
}

/**
 * `PadAudio.TryOpen`: the reference replaces the word that stands where a wave file keeps `RIFF` and the
 * length behind it with the length of the samples plus the twenty four bytes of chunk headers, and copies
 * the rest of the header as it stands. The port does the same, so its wave file is the one the reference
 * hands its own reader.
 */
function patchedPadHeader(stored: Buffer, pcmSize: number): Buffer {
	const header = Buffer.from(stored.subarray(0, HEADER_SIZE));
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(pcmSize + HEADER_SIZE - 8, 4);
	return header;
}

/**
 * The reference's `(short)(value + 0.5)`: a double is truncated toward zero into a thirty two bit word and
 * the low half of that word becomes the sample. A value no thirty two bit word can hold becomes the
 * smallest one, which is what the conversion instruction behind the cast produces.
 */
function toSample(value: number): number {
	const rounded = Math.trunc(value + 0.5);
	const word =
		rounded >= -2147483648 && rounded <= 2147483647 ? rounded : -2147483648;
	return (word << 16) >> 16;
}

/** The nibble of a byte, sign extended from the sixteenth bit the way the reference loads it. */
function signExtended(byte: number, mask: number, shift: number): number {
	const value = (byte & mask) << shift;
	return 0 !== (value & 0x8000) ? value | ~0xffff : value;
}

/** The scratch the reference uses to keep one shift amount in the top half of a double. */
const bitsScratch = new DataView(new ArrayBuffer(8));

function doubleBits(value: number): bigint {
	bitsScratch.setFloat64(0, value);
	return bitsScratch.getBigUint64(0);
}

function bitsDouble(bits: bigint): number {
	bitsScratch.setBigUint64(0, bits);
	return bitsScratch.getFloat64(0);
}

/**
 * `PadDecoder.Unpack`: the packed stream is a run of blocks, each opening with a marker byte that a `0xFF`
 * ends the stream on. A block holds a control byte whose high nibble picks the filter pair and whose low
 * nibble is the shift the residuals are halved with, then, when the sound has two channels, a byte whose
 * low nibble is the right channel's shift and whose high nibble its filter index -- the byte in front of
 * that one is stepped over unread, as the reference does. Fourteen bytes a channel follow, each carrying
 * two residuals, the low nibble one and the high nibble the next.
 *
 * Every residual is sign extended from its sixteenth bit, shifted right by its own channel's shift and
 * added to a two tap prediction of the two samples before it, whose coefficients are the pair the filter
 * index names. Those pairs live in the table's low slots -- some seeded, some loaded from earlier slots of
 * the block itself -- so a filter index of five or more reaches into what the block just loaded.
 *
 * The samples are then truncated toward zero through a half, which is the reference's own cast. The state
 * the prediction runs on is not reset between blocks, so a block carries on from the block before it.
 */
export function decodePad(stored: Buffer, layout: PadLayout): Buffer {
	const packed = stored.subarray(layout.packedOffset);
	const table: number[] = new Array<number>(TABLE_SIZE).fill(0);
	for (const [index, value] of SEEDED_COEFFICIENTS) {
		table[index] = value;
	}
	const stereo = layout.channels === CHANNEL_PAIR;
	const output: Buffer = Buffer.alloc(layout.pcmSize + OUTPUT_SLACK);
	let olderLeft = 0;
	let olderRight = 0;
	let previousRight = 0;
	let src = 0;
	let dst = 0;

	const read = (): number => {
		const byte = packed[src];
		src += 1;
		if (undefined === byte) {
			throw invalidAudio("The packed stream ends before its last block");
		}
		return byte;
	};

	const write = (value: number): void => {
		if (dst + 2 > output.length) {
			throw invalidAudio(
				"The packed stream holds more samples than the header declares",
			);
		}
		output.writeInt16LE(toSample(value), dst);
		dst += 2;
	};

	let marker = read();
	while (STREAM_END !== marker) {
		const control = read();
		const filterIndex = control >> 4;
		const shift = control & 0xf;
		let rightFilterIndex = 0;
		let rightShift = 0;
		if (stereo) {
			// The reference looks one byte ahead and steps over both, so the first of the two is not read.
			const right = packed[src + 1] ?? 0;
			rightShift = right & 0xf;
			rightFilterIndex = right >> 4;
			table[12] = bitsDouble(
				(doubleBits(table[12] ?? 0) & 0xffffffffn) |
					(BigInt(rightShift) << 32n),
			);
			src += 2;
		} else {
			// In a single channel sound that slot is never written, so this is always zero.
			rightShift = Number(doubleBits(table[12] ?? 0) >> 32n);
		}
		let slot = LEFT_SLOT + 1;
		for (let index = 0; index < LOAD_BYTES; index += 1) {
			const byte = read();
			table[slot - 1] = signExtended(byte, 0x0f, 12) >> shift;
			table[slot] = signExtended(byte, 0xf0, 8) >> shift;
			slot += 2;
		}
		if (stereo) {
			slot = RIGHT_SLOT + 1;
			for (let index = 0; index < LOAD_BYTES; index += 1) {
				const byte = read();
				table[slot - 1] = signExtended(byte, 0x0f, 12) >> rightShift;
				table[slot] = signExtended(byte, 0xf0, 8) >> rightShift;
				slot += 2;
			}
		}
		slot = RIGHT_SLOT;
		for (let index = 0; index < BLOCK_SAMPLES; index += 1) {
			const predicted = olderLeft * (table[2 * filterIndex + 3] ?? 0);
			olderLeft = table[0] ?? 0;
			const left =
				(table[slot - 28] ?? 0) +
				(predicted + olderLeft * (table[2 * filterIndex + 2] ?? 0));
			table[slot - 28] = left;
			table[0] = left;
			write(left);
			if (stereo) {
				const right =
					(table[slot] ?? 0) +
					(olderRight * (table[2 * rightFilterIndex + 3] ?? 0) +
						previousRight * (table[2 * rightFilterIndex + 2] ?? 0));
				table[slot] = right;
				olderRight = previousRight;
				previousRight = right;
				write(right);
			}
			slot += 1;
		}
		marker = read();
	}
	return output.subarray(0, layout.pcmSize);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const shiinaRioPadAudioDescriptor: FormatDescriptor = {
	id: "shiina-rio-pad-audio",
	name: "ShiinaRio compressed audio",
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
			source: "ArcFormats/ShiinaRio/AudioPAD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const shiinaRioPadAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: shiinaRioPadAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readPadLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readPadLayout(stored);
		if (!layout) {
			throw invalidAudio("Not a ShiinaRio compressed sound");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(layout.packedOffset),
				size: BigInt(layout.packedSize),
				compressed: true,
				metadata: { type: "audio" },
			}),
			// The samples are reserialised as a wave file, which need not be the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				formatTag: layout.format.formatTag,
				channels: layout.format.channels,
				sampleRate: layout.format.sampleRate,
				bitsPerSample: layout.format.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readPadLayout(stored);
		if (!layout) {
			throw invalidAudio("Not a ShiinaRio compressed sound");
		}
		return Readable.from([
			Buffer.concat([
				patchedPadHeader(stored, layout.pcmSize),
				decodePad(stored, layout),
			]),
		]);
	},
});
