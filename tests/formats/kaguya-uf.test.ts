import { BufferByteSource } from "@garbro-mcp/core";
import { kaguyaUfFormat, unpackUfEntry } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const DATA_START = 8;
const PACKED_FLAG = 1;
const PACKED_PREFIX_SIZE = 4;
const NAME_KEY = 0xff;

/** Packs MSB-first bits the way GARbro's `MsbBitStream` consumes them. */
class MsbBitWriter {
	readonly bytes: number[] = [];
	#bits = 0;
	#count = 0;

	putBit(bit: number): void {
		this.#bits = (this.#bits << 1) | (bit & 1);
		this.#count += 1;
		if (this.#count === 8) {
			this.bytes.push(this.#bits & 0xff);
			this.#bits = 0;
			this.#count = 0;
		}
	}

	put(value: number, length: number): void {
		for (let index = length - 1; index >= 0; index -= 1)
			this.putBit((value >> index) & 1);
	}

	finish(): Buffer {
		if (this.#count > 0) {
			this.bytes.push((this.#bits << (8 - this.#count)) & 0xff);
			this.#bits = 0;
			this.#count = 0;
		}
		return Buffer.from(this.bytes);
	}
}

/** Encodes literals only, one eight-bit token each. */
function encodeLiterals(content: Buffer): Buffer {
	const writer = new MsbBitWriter();
	for (const byte of content) {
		writer.putBit(1);
		writer.put(byte, 8);
	}
	return writer.finish();
}

interface Entry {
	name: string;
	content: Buffer;
	packed?: boolean;
}

/**
 * Builds a UF01 archive. The reference reconstructs payload offsets by walking record headers, so the
 * front of the file interleaves each record chunk with its payload while a copy of the record table
 * sits behind the index offset.
 */
function buildUf(entries: readonly Entry[]): Buffer {
	const records = entries.map((entry) => {
		const nameBytes = Buffer.from(entry.name, "latin1");
		const encrypted = Buffer.from(nameBytes);
		for (let index = 0; index < encrypted.length; index += 1)
			encrypted[index] = (encrypted[index] ?? 0) ^ NAME_KEY;
		const stored = entry.packed ? encodeLiterals(entry.content) : entry.content;
		const record = Buffer.alloc(4 + encrypted.length + 2 + 4);
		record.writeInt32LE(encrypted.length, 0);
		encrypted.copy(record, 4);
		record.writeInt16LE(entry.packed ? PACKED_FLAG : 0, 4 + encrypted.length);
		record.writeUInt32LE(stored.length, 4 + encrypted.length + 2);
		return { record, stored };
	});

	// Packed payloads carry their unpacked size in front of the stream, inside the front region.
	const front = Buffer.concat(
		records.flatMap(({ record, stored }, index) => {
			const entry = entries[index];
			if (entry?.packed) {
				const prefix = Buffer.alloc(PACKED_PREFIX_SIZE);
				prefix.writeUInt32LE(entry.content.length, 0);
				return [record, prefix, stored];
			}
			return [record, stored];
		}),
	);
	const indexOffset = DATA_START + front.length;
	const index = Buffer.concat([
		Buffer.alloc(4),
		...records.map(({ record }) => record),
	]);
	// The eight-byte header precedes the region the reference walks from offset eight.
	const archive = Buffer.concat([Buffer.alloc(DATA_START), front, index]);
	archive.write("UF01", 0, "ascii");
	archive.writeUInt32LE(indexOffset, 4);
	return archive;
}

describe("Atelier Kaguya UF01 resource archive", () => {
	it("decodes literals and frame matches", () => {
		const writer = new MsbBitWriter();
		writer.putBit(1);
		writer.put(0x41, 8);
		writer.putBit(0);
		writer.put(1, 12);
		writer.put(1, 4);
		expect(unpackUfEntry(writer.finish(), 4).toString("latin1")).toBe("AAAA");
	});

	it("reads stored entries with inverted names", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const archive = buildUf([
			{ name: "first.dat", content: first },
			{ name: "second.dat", content: second },
		]);
		await expectArchive({
			format: kaguyaUfFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
		});
	});

	it("trims leading separators from names", async () => {
		const content = Buffer.from("payload");
		const archive = buildUf([{ name: "\\sub\\file.dat", content }]);
		await expectArchive({
			format: kaguyaUfFormat,
			archive,
			entries: [{ path: "sub/file.dat", size: content.length, content }],
		});
	});

	it("decodes packed entries behind their size prefix", async () => {
		const content = Buffer.from("packed payload");
		const archive = buildUf([{ name: "packed.dat", content, packed: true }]);
		await expectArchive({
			format: kaguyaUfFormat,
			archive,
			entries: [{ path: "packed.dat", size: content.length, content }],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildUf([
			{ name: "first.dat", content: Buffer.from("payload") },
		]);
		archive.write("XXXX", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await kaguyaUfFormat.detect(source)).toBe(false);
	});

	it("rejects an index offset past the end of the file", async () => {
		const archive = buildUf([
			{ name: "first.dat", content: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(archive.length + 0x10, 4);
		const source = new BufferByteSource(archive);
		expect(await kaguyaUfFormat.detect(source)).toBe(false);
	});

	it("rejects a record with an implausible name length", async () => {
		const archive = buildUf([
			{ name: "first.dat", content: Buffer.from("payload") },
		]);
		const indexOffset = archive.readUInt32LE(4);
		archive.writeInt32LE(0x1000, indexOffset + 4);
		const source = new BufferByteSource(archive);
		expect(await kaguyaUfFormat.detect(source)).toBe(false);
	});
});
