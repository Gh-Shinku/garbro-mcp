import { BufferByteSource } from "@garbro-mcp/core";
import { ankhGrpFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const TABLE_START = 4;
const PCM_MARKER = 0x57;

/**
 * Bit writer matching the reference's reader, which takes a little-endian word and hands out bits from
 * its most significant end: every four bytes therefore hold one word whose first bit is its top bit.
 */
class WordBitWriter {
	readonly #words: number[] = [];
	#word = 0;
	#count = 0;

	put(value: number, length: number): void {
		for (let index = length - 1; index >= 0; index -= 1) {
			this.#word = ((this.#word << 1) | ((value >> index) & 1)) >>> 0;
			this.#count += 1;
			if (this.#count === 32) {
				this.#words.push(this.#word);
				this.#word = 0;
				this.#count = 0;
			}
		}
	}

	/** Pads the last partial word, which the reader still consumes as four bytes. */
	finish(): Buffer {
		if (this.#count > 0) {
			this.#words.push((this.#word << (32 - this.#count)) >>> 0);
			this.#word = 0;
			this.#count = 0;
		}
		const output = Buffer.alloc(Math.max(4, this.#words.length * 4));
		for (const [index, word] of this.#words.entries())
			output.writeUInt32LE(word, index * 4);
		return output;
	}
}

/**
 * Builds an archive: the first word is the offset of the first payload and the end of the offset table,
 * every table word is the offset of the next payload, and the last one is the file end.
 */
function buildGrp(payloads: readonly Buffer[]): Buffer {
	const firstOffset = TABLE_START + payloads.length * 4;
	const offsets: number[] = [];
	let offset = firstOffset;
	for (const payload of payloads) {
		offsets.push(offset);
		offset += payload.length;
	}
	const header = Buffer.alloc(firstOffset);
	header.writeUInt32LE(firstOffset, 0);
	for (let id = 0; id < payloads.length; id += 1)
		header.writeUInt32LE(
			id + 1 < payloads.length ? (offsets[id + 1] ?? 0) : offset,
			TABLE_START + id * 4,
		);
	return Buffer.concat([header, ...payloads]);
}

function word(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(value, 0);
	return buffer;
}

/** A folded TPW payload: the marker, the declared size and a length-prefixed control stream. */
function foldTpw(content: Buffer): Buffer {
	const head = Buffer.alloc(11);
	Buffer.from("TPW\x01", "binary").copy(head, 0);
	head.writeUInt32LE(content.length, 4);
	head.writeUInt16LE(1, 8);
	head.writeUInt8(content.length, 10);
	return Buffer.concat([head, content]);
}

/** An HDJ payload holding literal runs: a zero bit per literal, grouped 32 per control word. */
function hdjLiterals(content: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let offset = 0; offset < content.length; offset += 32) {
		const chunk = content.subarray(offset, offset + 32);
		parts.push(Buffer.alloc(4));
		for (let wordOffset = 0; wordOffset < chunk.length; wordOffset += 4) {
			const literal = Buffer.alloc(4);
			chunk.copy(literal, 0, wordOffset, wordOffset + 4);
			parts.push(literal);
		}
	}
	return Buffer.concat(parts);
}

/** A literal-only GARbro LZSS stream: a control byte of 0xFF covers eight literal bytes. */
function literalLzss(data: Uint8Array): Buffer {
	const chunks: Uint8Array[] = [];
	for (let offset = 0; offset < data.length; offset += 8)
		chunks.push(Buffer.from([0xff]), data.subarray(offset, offset + 8));
	return Buffer.concat(chunks);
}

function entry(content: Buffer, path = "DATA#0000") {
	return { path, size: content.length, content };
}

describe("Ankh GRP/ICE resource archive", () => {
	it("reads entries from the offset table", async () => {
		const first = Buffer.from("first payload bytes");
		const second = Buffer.from("second");
		await expectArchive({
			format: ankhGrpFormat,
			archive: buildGrp([first, second]),
			sourcePath: "/games/DATA.GRP",
			entries: [entry(first), entry(second, "DATA#0001")],
		});
	});

	it("unfolds an inline TPW payload", async () => {
		const content = Buffer.from("BM0000000000000000");
		await expectArchive({
			format: ankhGrpFormat,
			archive: buildGrp([foldTpw(content)]),
			sourcePath: "/games/DATA.GRP",
			entries: [entry(content, "DATA#0000.bmp")],
		});
	});

	it("copies a stored TPW payload without its four-byte marker", async () => {
		const content = Buffer.from("stored payload");
		const payload = Buffer.concat([Buffer.from("TPW\0", "binary"), content]);
		await expectArchive({
			format: ankhGrpFormat,
			archive: buildGrp([payload]),
			sourcePath: "/games/DATA.GRP",
			entries: [entry(content)],
		});
	});

	it("decodes an HDJ payload with the remembered variant", async () => {
		const content = Buffer.from("hdj literal payload bytes!");
		const payload = Buffer.concat([
			word(content.length),
			Buffer.from("HDJ\0", "binary"),
			hdjLiterals(content),
		]);
		await expectArchive({
			format: ankhGrpFormat,
			archive: buildGrp([payload]),
			sourcePath: "/games/DATA.GRP",
			entries: [entry(content)],
		});
	});

	it("inflates a zfd payload after its eight-byte header", async () => {
		const content = Buffer.from("inflated tga payload");
		const payload = Buffer.concat([
			Buffer.from("zfd ", "ascii"),
			word(content.length),
			deflateSync(content),
		]);
		await expectArchive({
			format: ankhGrpFormat,
			archive: buildGrp([payload]),
			sourcePath: "/games/DATA.GRP",
			entries: [entry(content, "DATA#0000.tga")],
		});
	});

	it("strips the four-byte prefix of an inline Ogg payload", async () => {
		const content = Buffer.from("OggS ogg payload");
		const payload = Buffer.concat([word(0), content]);
		await expectArchive({
			format: ankhGrpFormat,
			archive: buildGrp([payload]),
			sourcePath: "/games/DATA.GRP",
			entries: [entry(content, "DATA#0000.ogg")],
		});
	});

	it("decodes an inline LZSS RIFF payload behind its prefix", async () => {
		const content = Buffer.from("RIFF lzss payload");
		const payload = Buffer.concat([word(content.length), literalLzss(content)]);
		await expectArchive({
			format: ankhGrpFormat,
			archive: buildGrp([payload]),
			sourcePath: "/games/DATA.GRP",
			entries: [entry(content, "DATA#0000.wav")],
		});
	});

	it("decodes packed PCM samples in front of their header", async () => {
		const samples = [0x1111, 0x2222, 0x3333, 0x0444];
		const headerSize = 8;
		const unpackedSize = headerSize + samples.length * 2;
		const head = Buffer.alloc(8);
		head.writeUInt32LE(unpackedSize, 0);
		head.writeUInt8(PCM_MARKER, 4);
		head.write("S", 5, "ascii");
		head.writeUInt8(1, 6);
		head.writeUInt8(headerSize, 7);
		const writer = new WordBitWriter();
		for (const sample of samples) {
			writer.put(1, 1);
			writer.put(1, 1);
			writer.put(sample, 10);
		}
		// The header in front of the samples starts with the RIFF marker the reference probes for.
		const audioHeader = Buffer.alloc(headerSize);
		audioHeader.write("RIFF", 0, "ascii");
		const payload = Buffer.concat([head, audioHeader, writer.finish()]);
		const output = Buffer.alloc(unpackedSize);
		audioHeader.copy(output, 0);
		for (const [index, sample] of samples.entries())
			output.writeInt16LE(((sample << 6) << 16) >> 16, headerSize + index * 2);
		await expectArchive({
			format: ankhGrpFormat,
			archive: buildGrp([payload]),
			sourcePath: "/games/DATA.GRP",
			entries: [entry(output, "DATA#0000.wav")],
		});
	});

	it("leaves a payload of an unknown kind stored", async () => {
		const content = Buffer.from("no recognizable header here");
		await expectArchive({
			format: ankhGrpFormat,
			archive: buildGrp([content]),
			sourcePath: "/games/DATA.GRP",
			entries: [entry(content)],
		});
	});

	it("rejects an unaligned first offset", async () => {
		const archive = buildGrp([Buffer.alloc(16, 0x41)]);
		archive.writeUInt32LE(9, 0);
		const source = new BufferByteSource(archive);
		expect(await ankhGrpFormat.detect(source, "/games/DATA.GRP")).toBe(false);
	});

	it("rejects a table that walks backwards", async () => {
		const archive = buildGrp([Buffer.alloc(16, 0x41)]);
		archive.writeUInt32LE(TABLE_START, TABLE_START);
		const source = new BufferByteSource(archive);
		expect(await ankhGrpFormat.detect(source, "/games/DATA.GRP")).toBe(false);
	});

	it("rejects an archive without entries", async () => {
		const archive = buildGrp([Buffer.alloc(0)]);
		const source = new BufferByteSource(archive);
		expect(await ankhGrpFormat.detect(source, "/games/DATA.GRP")).toBe(false);
	});
});
