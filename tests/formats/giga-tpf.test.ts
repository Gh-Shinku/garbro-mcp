import { encodeCp932 } from "@garbro-mcp/core";
import { gigaTpfFormat } from "@garbro-mcp/formats";
import { describe, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x30;
const OFFSET_FIELD = 0x24;
const UNPACKED_SIZE_FIELD = 0x2c;

interface Entry {
	name: string;
	compression: number;
	payload: Buffer;
	unpackedSize?: number;
	interimSize?: number;
}

/** Packs bits most-significant-first, matching GARbro's `MsbBitStream`. */
function packBits(bits: readonly number[]): Buffer {
	const output = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		if (bit === 0) continue;
		const byte = Math.floor(index / 8);
		output[byte] = (output[byte] ?? 0) | (1 << (7 - (index % 8)));
	}
	return output;
}

/** A complete depth-8 tree: every byte has the eight-bit code of its own value. */
function fullTree(minimum: number, size: number): number[] {
	if (size === 1) {
		return [0, ...minimum.toString(2).padStart(8, "0").split("").map(Number)];
	}
	const half = size / 2;
	return [1, ...fullTree(minimum, half), ...fullTree(minimum + half, half)];
}

function huffmanStream(data: Buffer): Buffer {
	const bits = fullTree(0, 0x100);
	for (const value of data) {
		bits.push(...value.toString(2).padStart(8, "0").split("").map(Number));
	}
	return packBits(bits);
}

function buildTpf(entries: readonly Entry[]): Buffer {
	const indexSize = (entries.length + 1) * RECORD_SIZE;
	const payloadOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		payloadOffset +
			entries.reduce((total, entry) => total + entry.payload.length, 0),
	);
	archive.write("TPF FILE", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x0c);
	let offset = payloadOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive[record + 0x23] = entry.compression;
		archive.writeUInt32LE(offset, record + OFFSET_FIELD);
		archive.writeUInt32LE(entry.interimSize ?? 0, record + 0x28);
		archive.writeUInt32LE(
			entry.unpackedSize ?? entry.payload.length,
			record + UNPACKED_SIZE_FIELD,
		);
		entry.payload.copy(archive, offset);
		offset += entry.payload.length;
	}
	// GARbro sizes the final entry against the offset word of a following record.
	archive.writeUInt32LE(
		offset,
		INDEX_OFFSET + entries.length * RECORD_SIZE + OFFSET_FIELD,
	);
	return archive;
}

describe("Giga TPF resource archive", () => {
	it("extracts stored, LZSS, Huffman+LZSS, and unknown-compression entries", async () => {
		const stored = Buffer.from("stored payload");
		const lzss = Buffer.from("lzss payload");
		const huffman = Buffer.from("huffman payload");
		const lzssPayload = literalLzssStream(lzss);
		const huffmanStreamData = literalLzssStream(huffman);
		const huffmanPayload = huffmanStream(huffmanStreamData);
		await expectArchive({
			format: gigaTpfFormat,
			archive: buildTpf([
				{ name: "raw.dat", compression: 0, payload: stored },
				{
					name: "lz.dat",
					compression: 1,
					payload: lzssPayload,
					unpackedSize: lzss.length,
					interimSize: 0,
				},
				{
					name: "huff.dat",
					compression: 2,
					payload: huffmanPayload,
					unpackedSize: huffman.length,
					interimSize: huffmanStreamData.length,
				},
				{ name: "odd.dat", compression: 3, payload: stored },
			]),
			entries: [
				{ path: "raw.dat", size: stored.length, content: stored },
				{ path: "lz.dat", size: lzss.length, content: lzss },
				{ path: "huff.dat", size: huffman.length, content: huffman },
				{ path: "odd.dat", size: stored.length, content: stored },
			],
			metadata: { entryCount: 4 },
		});
	});

	it("drops records whose unpacked size is zero", async () => {
		const content = Buffer.from("kept");
		await expectArchive({
			format: gigaTpfFormat,
			archive: buildTpf([
				{
					name: "empty.dat",
					compression: 0,
					payload: Buffer.from("ignored"),
					unpackedSize: 0,
				},
				{ name: "kept.dat", compression: 0, payload: content },
			]),
			entries: [{ path: "kept.dat", size: content.length, content }],
			metadata: { entryCount: 1 },
		});
	});

	it("rejects a payload outside the file", async () => {
		const archive = buildTpf([
			{ name: "a.dat", compression: 0, payload: Buffer.from("x") },
		]);
		archive.writeUInt32LE(archive.length + 0x100, INDEX_OFFSET + OFFSET_FIELD);
		await expectArchive({
			format: gigaTpfFormat,
			archive,
			detected: false,
			entries: [],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildTpf([
			{ name: "a.dat", compression: 0, payload: Buffer.from("x") },
		]);
		archive.write("XP3 FILE", 0, "ascii");
		await expectArchive({
			format: gigaTpfFormat,
			archive,
			detected: false,
			entries: [],
		});
	});
});
