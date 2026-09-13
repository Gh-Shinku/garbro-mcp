import { BufferByteSource } from "@garbro-mcp/core";
import { decompressLzBits, maikaBkFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const NAME_SIZE = 0x104;
/** Payloads start behind the offset and size words. */
const PAYLOAD_BASE = 8;
const RECORD_SIZE = 12 + NAME_SIZE;

/** Writes bits from the most significant bit of each byte, matching GARbro's `MsbBitStream`. */
class MsbBitWriter {
	readonly #bytes: number[] = [];
	#current = 0;
	#count = 0;

	writeBit(bit: number): void {
		this.#current = (this.#current << 1) | (bit & 1);
		this.#count += 1;
		if (this.#count === 8) this.#flush();
	}

	writeBits(value: number, count: number): void {
		for (let index = count - 1; index >= 0; index -= 1) {
			this.writeBit((value >> index) & 1);
		}
	}

	#flush(): void {
		this.#bytes.push(this.#current);
		this.#current = 0;
		this.#count = 0;
	}

	toBuffer(): Buffer {
		while (this.#count !== 0) this.writeBit(0);
		return Buffer.from(this.#bytes);
	}
}

/** Encodes a byte run as literals only, which is enough to exercise the ring buffer wiring. */
function literalLzBits(data: Uint8Array): Buffer {
	const writer = new MsbBitWriter();
	for (const byte of data) {
		writer.writeBit(1);
		writer.writeBits(byte, 8);
	}
	return writer.toBuffer();
}

interface BkEntry {
	name: string;
	/** Payload bytes as stored. */
	stored: Buffer;
	/** Declared unpacked size; defaults to the stored length. */
	unpackedSize?: number;
}

/** Lays out the payloads and the uncompressed index they are described by. */
function buildParts(entries: readonly BkEntry[]): {
	payload: Buffer;
	index: Buffer;
} {
	const index = Buffer.alloc(4 + entries.length * RECORD_SIZE);
	index.writeInt32LE(entries.length, 0);
	const payloads: Buffer[] = [];
	// Payloads live behind the eight byte archive header, so their offsets are absolute.
	let offset = PAYLOAD_BASE;
	for (const [id, entry] of entries.entries()) {
		const record = 4 + id * RECORD_SIZE;
		index.writeUInt32LE(offset, record);
		index.writeUInt32LE(entry.stored.length, record + 4);
		index.writeUInt32LE(entry.unpackedSize ?? entry.stored.length, record + 8);
		index.write(entry.name, record + 12, "latin1");
		payloads.push(entry.stored);
		offset += entry.stored.length;
	}
	return { payload: Buffer.concat(payloads), index };
}

/** Assembles an archive: payloads first, then the compressed index covering the file tail. */
function assemble(payload: Buffer, index: Buffer): Buffer {
	const compressed = literalLzBits(index);
	const header = Buffer.alloc(8);
	// The first word is the offset of the index, not of the payloads.
	header.writeUInt32LE(PAYLOAD_BASE + payload.length, 0);
	header.writeUInt32LE(compressed.length, 4);
	return Buffer.concat([header, payload, compressed]);
}

function buildBk(entries: readonly BkEntry[]): Buffer {
	const { payload, index } = buildParts(entries);
	return assemble(payload, index);
}

describe("Maika BK resource archive", () => {
	it("reads a compressed index and stored payloads", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: maikaBkFormat,
			archive: buildBk([
				{ name: "FIRST.BIN", stored: first },
				{ name: "DIR\\SECOND.BIN", stored: second },
			]),
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "DIR/SECOND.BIN", size: second.length, content: second },
			],
		});
	});

	it("unpacks an entry whose sizes differ", async () => {
		const unpacked = Buffer.from("unpacked bytes");
		const stored = literalLzBits(unpacked);
		const archive = buildBk([
			{ name: "PACKED.BIN", stored, unpackedSize: unpacked.length },
		]);
		const source = new BufferByteSource(archive);
		expect(await maikaBkFormat.detect(source)).toBe(true);
		const handle = await maikaBkFormat.open(source, "sample.bk");
		const entry = handle.entries[0];
		if (!entry) throw new Error("missing entry");
		expect(entry.size).toBe(BigInt(unpacked.length));
		expect(entry.packedSize).toBe(BigInt(stored.length));
		expect(entry.compressed).toBe(true);
		const chunks: Buffer[] = [];
		for await (const chunk of await handle.openEntry(entry.id))
			chunks.push(Buffer.from(chunk as Uint8Array));
		expect(Buffer.concat(chunks)).toEqual(unpacked);
	});

	it("inverts the output of a packed gpa entry", async () => {
		const plain = Buffer.from("inverted text");
		const inverted = Buffer.from(plain.map((byte) => byte ^ 0xff));
		const stored = literalLzBits(inverted);
		await expectArchive({
			format: maikaBkFormat,
			archive: buildBk([
				{ name: "SCRIPT.GPA", stored, unpackedSize: plain.length },
			]),
			entries: [{ path: "SCRIPT.GPA", size: plain.length, content: plain }],
		});
	});

	it("leaves an uncompressed gpa entry alone", async () => {
		const stored = Buffer.from("plain gpa bytes");
		await expectArchive({
			format: maikaBkFormat,
			archive: buildBk([{ name: "RAW.GPA", stored }]),
			entries: [{ path: "RAW.GPA", size: stored.length, content: stored }],
		});
	});

	it("marks gpt entries as images", async () => {
		const data = Buffer.alloc(0x20, 0x42);
		const source = new BufferByteSource(
			buildBk([{ name: "PICT.GPT", stored: data }]),
		);
		const handle = await maikaBkFormat.open(source, "sample.bk");
		expect(handle.entries[0]?.metadata).toEqual({ type: "image" });
	});

	it("copies overlapping matches out of the ring buffer", () => {
		// Two literals fill frame slots 1 and 2, then a three byte match from slot 1 reads back the
		// bytes it just wrote.
		const writer = new MsbBitWriter();
		for (const byte of [0x41, 0x42]) {
			writer.writeBit(1);
			writer.writeBits(byte, 8);
		}
		writer.writeBit(0);
		writer.writeBits(1, 10);
		writer.writeBits(1, 5);
		expect(decompressLzBits(writer.toBuffer())).toEqual(
			Buffer.from([0x41, 0x42, 0x41, 0x42, 0x41]),
		);
	});

	it("stops at a truncated stream", () => {
		// A literal bit followed by only three of its eight bits.
		const writer = new MsbBitWriter();
		writer.writeBit(1);
		writer.writeBits(0, 3);
		expect(decompressLzBits(writer.toBuffer())).toEqual(Buffer.alloc(0));
	});

	it("rejects an index that does not cover the file tail", async () => {
		const archive = buildBk([
			{ name: "FILE.BIN", stored: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(1, 0);
		const source = new BufferByteSource(archive);
		expect(await maikaBkFormat.detect(source)).toBe(false);
	});

	it("rejects an index without entries", async () => {
		const { payload } = buildParts([
			{ name: "FILE.BIN", stored: Buffer.from("payload") },
		]);
		const source = new BufferByteSource(assemble(payload, Buffer.alloc(4)));
		expect(await maikaBkFormat.detect(source)).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const { payload, index } = buildParts([
			{ name: "FILE.BIN", stored: Buffer.from("payload") },
		]);
		index.writeUInt32LE(0x1000, 4);
		const source = new BufferByteSource(assemble(payload, index));
		expect(await maikaBkFormat.detect(source)).toBe(false);
	});

	it("rejects a truncated index", async () => {
		const { payload, index } = buildParts([
			{ name: "FILE.BIN", stored: Buffer.from("payload") },
		]);
		// The count promises two records while the index only holds one.
		index.writeInt32LE(2, 0);
		const source = new BufferByteSource(assemble(payload, index));
		expect(await maikaBkFormat.detect(source)).toBe(false);
	});
});
