import { BufferByteSource } from "@garbro-mcp/core";
import { unisonVctFormat, unpackVctLzs } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x14;

interface VctEntry {
	name: string;
	extension: string;
	data: Buffer;
}

/** Builds a VCT archive: a byte count with three-byte records, the entry table and the payloads. */
function buildVct(entries: readonly VctEntry[], subindexCount = 1): Buffer {
	const countOffset = 1 + subindexCount * 3;
	const indexStart = countOffset + 4;
	const payloadBase = indexStart + entries.length * RECORD_SIZE;
	const header = Buffer.alloc(indexStart);
	header[0] = subindexCount;
	header.writeInt32LE(entries.length, countOffset);
	const index = Buffer.alloc(entries.length * RECORD_SIZE);
	const payloads: Buffer[] = [];
	let offset = payloadBase;
	for (const [id, entry] of entries.entries()) {
		const record = id * RECORD_SIZE;
		index.write(entry.name, record, "latin1");
		index.write(entry.extension, record + NAME_SIZE, "latin1");
		index.writeUInt32LE(offset, record + 0x18);
		index.writeUInt32LE(entry.data.length, record + 0x1c);
		payloads.push(entry.data);
		offset += entry.data.length;
	}
	return Buffer.concat([header, index, ...payloads]);
}

/** Encodes a byte run as literals: eight set control bits cover eight literals, least bit first. */
function literalLzs(data: Uint8Array): Buffer {
	const control: number[] = [];
	for (let index = 0; index < data.length; index += 8) control.push(0xff);
	const header = Buffer.alloc(16);
	header.write("LZS\0", 0, "ascii");
	header.writeUInt32LE(data.length, 4);
	header.writeUInt32LE(data.length + control.length, 8);
	header.writeUInt32LE(control.length, 12);
	return Buffer.concat([header, Buffer.from(control), data]);
}

describe("Unison Shift VCT resource archive", () => {
	it("lists entries with trimmed names and appended extensions", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second");
		await expectArchive({
			format: unisonVctFormat,
			archive: buildVct([
				{ name: "FIRST   ", extension: "BIN", data: first },
				{ name: "SECOND", extension: "   ", data: second },
			]),
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "SECOND", size: second.length, content: second },
			],
		});
	});

	it("unpacks an entry that carries the marker", async () => {
		const unpacked = Buffer.from("packed body");
		const stored = literalLzs(unpacked);
		await expectArchive({
			format: unisonVctFormat,
			archive: buildVct([{ name: "PACKED", extension: "DAT", data: stored }]),
			entries: [
				{ path: "PACKED.DAT", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("copies overlapping matches out of the ring", () => {
		// One literal lands in frame slot one, then a three byte match reads it back.
		const control = Buffer.from([0b00000001]);
		const header = Buffer.alloc(16);
		header.write("LZS\0", 0, "ascii");
		header.writeUInt32LE(4, 4);
		header.writeUInt32LE(6, 8);
		header.writeUInt32LE(1, 12);
		const match = Buffer.alloc(2);
		match.writeUInt16LE((1 << 12) | 1, 0);
		expect(
			unpackVctLzs(
				Buffer.concat([header, control, Buffer.from([0x41]), match]),
			),
		).toEqual(Buffer.from("AAAA"));
	});

	it("repairs a packed thirty-two bit bitmap through the opener", async () => {
		const bitmap = Buffer.alloc(0x44);
		bitmap.write("BM", 0, "ascii");
		bitmap.writeInt32LE(0x36, 0x0a);
		bitmap.writeUInt16LE(32, 0x1c);
		// Stored pixels are BGRA with an inverted alpha; the repair swaps the outer channels.
		bitmap.writeUInt32LE(0x00010203, 0x36);
		bitmap.writeUInt32LE(0x00040506, 0x3a);
		const expected = Buffer.from(bitmap);
		expected.writeUInt32LE(0xff030201, 0x36);
		expected.writeUInt32LE(0xff060504, 0x3a);
		expected.writeUInt32LE(0xff000000, 0x3e);
		await expectArchive({
			format: unisonVctFormat,
			archive: buildVct([
				{ name: "PIC", extension: "BMP", data: literalLzs(bitmap) },
			]),
			entries: [{ path: "PIC.BMP", size: bitmap.length, content: expected }],
		});
	});

	it("swaps the palette words of the special header shape", async () => {
		const bitmap = Buffer.alloc(0x44);
		bitmap.write("BM", 0, "ascii");
		bitmap.writeInt32LE(0x36, 0x0a);
		bitmap.writeUInt16LE(32, 0x1c);
		// Stored values chosen so the repaired words match the flag pair the reference looks for.
		bitmap.writeUInt32LE(0xffff0000, 0x36);
		bitmap.writeUInt32LE(0x44443322, 0x3a);
		bitmap.writeUInt32LE(0xff0000ff, 0x3e);
		const expected = Buffer.from(bitmap);
		expected.writeUInt32LE(0x00ff0000, 0x36);
		expected.writeUInt32LE(0xbb223344, 0x3a);
		expected.writeUInt32LE(0x000000ff, 0x3e);
		await expectArchive({
			format: unisonVctFormat,
			archive: buildVct([
				{ name: "PAL", extension: "BMP", data: literalLzs(bitmap) },
			]),
			entries: [{ path: "PAL.BMP", size: bitmap.length, content: expected }],
		});
	});

	it("rejects a truncated lzs control array", () => {
		const header = Buffer.alloc(16);
		header.write("LZS\0", 0, "ascii");
		header.writeUInt32LE(4, 4);
		header.writeUInt32LE(4, 8);
		header.writeUInt32LE(0x100, 12);
		expect(() => unpackVctLzs(header)).toThrow();
	});

	it("rejects a zero subindex count", async () => {
		const archive = buildVct([
			{ name: "FILE", extension: "BIN", data: Buffer.from("x") },
		]);
		archive[0] = 0;
		const source = new BufferByteSource(archive);
		expect(await unisonVctFormat.detect(source)).toBe(false);
	});

	it("rejects an unnamed entry", async () => {
		const archive = buildVct([
			{ name: "        ", extension: "BIN", data: Buffer.from("x") },
		]);
		const source = new BufferByteSource(archive);
		expect(await unisonVctFormat.detect(source)).toBe(false);
	});

	it("rejects an index that reaches past the archive", async () => {
		const archive = buildVct([
			{ name: "FILE", extension: "BIN", data: Buffer.from("x") },
		]);
		archive.writeInt32LE(0x100, 1 + 3);
		const source = new BufferByteSource(archive);
		expect(await unisonVctFormat.detect(source)).toBe(false);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildVct([
			{ name: "FILE", extension: "BIN", data: Buffer.from("x") },
		]);
		const indexStart = 1 + 3 + 4;
		archive.writeUInt32LE(0x1000, indexStart + 0x18);
		const source = new BufferByteSource(archive);
		expect(await unisonVctFormat.detect(source)).toBe(false);
	});
});
