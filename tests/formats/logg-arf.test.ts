import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { loggArfFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

interface ArfRecord {
	name: string;
	unpacked: Buffer;
	stored: Buffer;
}

/**
 * GARbro `LsbBitStream` writer: bits fill each byte from its least significant bit upwards, and a
 * value is written with its own least significant bit first.
 */
class LsbBitWriter {
	readonly #bytes: number[] = [];
	#byte = 0;
	#offset = 0;

	writeBit(bit: number): void {
		this.#byte |= (bit & 1) << this.#offset;
		this.#offset += 1;
		if (this.#offset === 8) {
			this.#bytes.push(this.#byte);
			this.#byte = 0;
			this.#offset = 0;
		}
	}

	writeBits(value: number, count: number): void {
		for (let index = 0; index < count; index += 1)
			this.writeBit((value >> index) & 1);
	}

	toBuffer(): Buffer {
		const bytes = Buffer.from(this.#bytes);
		return this.#offset === 0
			? bytes
			: Buffer.concat([bytes, Buffer.from([this.#byte])]);
	}
}

function writeLiteral(writer: LsbBitWriter, value: number): void {
	writer.writeBit(0);
	writer.writeBits(value, 8);
}

/** Encodes a match with the ladder of bits the ARF codec reads. */
function writeMatch(
	writer: LsbBitWriter,
	count: number,
	distance: number,
): void {
	writer.writeBit(1);
	if (count === 2) writer.writeBit(0);
	else if (count === 3) {
		writer.writeBit(1);
		writer.writeBit(0);
	} else if (count === 4) {
		writer.writeBits(3, 2);
		writer.writeBit(0);
	} else if (count === 5) {
		writer.writeBits(7, 3);
		writer.writeBit(0);
	} else if (count === 6) {
		writer.writeBits(0xf, 4);
		writer.writeBits(0, 2);
	} else if (count <= 10) {
		writer.writeBits(0xf, 4);
		writer.writeBits(1, 2);
		writer.writeBits(count - 7, 2);
	} else if (count <= 26) {
		writer.writeBits(0xf, 4);
		writer.writeBits(2, 2);
		writer.writeBits(count - 11, 4);
	} else {
		writer.writeBits(0xf, 4);
		writer.writeBits(3, 2);
		writer.writeBits(count - 26, 10);
	}
	if (distance < 0x100) {
		writer.writeBit(0);
		writer.writeBits(distance, 8);
	} else if (distance < 0x500) {
		writer.writeBit(1);
		writer.writeBit(0);
		writer.writeBits(distance - 0x100, 10);
	} else {
		writer.writeBits(3, 2);
		writer.writeBits(distance - 0x500, 12);
	}
}

/**
 * Builds an ARF archive. The index holds payload offsets, unpacked sizes and one byte names, and the
 * stored sizes are implied by the gaps between consecutive payloads, so the payloads are contiguous.
 */
function buildArf(records: readonly ArfRecord[]): Buffer {
	const encoded = records.map((record) => ({
		...record,
		encoded: encodeCp932(record.name),
	}));
	const indexSize = encoded.reduce(
		(total, record) => total + 9 + record.encoded.length,
		0,
	);
	let running = 4 + indexSize;
	const index: Buffer[] = [];
	for (const record of encoded) {
		const entry = Buffer.alloc(9 + record.encoded.length);
		entry.writeUInt32LE(running, 0);
		entry.writeUInt32LE(record.unpacked.length, 4);
		entry.writeUInt8(record.encoded.length, 8);
		record.encoded.copy(entry, 9);
		index.push(entry);
		running += record.stored.length;
	}
	const header = Buffer.alloc(4);
	header.writeInt32LE(encoded.length, 0);
	return Buffer.concat([
		header,
		...index,
		...encoded.map((record) => record.stored),
	]);
}

describe("Logg ARF resource archive", () => {
	it("lists stored entries whose gaps supply their sizes", async () => {
		const first = Buffer.from("stored payload");
		const second = Buffer.from("second stored payload");
		await expectArchive({
			format: loggArfFormat,
			archive: buildArf([
				{ name: "FIRST.BIN", unpacked: first, stored: first },
				{ name: "DIR\\SECOND.BIN", unpacked: second, stored: second },
			]),
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "DIR/SECOND.BIN", size: second.length, content: second },
			],
		});
	});

	it("unpacks a match that repeats the previous byte", async () => {
		const writer = new LsbBitWriter();
		writeLiteral(writer, 0x41);
		writeMatch(writer, 3, 0);
		const stored = writer.toBuffer();
		expect(stored.length).toBeLessThan(4);
		await expectArchive({
			format: loggArfFormat,
			archive: buildArf([
				{
					name: "MATCH.BIN",
					unpacked: Buffer.from("AAAA"),
					stored,
				},
			]),
			entries: [
				{
					path: "MATCH.BIN",
					size: 4,
					content: Buffer.from("AAAA"),
				},
			],
		});
	});

	it("unpacks a long match through the extended ladders", async () => {
		const literals = Buffer.alloc(300);
		for (let index = 0; index < literals.length; index += 1)
			literals[index] = index & 0xff;
		const writer = new LsbBitWriter();
		for (const value of literals) writeLiteral(writer, value);
		// A distance of 0x100 takes the middle distance ladder and stays behind the match, and a count
		// of 200 takes the ten bit count ladder.
		writeMatch(writer, 200, 0x100);
		const stored = writer.toBuffer();
		const unpacked = Buffer.concat([literals, literals.subarray(43, 243)]);
		expect(stored.length).toBeLessThan(unpacked.length);
		await expectArchive({
			format: loggArfFormat,
			archive: buildArf([{ name: "RUN.BIN", unpacked, stored }]),
			entries: [{ path: "RUN.BIN", size: unpacked.length, content: unpacked }],
		});
	});

	it("unpacks a far match through the widest ladders", async () => {
		const literals = Buffer.alloc(0x600);
		for (let index = 0; index < literals.length; index += 1)
			literals[index] = (index * 7) & 0xff;
		const writer = new LsbBitWriter();
		for (const value of literals) writeLiteral(writer, value);
		// A distance of 0x500 takes the twelve bit ladder, and 1049 is the largest count of the widest one.
		writeMatch(writer, 1049, 0x500);
		const stored = writer.toBuffer();
		const unpacked = Buffer.concat([literals, literals.subarray(0xff, 0x518)]);
		expect(stored.length).toBeLessThan(unpacked.length);
		await expectArchive({
			format: loggArfFormat,
			archive: buildArf([{ name: "FAR.BIN", unpacked, stored }]),
			entries: [{ path: "FAR.BIN", size: unpacked.length, content: unpacked }],
		});
	});

	it("drops entries without a name but keeps them as delimiters", async () => {
		const first = Buffer.from("first payload");
		const filler = Buffer.from("filler bytes");
		const last = Buffer.from("last payload");
		await expectArchive({
			format: loggArfFormat,
			archive: buildArf([
				{ name: "FIRST.BIN", unpacked: first, stored: first },
				{ name: "", unpacked: filler, stored: filler },
				{ name: "LAST.BIN", unpacked: last, stored: last },
			]),
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "LAST.BIN", size: last.length, content: last },
			],
		});
	});

	it("wraps a stored size for offsets that do not increase", async () => {
		const archive = buildArf([
			{ name: "HIGH.BIN", unpacked: Buffer.alloc(4), stored: Buffer.alloc(4) },
			{ name: "LOW.BIN", unpacked: Buffer.alloc(8), stored: Buffer.alloc(8) },
		]);
		// Point the first record behind the second one, which the forward walk still accepts.
		const secondOffset = archive.readUInt32LE(4 + 9 + 8);
		archive.writeUInt32LE(secondOffset + 4, 4);
		const source = new BufferByteSource(archive);
		expect(await loggArfFormat.detect(source, "sample.arf")).toBe(true);
		const handle = await loggArfFormat.open(source, "sample.arf");
		const entry = handle.entries[0];
		if (!entry) throw new Error("Missing entry");
		expect(entry.compressed).toBe(true);
		expect(entry.packedSize).toBe(0xfffffffcn);
		expect(entry.size).toBe(4n);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildArf([
			{ name: "A.BIN", unpacked: Buffer.from("a"), stored: Buffer.from("a") },
		]);
		archive.writeInt32LE(0x40000, 0);
		const source = new BufferByteSource(archive);
		expect(await loggArfFormat.detect(source, "sample.arf")).toBe(false);
	});

	it("rejects a payload offset inside the index", async () => {
		const archive = buildArf([
			{ name: "A.BIN", unpacked: Buffer.from("a"), stored: Buffer.from("a") },
		]);
		// Record zero starts at 4, so its offset has to point behind that.
		archive.writeUInt32LE(4, 4);
		expect(
			await loggArfFormat.detect(new BufferByteSource(archive), "sample.arf"),
		).toBe(false);
	});

	it("rejects an index that overruns the first payload", async () => {
		const archive = buildArf([
			{
				name: "A.BIN",
				unpacked: Buffer.alloc(0x20),
				stored: Buffer.alloc(0x20),
			},
		]);
		// Shrink the first payload offset below the end of the index walk.
		archive.writeUInt32LE(8, 4);
		expect(
			await loggArfFormat.detect(new BufferByteSource(archive), "sample.arf"),
		).toBe(false);
	});

	it("rejects a name that reaches past the archive", async () => {
		const archive = Buffer.concat([
			Buffer.from([1, 0, 0, 0]),
			Buffer.from([0x10, 0, 0, 0, 0x10, 0, 0, 0, 0x40]),
		]);
		expect(
			await loggArfFormat.detect(new BufferByteSource(archive), "sample.arf"),
		).toBe(false);
	});

	it("reports truncated compressed streams", async () => {
		const writer = new LsbBitWriter();
		writeLiteral(writer, 0x41);
		const unpacked = Buffer.from("AAAAAAAA");
		const archive = buildArf([
			{ name: "SHORT.BIN", unpacked, stored: writer.toBuffer() },
		]);
		const source = new BufferByteSource(archive);
		const handle = await loggArfFormat.open(source, "sample.arf");
		const entry = handle.entries[0];
		if (!entry) throw new Error("Missing entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow();
	});
});
