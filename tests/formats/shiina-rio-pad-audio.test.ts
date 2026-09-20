import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { readWave } from "../../packages/formats/src/shared/wav.js";
import {
	decodePad,
	readPadLayout,
	shiinaRioPadAudioFormat,
} from "../../packages/formats/src/shiina-rio/pad-audio.js";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x2c;
const STREAM_END = 0xff;
const BLOCK_SAMPLES = 28;
/** One mono block decodes to twenty eight sixteen bit samples. */
const BLOCK_BYTES = BLOCK_SAMPLES * 2;
/** A stereo block decodes to twenty eight frames of two samples. */
const STEREO_BLOCK_BYTES = BLOCK_BYTES * 2;

function zeros(count: number): number[] {
	return new Array<number>(count).fill(0);
}

/** Twenty eight nibbles become the fourteen bytes a block loads them from. */
function packNibbles(values: readonly number[]): number[] {
	if (values.length !== BLOCK_SAMPLES) {
		throw new Error("a block loads twenty eight nibbles");
	}
	const bytes: number[] = [];
	for (let index = 0; index < values.length; index += 2) {
		bytes.push((values[index] ?? 0) | ((values[index + 1] ?? 0) << 4));
	}
	return bytes;
}

/** A single channel block: the marker, the control byte, then the nibble bytes. */
function monoBlock(
	filterIndex: number,
	shift: number,
	nibbles: readonly number[],
): Buffer {
	return Buffer.from([0, (filterIndex << 4) | shift, ...packNibbles(nibbles)]);
}

/**
 * A two channel block: the marker, the left control byte, then the byte the reference steps over unread
 * in front of the right channel's own control byte, and a load of nibbles for each channel.
 */
function stereoBlock(
	left: { filterIndex: number; shift: number; nibbles: readonly number[] },
	right: { filterIndex: number; shift: number; nibbles: readonly number[] },
	skipped = 0xaa,
): Buffer {
	return Buffer.from([
		0,
		(left.filterIndex << 4) | left.shift,
		skipped,
		(right.filterIndex << 4) | right.shift,
		...packNibbles(left.nibbles),
		...packNibbles(right.nibbles),
	]);
}

interface PadFixture {
	channels: number;
	/** The sample bytes the header declares, which is what the sound decodes to. */
	pcmSize: number;
	body: Buffer;
	terminated?: boolean;
	/** The average of bytes a second, kept unusual to show the header is copied rather than rebuilt. */
	averageBytesPerSecond?: number;
}

function padFile(options: PadFixture): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("PAD\0", 0, "latin1");
	header.write("WAVE", 8, "latin1");
	header.write("fmt ", 0x0c, "latin1");
	header.writeUInt32LE(16, 0x10);
	header.writeUInt16LE(1, 0x14);
	header.writeUInt16LE(options.channels, 0x16);
	header.writeUInt32LE(22050, 0x18);
	header.writeUInt32LE(
		options.averageBytesPerSecond ?? 22050 * options.channels * 2,
		0x1c,
	);
	header.writeUInt16LE(options.channels * 2, 0x20);
	header.writeUInt16LE(16, 0x22);
	header.write("data", 0x24, "latin1");
	header.writeUInt32LE(options.pcmSize, 0x28);
	const body =
		options.terminated === false
			? options.body
			: Buffer.concat([options.body, Buffer.from([STREAM_END])]);
	return Buffer.concat([header, body]);
}

function layoutOf(file: Buffer) {
	const layout = readPadLayout(file);
	if (!layout) throw new Error("the fixture does not read as a PAD sound");
	return layout;
}

/** The samples a fixture decodes to, little endian, as the signed words the wave carries. */
function samplesOf(file: Buffer): number[] {
	const pcm = decodePad(file, layoutOf(file));
	const samples: number[] = [];
	for (let offset = 0; offset + 1 < pcm.length; offset += 2) {
		samples.push(pcm.readInt16LE(offset));
	}
	return samples;
}

/** The residual a nibble stands for: placed at the top of a word and sign extended from the sixteenth bit. */
function residualOf(nibble: number): number {
	const value = nibble << 12;
	return (value & 0x8000) !== 0 ? value - 0x10000 : value;
}

async function detect(file: Buffer): Promise<boolean> {
	return shiinaRioPadAudioFormat.detect(
		new BufferByteSource(file),
		"sound.pad",
	);
}

describe("ShiinaRio PAD audio", () => {
	it("reads the residuals of a single channel block as they stand", () => {
		const file = padFile({
			channels: 1,
			pcmSize: BLOCK_BYTES,
			body: monoBlock(0, 0, [
				0x1,
				0x2,
				0x0,
				0x7,
				0x8,
				0xf,
				0x9,
				0x0,
				...zeros(20),
			]),
		});
		// A filter index of nothing leaves the two coefficients at nothing, so the block comes back as
		// loaded -- except that the reference truncates toward zero through a half, which is why the
		// lowest nibble lands one above its own value.
		expect(samplesOf(file)).toEqual([
			4096,
			8192,
			0,
			28672,
			-32767,
			-4095,
			-28671,
			0,
			...zeros(20),
		]);
	});

	it("halves every residual by the shift of its own channel", () => {
		const file = padFile({
			channels: 1,
			pcmSize: BLOCK_BYTES,
			body: monoBlock(0, 1, [0x3, 0x8, 0xf, 0x1, ...zeros(24)]),
		});
		expect(samplesOf(file)).toEqual([6144, -16383, -2047, 2048, ...zeros(24)]);
	});

	it("predicts each sample from the one before it with the seeded coefficient", () => {
		// Filter index one reaches the pair at four and five, and only the first of the two is seeded.
		const file = padFile({
			channels: 1,
			pcmSize: BLOCK_BYTES,
			body: monoBlock(1, 0, [0x1, ...zeros(27)]),
		});
		expect(samplesOf(file).slice(0, 5)).toEqual([4096, 3840, 3600, 3375, 3164]);
	});

	it("predicts each sample from the two before it with the seeded pair", () => {
		// Filter index two reaches the pair at six and seven, both seeded.
		const file = padFile({
			channels: 1,
			pcmSize: BLOCK_BYTES,
			body: monoBlock(2, 0, [0x1, ...zeros(27)]),
		});
		expect(samplesOf(file).slice(0, 4)).toEqual([4096, 7360, 9897, 11804]);
	});

	it("carries the prediction from one block into the next", () => {
		const file = padFile({
			channels: 1,
			pcmSize: BLOCK_BYTES * 2,
			body: Buffer.concat([
				// The last residual of the first block becomes the sample the next block predicts from.
				monoBlock(0, 0, [...zeros(27), 0x1]),
				monoBlock(1, 0, zeros(28)),
			]),
		});
		const samples = samplesOf(file);
		expect(samples.slice(24, 33)).toEqual([
			0, 0, 0, 4096, 3840, 3600, 3375, 3164, 2966,
		]);
	});

	it("interleaves the two channels of a stereo block", () => {
		const file = padFile({
			channels: 2,
			pcmSize: STEREO_BLOCK_BYTES,
			body: stereoBlock(
				{ filterIndex: 0, shift: 0, nibbles: [0x1, 0x2, ...zeros(26)] },
				{ filterIndex: 0, shift: 0, nibbles: [0x3, 0x4, ...zeros(26)] },
			),
		});
		// Both channels are loaded without a shift, so the second and the fourth samples are as stored.
		expect(samplesOf(file).slice(0, 6)).toEqual([
			4096, 12288, 8192, 16384, 0, 0,
		]);
	});

	it("does not let the byte in front of the right channel's control be read", () => {
		const left = { filterIndex: 0, shift: 0, nibbles: [0x1, ...zeros(27)] };
		const right = { filterIndex: 0, shift: 0, nibbles: [0x2, ...zeros(27)] };
		const withOne = samplesOf(
			padFile({
				channels: 2,
				pcmSize: STEREO_BLOCK_BYTES,
				body: stereoBlock(left, right, 0xaa),
			}),
		);
		const withAnother = samplesOf(
			padFile({
				channels: 2,
				pcmSize: STEREO_BLOCK_BYTES,
				body: stereoBlock(left, right, 0x07),
			}),
		);
		expect(withOne.slice(0, 4)).toEqual([4096, 8192, 0, 0]);
		expect(withOne).toEqual(withAnother);
	});

	it("gives each channel its own shift", () => {
		const file = padFile({
			channels: 2,
			pcmSize: STEREO_BLOCK_BYTES,
			body: stereoBlock(
				{ filterIndex: 0, shift: 0, nibbles: [0x3, ...zeros(27)] },
				{ filterIndex: 0, shift: 1, nibbles: [0x3, ...zeros(27)] },
			),
		});
		expect(samplesOf(file).slice(0, 4)).toEqual([12288, 6144, 0, 0]);
	});

	it("keeps the right channel's shift in the coefficient slot a high filter index reads", () => {
		// Filter index five reaches the pair at twelve and thirteen: the slot the shift is stored in as the
		// top half of a double, and the block's own first residual. The value standing there is far below
		// the half a sample is rounded through, so the residuals come back untouched.
		const file = padFile({
			channels: 2,
			pcmSize: STEREO_BLOCK_BYTES,
			body: stereoBlock(
				{ filterIndex: 5, shift: 0, nibbles: [0x1, 0x2, ...zeros(26)] },
				{ filterIndex: 0, shift: 1, nibbles: [0x3, ...zeros(27)] },
			),
		});
		expect(samplesOf(file).slice(0, 4)).toEqual([4096, 6144, 8192, 0]);
	});

	it("hands the sound over as a wave file whose header is the stored one", async () => {
		const file = padFile({
			channels: 1,
			pcmSize: BLOCK_BYTES,
			body: monoBlock(0, 0, [0x1, 0x2, ...zeros(26)]),
			averageBytesPerSecond: 1234,
		});
		expect(readPadLayout(file)).toMatchObject({
			pcmSize: BLOCK_BYTES,
			channels: 1,
			packedOffset: HEADER_SIZE,
			packedSize: file.length - HEADER_SIZE,
		});
		const wave = await streamOf(file);
		expect(wave.length).toBe(HEADER_SIZE + BLOCK_BYTES);
		expect(wave.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(wave.readUInt32LE(4)).toBe(BLOCK_BYTES + HEADER_SIZE - 8);
		// Everything behind those two words is the stored header, which is why an unusual field survives.
		expect(wave.subarray(8, HEADER_SIZE)).toEqual(
			file.subarray(8, HEADER_SIZE),
		);
		const parsed = readWave(wave);
		expect(parsed?.dataOffset).toBe(HEADER_SIZE);
		expect(parsed?.dataSize).toBe(BLOCK_BYTES);
		expect(parsed?.format).toEqual({
			formatTag: 1,
			channels: 1,
			sampleRate: 22050,
			averageBytesPerSecond: 1234,
			blockAlign: 2,
			bitsPerSample: 16,
		});
		expect(wave.readInt16LE(HEADER_SIZE)).toBe(4096);
	});

	it("declares the packed stream in the entry and the sound in the metadata", async () => {
		const file = padFile({
			channels: 1,
			pcmSize: BLOCK_BYTES,
			body: monoBlock(0, 0, zeros(28)),
		});
		await expectArchive({
			format: shiinaRioPadAudioFormat,
			archive: file,
			sourcePath: "voice.pad",
			entries: [{ path: "voice.wav", size: file.length - HEADER_SIZE }],
			metadata: {
				audio: "wav",
				formatTag: 1,
				channels: 1,
				sampleRate: 22050,
				bitsPerSample: 16,
			},
		});
	});

	it("cuts the decoded sound down to the size the header declares", async () => {
		const file = padFile({
			channels: 1,
			pcmSize: 8,
			body: monoBlock(0, 0, [0x1, 0x2, 0x3, 0x4, ...zeros(24)]),
		});
		const wave = await streamOf(file);
		expect(wave.length).toBe(HEADER_SIZE + 8);
		expect(wave.readUInt32LE(4)).toBe(8 + HEADER_SIZE - 8);
		expect(readWave(wave)?.dataSize).toBe(8);
		expect(wave.readInt16LE(HEADER_SIZE)).toBe(4096);
		expect(wave.readInt16LE(HEADER_SIZE + 6)).toBe(16384);
	});

	it("turns away a file whose header is not the one it expects", async () => {
		const good = padFile({
			channels: 1,
			pcmSize: BLOCK_BYTES,
			body: monoBlock(0, 0, zeros(28)),
		});
		const broken: readonly Buffer[] = [
			Buffer.from("BAD\0", "latin1"),
			good.subarray(0, HEADER_SIZE - 1),
			withBytes(good, 8, "WAVF"),
			withBytes(good, 0x0c, "fMt "),
			withBytes(good, 0x24, "dat "),
			withField(good, 0x10, 8, 4),
			withField(good, 0x28, 0, 4),
			withField(good, 0x28, 0x80000000, 4),
			withField(good, 0x16, 3, 2),
			withField(good, 0x16, 0, 2),
			withField(good, 0x14, 2, 2),
			withField(good, 0x22, 8, 2),
		];
		expect(await detect(good)).toBe(true);
		for (const candidate of broken) {
			expect(await detect(candidate)).toBe(false);
		}
	});

	it("stops where the packed stream does not hold", () => {
		const unterminated = padFile({
			channels: 1,
			pcmSize: BLOCK_BYTES,
			body: monoBlock(0, 0, zeros(28)),
			terminated: false,
		});
		expect(() => samplesOf(unterminated)).toThrow(GarbroError);
		const cutShort = padFile({
			channels: 1,
			pcmSize: BLOCK_BYTES,
			body: Buffer.from([0, 0, 0x21]),
		});
		expect(() => samplesOf(cutShort)).toThrow(GarbroError);
		// Three blocks decode to more than the declared size and the slack the reference leaves.
		const overrun = padFile({
			channels: 1,
			pcmSize: 2,
			body: Buffer.concat([
				monoBlock(0, 0, zeros(28)),
				monoBlock(0, 0, zeros(28)),
				monoBlock(0, 0, zeros(28)),
			]),
		});
		expect(() => samplesOf(overrun)).toThrow(GarbroError);
	});

	it("reads a residual of the lowest nibble the way the reference's cast does", () => {
		// The value is one above the one the nibble stands for, because the cast truncates toward zero.
		expect(residualOf(0x8)).toBe(-32768);
		const file = padFile({
			channels: 1,
			pcmSize: 2,
			body: monoBlock(0, 0, [0x8, ...zeros(27)]),
		});
		expect(samplesOf(file)).toEqual([-32767]);
	});
});

async function streamOf(file: Buffer): Promise<Buffer> {
	const format = shiinaRioPadAudioFormat;
	const archive = await format.open(new BufferByteSource(file), "voice.pad");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("the sound has no entry");
		const chunks: Buffer[] = [];
		for await (const chunk of await archive.openEntry(entry.id)) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks);
	} finally {
		await archive.close();
	}
}

function withBytes(file: Buffer, offset: number, text: string): Buffer {
	const copy = Buffer.from(file);
	copy.write(text, offset, "latin1");
	return copy;
}

function withField(
	file: Buffer,
	offset: number,
	value: number,
	width: number,
): Buffer {
	const copy = Buffer.from(file);
	if (width === 2) copy.writeUInt16LE(value, offset);
	else copy.writeUInt32LE(value >>> 0, offset);
	return copy;
}
