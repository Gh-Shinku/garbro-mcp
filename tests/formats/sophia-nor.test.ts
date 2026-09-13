import { BufferByteSource } from "@garbro-mcp/core";
import { decompressNcmb, sophiaNorFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_START = 0x10;
const HEADER_SIZE = 0x2c;

interface NorEntry {
	name: string;
	data: Buffer;
	/** Payload header words: packed size, unpacked size and method. */
	header?: { packedSize: number; unpackedSize: number; method: number };
}

/** Builds a NOR archive: count, marker, records of offset/size/name and the payloads. */
function buildNor(entries: readonly NorEntry[]): Buffer {
	const records = entries.map((entry) => {
		const nameBuffer = Buffer.from(`${entry.name}\0`, "latin1");
		const record = Buffer.alloc(8 + nameBuffer.length);
		nameBuffer.copy(record, 8);
		return record;
	});
	// Records are walked rather than indexed, so the payload base follows their real lengths.
	let offset =
		INDEX_START + records.reduce((total, record) => total + record.length, 0);
	for (const [id, entry] of entries.entries()) {
		records[id]?.writeUInt32LE(offset, 0);
		records[id]?.writeUInt32LE(entry.data.length, 4);
		offset += entry.data.length;
	}
	const header = Buffer.alloc(INDEX_START);
	header.writeInt32LE(entries.length, 0);
	header.write("NRCOMB01\0", 4, "latin1");
	return Buffer.concat([header, ...records, ...entries.map((e) => e.data)]);
}

/** A payload that carries the compressed-entry header. */
function wrappedPayload(
	stream: Buffer,
	header: { packedSize: number; unpackedSize: number; method: number },
): Buffer {
	const wrapper = Buffer.alloc(HEADER_SIZE);
	wrapper.write("NCMB01", 0, "ascii");
	wrapper.writeUInt32LE(header.packedSize, 0x10);
	wrapper.writeUInt32LE(header.unpackedSize, 0x24);
	wrapper.writeInt32LE(header.method, 0x28);
	return Buffer.concat([wrapper, stream]);
}

/**
 * Builds an NCMB stream whose tree has two leaves, so a bit of zero emits 'A' and a bit of one emits
 * 'B'. Leaves are nodes whose left child is -1, and a leaf emits its own node index.
 */
function buildNcmb(bits: readonly (0 | 1)[]): Buffer {
	const root = 0xfe;
	const leaves = [0x41, 0x42];
	const words = [root, 4, bits.length];
	// Node 0xFE points at the two leaves, each of which is a leaf itself.
	words.push(root, leaves[0] ?? 0, leaves[1] ?? 0);
	for (const leaf of leaves) words.push(leaf, -1, -1);
	const header = Buffer.alloc(words.length * 4);
	words.forEach((word, index) => {
		header.writeInt32LE(word, index * 4);
	});
	let current = 0;
	let mask = 0x80;
	const bytes: number[] = [];
	for (const bit of bits) {
		if (bit) current |= mask;
		mask >>= 1;
		if (mask === 0) {
			bytes.push(current);
			current = 0;
			mask = 0x80;
		}
	}
	if (mask !== 0x80) bytes.push(current);
	return Buffer.concat([header, Buffer.from(bytes)]);
}

describe("Sophia NOR resource archive", () => {
	it("lists and extracts stored payloads", async () => {
		const first = Buffer.from("plain payload");
		const second = Buffer.alloc(0x20, 0x5a);
		await expectArchive({
			format: sophiaNorFormat,
			archive: buildNor([
				{ name: "FIRST.BIN", data: first },
				{ name: "DIR\\SECOND.BIN", data: second },
			]),
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "DIR/SECOND.BIN", size: second.length, content: second },
			],
		});
	});

	it("keeps a stored-method payload behind its header", async () => {
		const inner = Buffer.alloc(0x18, 0x37);
		const payload = wrappedPayload(inner, {
			packedSize: inner.length,
			unpackedSize: 0x1234,
			method: 0x1f4,
		});
		await expectArchive({
			format: sophiaNorFormat,
			archive: buildNor([{ name: "STORED.BIN", data: payload }]),
			entries: [{ path: "STORED.BIN", size: inner.length, content: inner }],
		});
	});

	it("unpacks a payload whose method is not a stored one", async () => {
		const unpacked = Buffer.from("ABBA");
		const stream = buildNcmb([0, 1, 1, 0]);
		const payload = wrappedPayload(stream, {
			packedSize: stream.length,
			unpackedSize: unpacked.length,
			method: 0,
		});
		await expectArchive({
			format: sophiaNorFormat,
			archive: buildNor([{ name: "PACKED.BIN", data: payload }]),
			entries: [
				{ path: "PACKED.BIN", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("walks a deeper tree and merges bit runs into bytes", () => {
		// The root splits into an inner node and a leaf; the inner node holds two more leaves.
		const root = 0xfd;
		const inner = 0xfe;
		const words = [
			root,
			7,
			6,
			root,
			inner,
			0x42,
			inner,
			0x41,
			0x43,
			0x41,
			-1,
			-1,
			0x42,
			-1,
			-1,
			0x43,
			-1,
			-1,
		];
		const header = Buffer.alloc(words.length * 4);
		words.forEach((word, index) => {
			header.writeInt32LE(word, index * 4);
		});
		// Bits 0,0 -> 'A'; 0,1 -> 'C'; 1 -> 'B'; then the same three again.
		const stream = Buffer.concat([
			header,
			Buffer.from([0b00011000, 0b11000000]),
		]);
		expect(decompressNcmb(stream)).toEqual(
			Buffer.from([0x41, 0x43, 0x42, 0x41, 0x43, 0x42]),
		);
	});

	it("rejects a foreign marker", async () => {
		const archive = buildNor([{ name: "FILE.BIN", data: Buffer.from("x") }]);
		archive.write("NRCOMBXX", 4, "latin1");
		const source = new BufferByteSource(archive);
		expect(await sophiaNorFormat.detect(source)).toBe(false);
	});

	it("rejects an unsane count", async () => {
		const archive = buildNor([{ name: "FILE.BIN", data: Buffer.from("x") }]);
		archive.writeInt32LE(0, 0);
		const source = new BufferByteSource(archive);
		expect(await sophiaNorFormat.detect(source)).toBe(false);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildNor([{ name: "FILE.BIN", data: Buffer.from("x") }]);
		archive.writeUInt32LE(0x1000, INDEX_START);
		const source = new BufferByteSource(archive);
		expect(await sophiaNorFormat.detect(source)).toBe(false);
	});

	it("rejects a truncated NCMB stream", () => {
		const stream = buildNcmb([0, 1, 1, 0]).subarray(0, 20);
		expect(() => decompressNcmb(stream)).toThrow();
	});

	it("rejects an NCMB node outside the table", () => {
		const words = [0xffff, 1, 1, 0xffff, -1, -1];
		const header = Buffer.alloc(words.length * 4);
		words.forEach((word, index) => {
			header.writeInt32LE(word, index * 4);
		});
		expect(() => decompressNcmb(header)).toThrow();
	});
});
