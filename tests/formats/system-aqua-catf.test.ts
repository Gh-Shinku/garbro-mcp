import { BufferByteSource } from "@garbro-mcp/core";
import { systemAquaCatfFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const SIGNATURE = "CATF";
const COUNT_OFFSET = 0x10;
const INDEX_OFFSET_FIELD = 8;
const PACKED_HEADER_SIZE = 0x40;
const PACKED_MARKER = "LZe4";
const BMP_HEADER_SIZE = 54;

/** Inverts the type byte encryption of the packed header. */
function encryptType(text: string): Buffer {
	const output = Buffer.alloc(3);
	for (let i = 0; i < 3; i += 1) {
		const value = text.charCodeAt(i);
		output[i] = ~(((value << 4) | (value >> 4)) & 0xff) & 0xff;
	}
	return output;
}

/** Packs bits most significant bit first, which is the order the engine decoder reads them in. */
function packBits(bits: readonly number[]): Buffer {
	const padded = [...bits];
	while (padded.length % 8 !== 0) padded.push(0);
	const output = Buffer.alloc(padded.length / 8);
	for (const [index, bit] of padded.entries())
		if (bit !== 0)
			output[index >> 3] = (output[index >> 3] ?? 0) | (1 << (7 - (index & 7)));
	return output;
}

function literalBits(data: Buffer): number[] {
	const bits: number[] = [];
	for (const byte of data) {
		bits.push(1);
		for (let shift = 7; shift >= 0; shift -= 1) bits.push((byte >> shift) & 1);
	}
	return bits;
}

/** Encodes literal runs followed by a single window copy with a fourteen bit offset and a count bias of three. */
function encodeCopyWithLiterals(
	literals: Buffer,
	copyOffset: number,
	copyLength: number,
): Buffer {
	const bits = literalBits(literals);
	bits.push(0);
	for (let shift = 13; shift >= 0; shift -= 1)
		bits.push((copyOffset >> shift) & 1);
	for (let shift = 3; shift >= 0; shift -= 1)
		bits.push(((copyLength - 3) >> shift) & 1);
	return packBits(bits);
}

/** Builds a packed payload: the 0x40 byte header, an optional bitmap preamble and the bit stream. */
function buildPacked(options: {
	type: string;
	unpackedSize: number;
	stream: Buffer;
	preamble?: Buffer;
}): Buffer {
	const header = Buffer.alloc(PACKED_HEADER_SIZE);
	header.write(PACKED_MARKER, 0, "latin1");
	header.writeUInt32LE(options.unpackedSize, 8);
	encryptType(options.type).copy(header, 0xc);
	return Buffer.concat([
		header,
		options.preamble ?? Buffer.alloc(0),
		options.stream,
	]);
}

interface EntrySource {
	payload: Buffer;
	unpackedSize?: number;
}

function buildCatf(sources: readonly EntrySource[]): Buffer {
	const header = Buffer.alloc(0x14);
	header.write(SIGNATURE, 0, "latin1");
	let cursor = header.length;
	const index = Buffer.alloc(sources.length * 8);
	for (const [entry, source] of sources.entries()) {
		index.writeUInt32LE(source.payload.length, entry * 8);
		index.writeUInt32LE(cursor, entry * 8 + 4);
		cursor += source.payload.length;
	}
	header.writeUInt32LE(cursor, INDEX_OFFSET_FIELD);
	header.writeInt32LE(sources.length, COUNT_OFFSET);
	return Buffer.concat([
		header,
		...sources.map((source) => source.payload),
		index,
	]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	const source = new BufferByteSource(file);
	expect(await systemAquaCatfFormat.detect(source, "sample.dat")).toBe(false);
}

describe("SystemAQUA engine resource archive", () => {
	it("lists plain entries under the archive base name", async () => {
		const payload = Buffer.from("plain payload");
		await expectArchive({
			format: systemAquaCatfFormat,
			sourcePath: "sample.dat",
			archive: buildCatf([{ payload }]),
			entries: [
				{ path: "sample#0000", size: payload.length, content: payload },
			],
			metadata: { entryCount: 1 },
		});
	});

	it("types a payload from its signature and appends its extension", async () => {
		const payload = Buffer.concat([
			Buffer.from("RIFF"),
			Buffer.alloc(16, 0x11),
		]);
		const archive = await systemAquaCatfFormat.open(
			new BufferByteSource(buildCatf([{ payload }])),
			"sample.cat",
		);
		expect(archive.entries[0]).toMatchObject({
			path: "sample#0000.wav",
			size: BigInt(payload.length),
			metadata: { type: "audio" },
		});
	});

	it("unpacks a packed audio payload", async () => {
		const data = Buffer.from("packed audio payload");
		const payload = buildPacked({
			type: "WAV",
			unpackedSize: data.length,
			stream: packBits(literalBits(data)),
		});
		await expectArchive({
			format: systemAquaCatfFormat,
			sourcePath: "sample.dat",
			archive: buildCatf([{ payload }]),
			entries: [{ path: "sample#0000.wav", size: data.length, content: data }],
		});
	});

	it("treats a payload without a decrypted type as audio", async () => {
		const data = Buffer.from("plain audio");
		const payload = buildPacked({
			type: "000",
			unpackedSize: data.length,
			stream: packBits(literalBits(data)),
		});
		const archive = await systemAquaCatfFormat.open(
			new BufferByteSource(buildCatf([{ payload }])),
			"sample.dat",
		);
		expect(archive.entries[0]).toMatchObject({
			path: "sample#0000",
			metadata: { type: "audio" },
			compressed: true,
		});
	});

	it("copies runs out of the window", async () => {
		// Two literals followed by a copy of four bytes from window offset one, which overlaps what it writes.
		const payload = buildPacked({
			type: "WAV",
			unpackedSize: 6,
			stream: encodeCopyWithLiterals(Buffer.from("AB"), 1, 4),
		});
		await expectArchive({
			format: systemAquaCatfFormat,
			sourcePath: "sample.dat",
			archive: buildCatf([{ payload }]),
			entries: [
				{
					path: "sample#0000.wav",
					size: 6,
					content: Buffer.from("ABABAB"),
				},
			],
		});
	});

	it("rebuilds the bitmap header of a packed image", async () => {
		const width = 320;
		const height = 240;
		const bitsPerPixel = 24;
		// The stored words are the complements of the header words, and the width and height are byte swapped.
		const swap = (value: number): number =>
			(((value & 0xff) << 8) | (value >>> 8)) >>> 0;
		const rotate = (value: number): number =>
			(((value << 4) | (value >> 4)) & 0xff) >>> 0;
		const h1 = ((swap(height) << 16) | swap(width)) >>> 0;
		const words = Buffer.alloc(12);
		words.writeUInt32LE(~h1 >>> 0, 0);
		words.writeUInt32LE(~rotate(bitsPerPixel) >>> 0, 4);
		words.writeUInt32LE(0xffffffff, 8);
		const pixels = Buffer.alloc(9, 0x5a);
		const payload = buildPacked({
			type: "BMP",
			unpackedSize: BMP_HEADER_SIZE + pixels.length,
			stream: packBits(literalBits(pixels)),
			preamble: Buffer.concat([Buffer.alloc(4), words]),
		});
		const archive = await systemAquaCatfFormat.open(
			new BufferByteSource(buildCatf([{ payload }])),
			"sample.dat",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("Missing entry");
		const content = await consumeBuffer(await archive.openEntry(entry.id));
		expect(entry).toMatchObject({
			path: "sample#0000.bmp",
			size: BigInt(BMP_HEADER_SIZE + pixels.length),
		});
		expect(content.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(content.readUInt32LE(2)).toBe(BMP_HEADER_SIZE + pixels.length);
		expect(content.readUInt32LE(18)).toBe(width);
		expect(content.readUInt32LE(22)).toBe(height);
		expect(content[28]).toBe(bitsPerPixel);
		expect(content.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("rejects a file without the format signature", async () => {
		const file = buildCatf([{ payload: Buffer.from("payload") }]);
		file.write("NOPE", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects a file with an unreasonable entry count", async () => {
		const file = buildCatf([{ payload: Buffer.from("payload") }]);
		file.writeInt32LE(0, COUNT_OFFSET);
		await expectDeclined(file);
	});

	it("rejects an index that starts past the end of the file", async () => {
		const file = buildCatf([{ payload: Buffer.from("payload") }]);
		file.writeUInt32LE(file.length + 4, INDEX_OFFSET_FIELD);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildCatf([{ payload: Buffer.from("payload") }]);
		const indexOffset = file.readUInt32LE(INDEX_OFFSET_FIELD);
		file.writeUInt32LE(file.length * 2, indexOffset + 4);
		await expectDeclined(file);
	});
});
