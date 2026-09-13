import { BufferByteSource } from "@garbro-mcp/core";
import { blackButterflyDatFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_START = 0x10;

/** Emits a literal run, which the codec reads as a length from 0x80 through 0x9F. */
function literalRun(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let offset = 0; offset < data.length; offset += 32) {
		const count = Math.min(32, data.length - offset);
		chunks.push(
			Buffer.from([0x80 | (count - 1)]),
			data.subarray(offset, offset + count),
		);
	}
	return Buffer.concat(chunks);
}

/** Emits a match, whose ten bit distance is stored inverted. */
function match(distance: number, count: number): Buffer {
	const raw = (distance - 1) ^ 0x3ff;
	return Buffer.from([((count - 2) << 2) | ((raw >> 8) & 3), raw & 0xff]);
}

/** Emits the `7F FF` end marker. */
const END_MARKER = Buffer.from([0x7f, 0xff]);

/**
 * Builds a DAT/PITA archive. Payloads are a four byte unpacked size followed by the packed stream, and
 * the offset table holds one offset more than the entry count.
 */
function buildArchive(payloads: readonly Buffer[]): Buffer {
	const offsets: Buffer[] = [];
	let running = INDEX_START + (payloads.length + 1) * 4;
	for (const payload of payloads) {
		const word = Buffer.alloc(4);
		word.writeUInt32LE(running, 0);
		offsets.push(word);
		running += payload.length;
	}
	const end = Buffer.alloc(4);
	end.writeUInt32LE(running, 0);
	const header = Buffer.alloc(INDEX_START);
	header.write("PITA", 0, "latin1");
	header.writeInt32LE(payloads.length, 4);
	return Buffer.concat([header, ...offsets, end, ...payloads]);
}

/** Wraps a packed stream with the unpacked size field a payload starts with. */
function payload(stream: Buffer, unpackedSize: number): Buffer {
	const size = Buffer.alloc(4);
	size.writeUInt32LE(unpackedSize, 0);
	return Buffer.concat([size, stream]);
}

describe("Black Butterfly DAT/PITA resource archive", () => {
	it("lists entries and unpacks literal and match commands", async () => {
		const first = Buffer.from("ABABAB");
		const stream = Buffer.concat([
			literalRun(Buffer.from("AB")),
			// A distance of two repeats the pair that was just written.
			match(2, 4),
			END_MARKER,
		]);
		const second = Buffer.from("plain payload");
		await expectArchive({
			format: blackButterflyDatFormat,
			archive: buildArchive([
				payload(stream, first.length),
				payload(literalRun(second), second.length),
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "00000.bmp", size: first.length, content: first },
				{ path: "00001.bmp", size: second.length, content: second },
			],
		});
	});

	it("packs runs of zeroes, repeated bytes and interleaved pairs", async () => {
		const first = Buffer.concat([
			literalRun(Buffer.from("X")),
			// 0xC0 to 0xDF repeat a byte read from the stream.
			Buffer.from([0xc0, 0x5a]),
			// 0xE0 to 0xFE repeat zero.
			Buffer.from([0xe2]),
			// 0xA0 to 0xBF write a zero followed by one stream byte.
			Buffer.from([0xa1, 0x11, 0x22]),
			// 0xFF reads an explicit zero run length beyond 32.
			Buffer.from([0xff, 0x00]),
			END_MARKER,
		]);
		const expected = Buffer.concat([
			Buffer.from("X"),
			Buffer.alloc(2, 0x5a),
			Buffer.alloc(3),
			Buffer.from([0, 0x11, 0, 0x22]),
			Buffer.alloc(32),
		]);
		await expectArchive({
			format: blackButterflyDatFormat,
			archive: buildArchive([payload(first, expected.length)]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "00000.bmp", size: expected.length, content: expected },
			],
		});
	});

	it("records image metadata and generated names", async () => {
		const stored = Buffer.from("payload");
		const archive = buildArchive([payload(literalRun(stored), stored.length)]);
		const source = new BufferByteSource(archive);
		const handle = await blackButterflyDatFormat.open(source, "sample.dat");
		expect(handle.entries.map((entry) => entry.metadata?.type)).toEqual([
			"image",
		]);
	});

	it("reports the stored size separately from the unpacked size", async () => {
		const stored = Buffer.from("aaaaaaaaaaaaaaaaaaaa");
		const archive = buildArchive([payload(literalRun(stored), stored.length)]);
		const source = new BufferByteSource(archive);
		const handle = await blackButterflyDatFormat.open(source, "sample.dat");
		const entry = handle.entries[0];
		if (!entry) throw new Error("Missing entry");
		expect(entry.compressed).toBe(true);
		expect(entry.size).toBe(BigInt(stored.length));
		expect(entry.packedSize).toBeGreaterThan(entry.size);
		expect(await consumeBuffer(await handle.openEntry(entry.id))).toEqual(
			stored,
		);
	});

	it("rejects a foreign signature", async () => {
		const archive = buildArchive([payload(END_MARKER, 0)]);
		archive.write("PITB", 0, "latin1");
		expect(
			await blackButterflyDatFormat.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildArchive([payload(END_MARKER, 0)]);
		archive.writeInt32LE(0x40000, 4);
		expect(
			await blackButterflyDatFormat.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});

	it("rejects an offset table that reaches past the archive", async () => {
		const archive = buildArchive([payload(END_MARKER, 0)]);
		archive.writeUInt32LE(0x10000, INDEX_START);
		expect(
			await blackButterflyDatFormat.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});

	it("rejects an entry whose offsets do not increase", async () => {
		const archive = buildArchive([
			payload(literalRun(Buffer.from("payload")), 7),
		]);
		const firstOffset = archive.readUInt32LE(INDEX_START);
		archive.writeUInt32LE(firstOffset, INDEX_START + 4);
		expect(
			await blackButterflyDatFormat.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});

	it("rejects an output length beyond the unpacked size", async () => {
		const stream = Buffer.concat([
			// A single zero command writes more bytes than the payload declares.
			Buffer.from([0xff, 0x10]),
			END_MARKER,
		]);
		const archive = buildArchive([payload(stream, 2)]);
		const source = new BufferByteSource(archive);
		const handle = await blackButterflyDatFormat.open(source, "sample.dat");
		const entry = handle.entries[0];
		if (!entry) throw new Error("Missing entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow();
	});

	it("rejects a truncated command stream", async () => {
		const archive = buildArchive([payload(Buffer.from([0x9f]), 8)]);
		const source = new BufferByteSource(archive);
		const handle = await blackButterflyDatFormat.open(source, "sample.dat");
		const entry = handle.entries[0];
		if (!entry) throw new Error("Missing entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow();
	});
});
