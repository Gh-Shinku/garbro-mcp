import { BufferByteSource } from "@garbro-mcp/core";
import { fa2Format, inflateFa2 } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const SIGNATURE = "FA2\0";
const HEADER_SIZE = 0x10;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0xf;
const ALIGNMENT = 0x10;

/**
 * Mirrors the reader of the format: control bits come from a 32 bit little endian chunk consumed from its
 * most significant bit, while literal bytes are read from the stream at the current position.
 */
class Fa2Writer {
	readonly #bytes = new Map<number, number>();
	#position = 0;
	#chunkStart = -1;
	#bits = 0;
	#available = 0;

	#startChunk(): void {
		this.#flushChunk();
		this.#chunkStart = this.#position;
		this.#bits = 0;
		this.#available = 32;
		this.#position += 4;
	}

	#flushChunk(): void {
		if (this.#chunkStart < 0) return;
		for (let index = 0; index < 4; index += 1)
			this.#bytes.set(
				this.#chunkStart + index,
				(this.#bits >>> (8 * index)) & 0xff,
			);
		this.#chunkStart = -1;
	}

	writeBit(bit: number): void {
		if (this.#available === 0) this.#startChunk();
		if (bit !== 0)
			this.#bits = (this.#bits | (1 << (this.#available - 1))) >>> 0;
		this.#available -= 1;
	}

	writeBits(value: number, count: number): void {
		for (let shift = count - 1; shift >= 0; shift -= 1)
			this.writeBit((value >> shift) & 1);
	}

	writeByte(value: number): void {
		this.#bytes.set(this.#position, value & 0xff);
		this.#position += 1;
	}

	finish(): Buffer {
		this.#flushChunk();
		const size = Math.max(...this.#bytes.keys(), -1) + 1;
		const output = Buffer.alloc(size);
		for (const [position, value] of this.#bytes) output[position] = value;
		return output;
	}
}

/** A literal run, which stores every byte behind a set control bit. */
function literals(data: Buffer): Buffer {
	const writer = new Fa2Writer();
	for (const byte of data) {
		writer.writeBit(1);
		writer.writeByte(byte);
	}
	return writer.finish();
}

interface Spec {
	name: string;
	payload: Buffer;
	/** Plain payloads are stored as they are, packed ones go through the codec. */
	packed: boolean;
}

/** Lays out the header, the payloads on their sixteen byte steps and the index behind them. */
function buildFa2(specs: readonly Spec[], packIndex: boolean): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	header.write(SIGNATURE, 0, "latin1");
	header[4] = packIndex ? 1 : 0;
	header.writeInt32LE(specs.length, 0xc);
	const index = Buffer.alloc(specs.length * RECORD_SIZE);
	const stored: Buffer[] = [];
	let payloadOffset = HEADER_SIZE;
	for (const [id, spec] of specs.entries()) {
		const position = id * RECORD_SIZE;
		index.write(spec.name, position, "latin1");
		index[position + NAME_SIZE] = spec.packed ? 2 : 0;
		const sizes = position + NAME_SIZE + 9;
		const data = spec.packed ? literals(spec.payload) : spec.payload;
		index.writeUInt32LE(spec.payload.length, sizes);
		index.writeUInt32LE(data.length, sizes + 4);
		const padded = Buffer.alloc(
			(data.length + ALIGNMENT - 1) & ~(ALIGNMENT - 1),
		);
		data.copy(padded);
		stored.push(padded);
		payloadOffset += padded.length;
	}
	const indexData = packIndex ? literals(index) : index;
	header.writeUInt32LE(payloadOffset, 8);
	return Buffer.concat([header, ...stored, indexData]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	expect(await fa2Format.detect(new BufferByteSource(file), "sample.fa2")).toBe(
		false,
	);
}

describe("Foster game engine resource archive", () => {
	it("lists a plain index and reads stored payloads", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		await expectArchive({
			format: fa2Format,
			sourcePath: "sample.fa2",
			archive: buildFa2(
				[
					{ name: "first.dat", payload: first, packed: false },
					{ name: "second.dat", payload: second, packed: false },
				],
				false,
			),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads a packed index and unpacks payloads", async () => {
		const first = Buffer.from("packed payload contents");
		const second = Buffer.from("stored payload");
		await expectArchive({
			format: fa2Format,
			sourcePath: "sample.fa2",
			archive: buildFa2(
				[
					{ name: "packed.dat", payload: first, packed: true },
					{ name: "plain.dat", payload: second, packed: false },
				],
				true,
			),
			entries: [
				{ path: "packed.dat", size: first.length, content: first },
				{ path: "plain.dat", size: second.length, content: second },
			],
		});
	});

	it("copies two bytes with a short offset", async () => {
		const head = Buffer.from("ABCD");
		const writer = new Fa2Writer();
		for (const byte of head) {
			writer.writeBit(1);
			writer.writeByte(byte);
		}
		// A two byte copy from the previous byte, then a literal.
		writer.writeBit(0);
		writer.writeBit(1);
		writer.writeBit(0);
		writer.writeByte(1);
		writer.writeBit(1);
		writer.writeByte(0x5a);
		const stored = writer.finish();
		const decoded = inflateFa2(stored, 7);
		expect(decoded.equals(Buffer.from("ABCDCDZ"))).toBe(true);
	});

	it("copies a run with a counted length", async () => {
		const head = Buffer.from("wxyz");
		const writer = new Fa2Writer();
		for (const byte of head) {
			writer.writeBit(1);
			writer.writeByte(byte);
		}
		// A counted offset of three with a length of three, copying the whole payload.
		writer.writeBit(0);
		writer.writeBit(0);
		writer.writeBit(1);
		writer.writeByte(1);
		writer.writeBit(1);
		writer.writeBit(1);
		const stored = writer.finish();
		const decoded = inflateFa2(stored, 7);
		expect(decoded.equals(Buffer.from("wxyzwxy"))).toBe(true);
	});

	it("copies with an overlap", async () => {
		const head = Buffer.from("wxyz");
		const writer = new Fa2Writer();
		for (const byte of head) {
			writer.writeBit(1);
			writer.writeByte(byte);
		}
		// An offset of zero repeats the byte that was written last.
		writer.writeBit(0);
		writer.writeBit(0);
		writer.writeBit(1);
		writer.writeByte(0);
		writer.writeBit(0);
		writer.writeBit(1);
		const decoded = inflateFa2(writer.finish(), 7);
		expect(decoded.equals(Buffer.from("wxyzzzz"))).toBe(true);
	});

	it("stops at the end marker", async () => {
		const writer = new Fa2Writer();
		for (const byte of Buffer.from("head")) {
			writer.writeBit(1);
			writer.writeByte(byte);
		}
		// The longest long offset form ends the stream.
		writer.writeBit(0);
		writer.writeBit(1);
		writer.writeBit(1);
		writer.writeByte(0xff);
		writer.writeBits(7, 3);
		const decoded = inflateFa2(writer.finish(), 16);
		expect(decoded.length).toBe(4);
	});

	it("aligns payloads to sixteen bytes", async () => {
		const first = Buffer.from("unaligned payload");
		const second = Buffer.from("second");
		const file = buildFa2(
			[
				{ name: "first.dat", payload: first, packed: false },
				{ name: "second.dat", payload: second, packed: false },
			],
			false,
		);
		const archive = await fa2Format.open(
			new BufferByteSource(file),
			"sample.fa2",
		);
		const secondEntry = archive.entries[1];
		if (!secondEntry) throw new Error("Missing entry");
		expect(secondEntry.size).toBe(BigInt(second.length));
		const content = await consumeBuffer(
			await archive.openEntry(secondEntry.id),
		);
		expect(content.equals(second)).toBe(true);
	});

	it("rejects a foreign signature", async () => {
		const file = buildFa2(
			[{ name: "first.dat", payload: Buffer.from("x"), packed: false }],
			false,
		);
		file.write("FA3\0", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects an archive without entries", async () => {
		const file = buildFa2(
			[{ name: "first.dat", payload: Buffer.from("x"), packed: false }],
			false,
		);
		file.writeInt32LE(0, 0xc);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildFa2(
			[{ name: "first.dat", payload: Buffer.from("x"), packed: false }],
			false,
		);
		const sizes = file.readUInt32LE(8) + NAME_SIZE + 9;
		file.writeUInt32LE(0xffff, sizes + 4);
		await expectDeclined(file);
	});

	it("rejects a truncated index", async () => {
		const file = buildFa2(
			[{ name: "first.dat", payload: Buffer.from("x"), packed: false }],
			false,
		);
		file.writeInt32LE(4, 0xc);
		await expectDeclined(file);
	});
});
