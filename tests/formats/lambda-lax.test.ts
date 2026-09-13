import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { laxFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const FILE_MARKER = "$LapH__";
const TRAILER_SIZE = 0x28;
const RECORD_SIZE = 0x128;
const DATA_OFFSET = 8;
const CHUNK_HEADER_SIZE = 10;

interface EntrySpec {
	name: string;
	stream: Buffer;
	unpackedSize: number;
}

/** Builds one chunk of the compressed stream. */
function chunk(method: string, body: Buffer, unpackedSize: number): Buffer {
	const header = Buffer.alloc(CHUNK_HEADER_SIZE);
	header.write("_AF", 0, "latin1");
	header.write(method, 3, "latin1");
	header.writeUInt16LE(CHUNK_HEADER_SIZE + body.length, 4);
	header.writeUInt16LE(0, 6);
	header.writeUInt16LE(unpackedSize, 8);
	return Buffer.concat([header, body]);
}

/** A chunk whose method the reference does not know, which stores the body as it is. */
function storedChunk(plain: Buffer): Buffer {
	return chunk("0", plain, plain.length);
}

/** A chunk whose lzss stream is a run of literals: a control byte of eight set bits per group. */
function literalChunk(plain: Buffer): Buffer {
	const parts: number[] = [];
	for (let position = 0; position < plain.length; position += 8) {
		parts.push(0xff);
		for (let step = 0; step < 8 && position + step < plain.length; step += 1)
			parts.push(plain[position + step] ?? 0);
	}
	return chunk("1", Buffer.from(parts), plain.length);
}

/** A copy of eight bytes built from four literals and a back reference to them. */
function copyChunk(): { stream: Buffer; plain: Buffer } {
	// Four literals take the low bits of the control byte, the fifth decision is the copy.
	const body = Buffer.from([0x0f, 0x41, 0x42, 0x43, 0x44, 0xee, 0xf1]);
	return { stream: chunk("1", body, 8), plain: Buffer.from("ABCDABCD") };
}

function packBits(bits: readonly number[]): Buffer {
	const output = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		if (bit === 0) continue;
		const byte = Math.floor(index / 8);
		output[byte] = (output[byte] ?? 0) | (1 << (7 - (index % 8)));
	}
	return output;
}

/** A huffman stream over the symbols the data uses, padded to a complete tree. */
function huffmanStream(data: Buffer): Buffer {
	const symbols = [...new Set([...data])].sort((left, right) => left - right);
	let size = 1;
	while (size < symbols.length) size *= 2;
	const leaves = [...symbols];
	while (leaves.length < size) leaves.push(symbols[0] ?? 0);
	const depth = Math.round(Math.log2(size));
	const bits: number[] = [];
	const writeTree = (minimum: number, count: number): void => {
		if (count === 1) {
			bits.push(
				0,
				...(leaves[minimum] ?? 0)
					.toString(2)
					.padStart(8, "0")
					.split("")
					.map(Number),
			);
			return;
		}
		bits.push(1);
		writeTree(minimum, count / 2);
		writeTree(minimum + count / 2, count / 2);
	};
	writeTree(0, size);
	for (const value of data) {
		const code = leaves.indexOf(value);
		for (let shift = depth - 1; shift >= 0; shift -= 1)
			bits.push((code >> shift) & 1);
	}
	return packBits(bits);
}

function huffmanChunk(plain: Buffer): Buffer {
	return chunk("2", huffmanStream(plain), plain.length);
}

/** Lays out the file marker, the payload streams, the compressed index and the trailer. */
function buildLax(entries: readonly EntrySpec[]): Buffer {
	const index = Buffer.alloc(entries.length * RECORD_SIZE);
	let cursor = DATA_OFFSET;
	const offsets: number[] = [];
	for (const entry of entries) {
		offsets.push(cursor);
		cursor += entry.stream.length;
	}
	for (const [id, entry] of entries.entries()) {
		const position = id * RECORD_SIZE;
		index.write("$LapF__", position, "latin1");
		index.writeUInt32LE(entry.unpackedSize, position + 0x10);
		index.writeUInt32LE(entry.stream.length, position + 0x14);
		index.writeUInt32LE((offsets[id] ?? 0) - DATA_OFFSET, position + 0x18);
		index.write(entry.name, position + 0x24, "latin1");
	}
	const indexStream = storedChunk(index);
	const indexOffset = cursor;
	const trailer = Buffer.alloc(TRAILER_SIZE);
	trailer.write("$LapI__", 0, "latin1");
	trailer.writeInt32LE(entries.length, 8);
	trailer.writeUInt32LE(indexOffset, 0xc);
	trailer.writeUInt32LE(index.length, 0x10);
	trailer.writeUInt32LE(indexStream.length, 0x14);
	return Buffer.concat([
		// The payloads start at the data offset, one byte behind the seven byte marker.
		Buffer.from(FILE_MARKER, "latin1"),
		Buffer.alloc(DATA_OFFSET - FILE_MARKER.length),
		...entries.map((entry) => entry.stream),
		indexStream,
		trailer,
	]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	expect(await laxFormat.detect(new BufferByteSource(file), "sample.lax")).toBe(
		false,
	);
}

describe("Lambda engine resource archive", () => {
	it("lists entries and decodes stored chunks", async () => {
		const first = Buffer.from("stored payload");
		const second = Buffer.from("literal payload bytes");
		await expectArchive({
			format: laxFormat,
			sourcePath: "sample.lax",
			archive: buildLax([
				{
					name: "first.dat",
					stream: storedChunk(first),
					unpackedSize: first.length,
				},
				{
					name: "second.dat",
					stream: literalChunk(second),
					unpackedSize: second.length,
				},
			]),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("copies from the lzss frame", async () => {
		const built = copyChunk();
		await expectArchive({
			format: laxFormat,
			sourcePath: "sample.lax",
			archive: buildLax([
				{
					name: "copy.dat",
					stream: built.stream,
					unpackedSize: built.plain.length,
				},
			]),
			entries: [
				{ path: "copy.dat", size: built.plain.length, content: built.plain },
			],
		});
	});

	it("decodes a huffman chunk", async () => {
		const plain = Buffer.from("huffman chunk contents");
		await expectArchive({
			format: laxFormat,
			sourcePath: "sample.lax",
			archive: buildLax([
				{
					name: "image.bmx",
					stream: huffmanChunk(plain),
					unpackedSize: plain.length,
				},
			]),
			entries: [{ path: "image.bmx", size: plain.length, content: plain }],
		});
	});

	it("decodes a stream of several chunks", async () => {
		const first = Buffer.from("first half ");
		const second = Buffer.from("second half");
		const plain = Buffer.concat([first, second]);
		await expectArchive({
			format: laxFormat,
			sourcePath: "sample.lax",
			archive: buildLax([
				{
					name: "multi.dat",
					stream: Buffer.concat([storedChunk(first), literalChunk(second)]),
					unpackedSize: plain.length,
				},
			]),
			entries: [{ path: "multi.dat", size: plain.length, content: plain }],
		});
	});

	it("marks image extensions and unknown sizes", async () => {
		const file = buildLax([
			{
				name: "still.b32",
				stream: storedChunk(Buffer.from("frame")),
				unpackedSize: 5,
			},
			{
				name: "script.dat",
				stream: literalChunk(Buffer.from("script")),
				unpackedSize: 0,
			},
		]);
		const archive = await laxFormat.open(
			new BufferByteSource(file),
			"sample.lax",
		);
		expect(archive.entries.map((entry) => entry.metadata?.type)).toEqual([
			"image",
			"data",
		]);
		expect(archive.entries[1]?.sizeKnown).toBe(false);
	});

	it("rejects a doubly compressed chunk", async () => {
		const body = Buffer.from("payload");
		const header = Buffer.alloc(CHUNK_HEADER_SIZE);
		header.write("_AF", 0, "latin1");
		header.write("0", 3, "latin1");
		header.writeUInt16LE(CHUNK_HEADER_SIZE + body.length, 4);
		header.writeUInt16LE(1, 6);
		header.writeUInt16LE(body.length, 8);
		const file = buildLax([
			{
				name: "double.dat",
				stream: Buffer.concat([header, body]),
				unpackedSize: body.length,
			},
		]);
		const archive = await laxFormat.open(
			new BufferByteSource(file),
			"sample.lax",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("Missing entry");
		await expect(archive.openEntry(entry.id)).rejects.toBeInstanceOf(
			GarbroError,
		);
	});

	it("rejects a foreign file marker", async () => {
		const file = buildLax([
			{
				name: "first.dat",
				stream: storedChunk(Buffer.from("x")),
				unpackedSize: 1,
			},
		]);
		file.write("$LapZ__", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects a foreign trailer marker", async () => {
		const file = buildLax([
			{
				name: "first.dat",
				stream: storedChunk(Buffer.from("x")),
				unpackedSize: 1,
			},
		]);
		file.write("$LapZ__", file.length - TRAILER_SIZE, "latin1");
		await expectDeclined(file);
	});

	it("rejects an archive without a usable count", async () => {
		const file = buildLax([
			{
				name: "first.dat",
				stream: storedChunk(Buffer.from("x")),
				unpackedSize: 1,
			},
		]);
		file.writeInt32LE(0, file.length - TRAILER_SIZE + 8);
		await expectDeclined(file);
	});

	it("rejects a record without its marker", async () => {
		const file = buildLax([
			{
				name: "first.dat",
				stream: storedChunk(Buffer.from("x")),
				unpackedSize: 1,
			},
		]);
		const indexOffset = file.readUInt32LE(file.length - TRAILER_SIZE + 0xc);
		file.write("$LapZ__", indexOffset + CHUNK_HEADER_SIZE, "latin1");
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildLax([
			{
				name: "first.dat",
				stream: storedChunk(Buffer.from("x")),
				unpackedSize: 1,
			},
		]);
		const indexOffset = file.readUInt32LE(file.length - TRAILER_SIZE + 0xc);
		file.writeUInt32LE(file.length, indexOffset + CHUNK_HEADER_SIZE + 0x14);
		await expectDeclined(file);
	});
});
