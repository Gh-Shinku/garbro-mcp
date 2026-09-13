import { BufferByteSource } from "@garbro-mcp/core";
import {
	asdKToolFormat,
	asdSpielFormat,
	unpackKTool,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const KTOOL_SIGNATURE = "ktool210";
const INDEX_OFFSET = 0x10;
const AUDIO_HEADER_SIZE = 0x20;
const AUDIO_DECODED_SIZE = 0;
const AUDIO_METHOD = 8;
const AUDIO_HEADER_LENGTH = 0xa;
const AUDIO_FORMAT = 0x10;
const AUDIO_MARKER = 0xb713e4;
const IMAGE_MARKER = 0xb29ea4;
const SPIEL_TERMINATOR = 0xffffffff;

const WAVE_FORMAT = {
	formatTag: 1,
	channels: 2,
	sampleRate: 44100,
	averageBytesPerSecond: 176400,
	blockAlign: 4,
	bitsPerSample: 16,
};

/** Builds the RIFF header the reference writes, independently of the port. */
function riffHeader(dataSize: number): Buffer {
	const header = Buffer.alloc(44);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(0x24 + dataSize, 4);
	header.write("WAVE", 8, "latin1");
	header.write("fmt ", 0xc, "latin1");
	header.writeUInt32LE(0x10, 0x10);
	header.writeUInt16LE(WAVE_FORMAT.formatTag, 0x14);
	header.writeUInt16LE(WAVE_FORMAT.channels, 0x16);
	header.writeUInt32LE(WAVE_FORMAT.sampleRate, 0x18);
	header.writeUInt32LE(WAVE_FORMAT.averageBytesPerSecond, 0x1c);
	header.writeUInt16LE(WAVE_FORMAT.blockAlign, 0x20);
	header.writeUInt16LE(WAVE_FORMAT.bitsPerSample, 0x22);
	header.write("data", 0x24, "latin1");
	header.writeUInt32LE(dataSize, 0x28);
	return header;
}

/** Encodes one lane of the interleaved rle scheme: repeats and literal runs, ended by a zero. */
function encodeRleLane(values: readonly number[]): number[] {
	const parts: number[] = [];
	let position = 0;
	while (position < values.length) {
		const value = values[position] ?? 0;
		let run = 1;
		while (
			position + run < values.length &&
			values[position + run] === value &&
			run < 0x7f
		)
			run += 1;
		if (run >= 2) {
			parts.push(run, value);
			position += run;
			continue;
		}
		let literal = position;
		while (literal < values.length && literal - position < 0x7f) {
			const current = values[literal] ?? 0;
			if (literal + 1 < values.length && values[literal + 1] === current) break;
			literal += 1;
		}
		parts.push(
			0x100 - (literal - position),
			...values.slice(position, literal),
		);
		position = literal;
	}
	parts.push(0);
	return parts;
}

/** Packs plain bytes with a step, mirroring `KTool.DecompressRle`. */
function encodeRle(plain: Buffer, step: number): Buffer {
	const parts: number[] = [];
	for (let lane = 0; lane < step; lane += 1) {
		const values: number[] = [];
		for (let position = lane; position < plain.length; position += step)
			values.push(plain[position] ?? 0);
		parts.push(...encodeRleLane(values));
	}
	return Buffer.from(parts);
}

function buildAudioEntry(plain: Buffer, method: number): Buffer {
	const header = Buffer.alloc(AUDIO_HEADER_SIZE);
	header.writeUInt32LE(plain.length, AUDIO_DECODED_SIZE);
	header[AUDIO_METHOD] = method;
	header.writeUInt16LE(0x10, AUDIO_HEADER_LENGTH);
	header.writeUInt32LE(AUDIO_MARKER, 0xc);
	header.writeUInt16LE(WAVE_FORMAT.formatTag, AUDIO_FORMAT);
	header.writeUInt16LE(WAVE_FORMAT.channels, AUDIO_FORMAT + 2);
	header.writeUInt32LE(WAVE_FORMAT.sampleRate, AUDIO_FORMAT + 4);
	header.writeUInt32LE(WAVE_FORMAT.averageBytesPerSecond, AUDIO_FORMAT + 8);
	header.writeUInt16LE(WAVE_FORMAT.blockAlign, AUDIO_FORMAT + 0xc);
	header.writeUInt16LE(WAVE_FORMAT.bitsPerSample, AUDIO_FORMAT + 0xe);
	const data = method === 0 ? plain : encodeRle(plain, method);
	return Buffer.concat([header, data]);
}

function buildKTool(payloads: readonly Buffer[]): Buffer {
	const header = Buffer.alloc(INDEX_OFFSET);
	header.write(KTOOL_SIGNATURE, 0, "latin1");
	header.writeInt32LE(payloads.length, 8);
	const table = Buffer.alloc((payloads.length + 1) * 4);
	let offset = INDEX_OFFSET + table.length;
	for (const [id, payload] of payloads.entries()) {
		table.writeUInt32LE(offset, id * 4);
		offset += payload.length;
	}
	table.writeUInt32LE(offset, payloads.length * 4);
	return Buffer.concat([header, table, ...payloads]);
}

function buildSpiel(format: number, entries: readonly Buffer[]): Buffer {
	const header = Buffer.alloc(INDEX_OFFSET);
	header[0] = format;
	const table = Buffer.alloc((entries.length + 1) * 4);
	let offset = INDEX_OFFSET + table.length;
	for (const [id, entry] of entries.entries()) {
		table.writeUInt32LE(offset, id * 4);
		offset += entry.length;
	}
	table.writeUInt32LE(SPIEL_TERMINATOR, entries.length * 4);
	return Buffer.concat([header, table, ...entries]);
}

const TREE_SIZE = 514;
const TREE_SENTINEL = 513;
const END_TOKEN = 0x100;

/** The reference's tree builder: merge the two lightest nodes until only the sentinel is left. */
function buildKToolTree(weights: readonly number[]): {
	left: Int32Array;
	right: Int32Array;
	root: number;
} {
	const code = new Int32Array(TREE_SIZE);
	const left = new Int32Array(TREE_SIZE);
	const right = new Int32Array(TREE_SIZE);
	for (const [index, value] of weights.entries()) code[index] = value;
	code[END_TOKEN] = 1;
	code[TREE_SENTINEL] = 0xffff;
	let root = 257;
	for (;;) {
		let rhs = TREE_SENTINEL;
		let lhs = TREE_SENTINEL;
		for (let index = 0; index < root; index += 1) {
			const value = code[index] ?? 0;
			if (value === 0) continue;
			if (value < (code[lhs] ?? 0)) {
				rhs = lhs;
				lhs = index;
			} else if (value < (code[rhs] ?? 0)) {
				rhs = index;
			}
		}
		if (rhs === TREE_SENTINEL) break;
		code[root] = (code[rhs] ?? 0) + (code[lhs] ?? 0);
		left[root] = lhs;
		right[root] = rhs;
		code[lhs] = 0;
		code[rhs] = 0;
		root += 1;
	}
	return { left, right, root: root - 1 };
}

/** Encodes a payload with the codes of the tree the reference would build from its byte weights. */
function encodeKToolHuffman(plain: Buffer): Buffer {
	const weights = new Array(0x100).fill(0);
	for (const byte of plain) weights[byte] += 1;
	const tree = buildKToolTree(weights);
	const codes = new Map<number, number[]>();
	const walk = (token: number, bits: number[]): void => {
		if (token <= END_TOKEN) {
			codes.set(token, bits);
			return;
		}
		walk(tree.left[token] ?? 0, [...bits, 0]);
		walk(tree.right[token] ?? 0, [...bits, 1]);
	};
	walk(tree.root, []);
	const bits: number[] = [];
	for (const byte of plain) bits.push(...(codes.get(byte) ?? []));
	const output: number[] = [];
	const dictionary = Buffer.from(weights);
	output.push(...encodeRle(dictionary, 1));
	let current = 0;
	let mask = 0x80;
	for (const bit of bits) {
		if (bit !== 0) current |= mask;
		mask >>= 1;
		if (mask === 0) {
			output.push(current);
			current = 0;
			mask = 0x80;
		}
	}
	if (mask !== 0x80) output.push(current);
	return Buffer.from(output);
}

describe("KApp engine resource archive", () => {
	it("lists generated names and reads stored audio as a wave", async () => {
		const plain = Buffer.from("pcm samples here");
		const payload = buildAudioEntry(plain, 0);
		await expectArchive({
			format: asdKToolFormat,
			sourcePath: "voice.asd",
			archive: buildKTool([payload]),
			entries: [
				{
					path: "voice#0000",
					size: payload.length,
					content: Buffer.concat([riffHeader(plain.length), plain]),
				},
			],
			metadata: { entryCount: 1 },
		});
	});

	it("unpacks rle audio", async () => {
		const plain = Buffer.concat([
			Buffer.from("head"),
			Buffer.alloc(12, 0x41),
			Buffer.from("tail"),
		]);
		const payload = buildAudioEntry(plain, 1);
		await expectArchive({
			format: asdKToolFormat,
			sourcePath: "voice.asd",
			archive: buildKTool([payload]),
			entries: [
				{
					path: "voice#0000",
					size: payload.length,
					content: Buffer.concat([riffHeader(plain.length), plain]),
				},
			],
		});
	});

	it("types entries by their payload marker", async () => {
		const audio = buildAudioEntry(Buffer.from("sound"), 0);
		const image = Buffer.alloc(0x20, 0x7f);
		image.writeUInt32LE(IMAGE_MARKER, 0xc);
		const other = Buffer.alloc(0x20, 0x11);
		const archive = await asdKToolFormat.open(
			new BufferByteSource(buildKTool([audio, image, other])),
			"pack.asd",
		);
		expect(archive.entries.map((entry) => entry.metadata?.type)).toEqual([
			"audio",
			"image",
			"data",
		]);
	});

	it("rejects a foreign signature", async () => {
		const file = buildKTool([Buffer.alloc(0x20)]);
		file.write("ktoa", 0, "latin1");
		expect(
			await asdKToolFormat.detect(new BufferByteSource(file), "a.asd"),
		).toBe(false);
	});

	it("rejects a decreasing offset table", async () => {
		const file = buildKTool([Buffer.alloc(0x20), Buffer.alloc(0x20)]);
		file.writeUInt32LE(0x10, INDEX_OFFSET + 4);
		expect(
			await asdKToolFormat.detect(new BufferByteSource(file), "a.asd"),
		).toBe(false);
	});
});

describe("Spiel audio archive", () => {
	it("reads mp3 entries", async () => {
		const mp3 = Buffer.from("mp3 frame bytes");
		const payload = Buffer.alloc(INDEX_OFFSET + mp3.length);
		payload.writeUInt32LE(mp3.length, 0);
		mp3.copy(payload, INDEX_OFFSET);
		await expectArchive({
			format: asdSpielFormat,
			sourcePath: "song.asd",
			archive: buildSpiel(2, [payload]),
			entries: [{ path: "song#0000", size: payload.length, content: mp3 }],
			metadata: { format: 2, entryCount: 1 },
		});
	});

	it("wraps wave entries in a riff header", async () => {
		const pcm = Buffer.from("pcm payload bytes");
		const payload = Buffer.alloc(AUDIO_HEADER_SIZE + pcm.length);
		payload.writeUInt32LE(pcm.length, 0);
		payload.writeUInt16LE(WAVE_FORMAT.formatTag, 8);
		payload.writeUInt16LE(WAVE_FORMAT.channels, 0xa);
		payload.writeUInt32LE(WAVE_FORMAT.sampleRate, 0xc);
		payload.writeUInt32LE(WAVE_FORMAT.averageBytesPerSecond, 0x10);
		payload.writeUInt16LE(WAVE_FORMAT.blockAlign, 0x14);
		payload.writeUInt16LE(WAVE_FORMAT.bitsPerSample, 0x16);
		pcm.copy(payload, AUDIO_HEADER_SIZE);
		await expectArchive({
			format: asdSpielFormat,
			sourcePath: "song.asd",
			archive: buildSpiel(1, [payload]),
			entries: [
				{
					path: "song#0000",
					size: payload.length,
					content: Buffer.concat([riffHeader(pcm.length), pcm]),
				},
			],
			metadata: { format: 1 },
		});
	});

	it("sizes the last entry to the end of the file", async () => {
		const first = Buffer.from("first audio");
		const second = Buffer.from("second audio");
		const archive = await asdSpielFormat.open(
			new BufferByteSource(buildSpiel(2, [first, second])),
			"song.asd",
		);
		expect(archive.entries.map((entry) => entry.size)).toEqual([
			BigInt(first.length),
			BigInt(second.length),
		]);
	});

	it("rejects a wrong extension", async () => {
		const file = buildSpiel(2, [Buffer.from("audio")]);
		expect(
			await asdSpielFormat.detect(new BufferByteSource(file), "song.dat"),
		).toBe(false);
	});

	it("rejects an unknown format byte", async () => {
		const file = buildSpiel(2, [Buffer.from("audio")]);
		file[0] = 3;
		expect(
			await asdSpielFormat.detect(new BufferByteSource(file), "song.asd"),
		).toBe(false);
	});

	it("rejects an archive without entries", async () => {
		const file = buildSpiel(2, []);
		expect(
			await asdSpielFormat.detect(new BufferByteSource(file), "song.asd"),
		).toBe(false);
	});
});

describe("KTool compression", () => {
	it("copies stored data", () => {
		const output = unpackKTool(
			Buffer.from("stored bytes"),
			Buffer.alloc(12),
			0,
		);
		expect(output.toString("latin1")).toBe("stored bytes");
	});

	it("unpacks interleaved rle", () => {
		const plain = Buffer.from("abcdefg");
		const stored = encodeRle(plain, 2);
		const output = unpackKTool(stored, Buffer.alloc(plain.length), 2);
		expect(output.equals(plain)).toBe(true);
	});

	it("unpacks huffman payloads", () => {
		const plain = Buffer.from("abcabcabcabca");
		const stored = encodeKToolHuffman(plain);
		const output = unpackKTool(stored, Buffer.alloc(plain.length), 0x10);
		expect(output.equals(plain)).toBe(true);
	});

	it("refuses an unknown method", () => {
		expect(() =>
			unpackKTool(Buffer.alloc(4), Buffer.alloc(4), 0x20),
		).toThrowError(/Unsupported KTool compression method/);
	});

	it("unpacks audio with the two lane method", async () => {
		const plain = Buffer.from("samples");
		const payload = buildAudioEntry(plain, 2);
		const archive = await asdKToolFormat.open(
			new BufferByteSource(buildKTool([payload])),
			"voice.asd",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("Missing entry");
		const content = await consumeBuffer(await archive.openEntry(entry.id));
		expect(content.length).toBe(44 + plain.length);
	});
});
