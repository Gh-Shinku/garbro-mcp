import { BufferByteSource } from "@garbro-mcp/core";
import { fpkFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 4;
const PACKED_SIGNATURE = 0x32434c5a;

interface Spec {
	name: string;
	payload: Buffer;
}

/** Lays out the plain index: a count, one record per entry and the payloads behind them. */
function buildFpk(specs: readonly Spec[], nameSize = 0x10): Buffer {
	const recordSize = 8 + nameSize;
	const indexSize = recordSize * specs.length;
	const records = Buffer.alloc(indexSize);
	let cursor = INDEX_OFFSET + indexSize;
	const payloads: Buffer[] = [];
	for (const [id, spec] of specs.entries()) {
		const position = id * recordSize;
		records.writeUInt32LE(cursor, position);
		records.writeUInt32LE(spec.payload.length, position + 4);
		records.write(spec.name, position + 8, "latin1");
		cursor += spec.payload.length;
		payloads.push(spec.payload);
	}
	const header = Buffer.alloc(INDEX_OFFSET);
	header.writeInt32LE(specs.length, 0);
	return Buffer.concat([header, records, ...payloads]);
}

/** Lays out the encrypted index, which lives at the end of the file with its key behind it. */
function buildEncryptedFpk(specs: readonly Spec[], key: number): Buffer {
	const nameSize = 0x18;
	const recordSize = 0xc + nameSize;
	const index = Buffer.alloc(recordSize * specs.length);
	let cursor = INDEX_OFFSET + index.length;
	const payloads: Buffer[] = [];
	for (const [id, spec] of specs.entries()) {
		const position = id * recordSize;
		index.writeUInt32LE(cursor, position);
		index.writeUInt32LE(spec.payload.length, position + 4);
		index.write(spec.name, position + 0xc, "latin1");
		cursor += spec.payload.length;
		payloads.push(spec.payload);
	}
	for (let position = 0; position < index.length; position += 1)
		index[position] =
			(index[position] ?? 0) ^ ((key >> (8 * (position & 3))) & 0xff);
	const trailer = Buffer.alloc(8);
	trailer.writeUInt32LE(key, 0);
	trailer.writeUInt32LE(INDEX_OFFSET, 4);
	const header = Buffer.alloc(INDEX_OFFSET);
	// The sign bit marks an encrypted index, so the count keeps its low bits.
	header.writeInt32LE(0x80000000 | specs.length | 0, 0);
	return Buffer.concat([header, index, ...payloads, trailer]);
}

type Op = { literal: number } | { offset: number; count: number };

/** Encodes a `ZLC2` stream from literal bytes and back references. */
function zlc2(outputLength: number, ops: readonly Op[]): Buffer {
	const parts: Buffer[] = [];
	let decisions: number[] = [];
	let bytes: number[] = [];
	const flush = (): void => {
		if (decisions.length === 0) return;
		let control = 0;
		for (const [index, bit] of decisions.entries())
			if (bit !== 0) control |= 0x80 >> index;
		parts.push(Buffer.from([control, ...bytes]));
		decisions = [];
		bytes = [];
	};
	for (const op of ops) {
		if ("literal" in op) {
			decisions.push(0);
			bytes.push(op.literal);
		} else {
			decisions.push(1);
			bytes.push(op.offset & 0xff, ((op.offset >> 4) & 0xf0) | (op.count - 3));
		}
		if (decisions.length === 8) flush();
	}
	flush();
	const header = Buffer.alloc(8);
	header.writeUInt32LE(PACKED_SIGNATURE, 0);
	header.writeUInt32LE(outputLength, 4);
	return Buffer.concat([header, ...parts]);
}

function literals(plain: Buffer): Buffer {
	return zlc2(
		plain.length,
		[...plain].map((byte) => ({ literal: byte })),
	);
}

async function expectDeclined(file: Buffer): Promise<void> {
	expect(await fpkFormat.detect(new BufferByteSource(file), "sample.fpk")).toBe(
		false,
	);
}

describe("Interheart/Candy Soft resource archive", () => {
	it("lists a plain index and reads stored payloads", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		await expectArchive({
			format: fpkFormat,
			sourcePath: "sample.fpk",
			archive: buildFpk([
				{ name: "first.dat", payload: first },
				{ name: "second.dat", payload: second },
			]),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("retries the index with a twenty four byte name field", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: fpkFormat,
			sourcePath: "sample.fpk",
			archive: buildFpk(
				[
					{ name: "first_entry_name.dat", payload: first },
					{ name: "second_entry_name.dat", payload: second },
				],
				0x18,
			),
			entries: [
				{ path: "first_entry_name.dat", size: first.length, content: first },
				{ path: "second_entry_name.dat", size: second.length, content: second },
			],
		});
	});

	it("unpacks a zlc2 payload", async () => {
		const plain = Buffer.from("payload inside a zlc2 stream");
		await expectArchive({
			format: fpkFormat,
			sourcePath: "sample.fpk",
			archive: buildFpk([
				{ name: "packed.dat", payload: literals(plain) },
				{ name: "plain.dat", payload: Buffer.from("stored") },
			]),
			entries: [
				{ path: "packed.dat", size: literals(plain).length, content: plain },
				{ path: "plain.dat", size: 6, content: Buffer.from("stored") },
			],
		});
	});

	it("copies overlapping bytes in a zlc2 payload", async () => {
		const head = Buffer.from("ABCDEFGH");
		const stream = zlc2(16, [
			...[0, 1, 2, 3, 4, 5, 6, 7].map((index) => ({
				literal: head[index] ?? 0,
			})),
			{ offset: 8, count: 8 },
		]);
		const expected = Buffer.concat([head, head]);
		await expectArchive({
			format: fpkFormat,
			sourcePath: "sample.fpk",
			archive: buildFpk([{ name: "copy.dat", payload: stream }]),
			entries: [{ path: "copy.dat", size: stream.length, content: expected }],
		});
	});

	it("unwraps nested zlc2 streams", async () => {
		const plain = Buffer.from("nested payload contents");
		const inner = literals(plain);
		const outer = literals(inner);
		await expectArchive({
			format: fpkFormat,
			sourcePath: "sample.fpk",
			archive: buildFpk([{ name: "nested.dat", payload: outer }]),
			entries: [{ path: "nested.dat", size: outer.length, content: plain }],
		});
	});

	it("reads an encrypted index", async () => {
		const first = Buffer.from("encrypted first payload");
		const second = Buffer.from("encrypted second payload");
		await expectArchive({
			format: fpkFormat,
			sourcePath: "sample.fpk",
			archive: buildEncryptedFpk(
				[
					{ name: "first.dat", payload: first },
					{ name: "second.dat", payload: second },
				],
				0x12345678,
			),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
		});
	});

	it("rejects an archive without entries", async () => {
		const file = buildFpk([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeInt32LE(0, 0);
		await expectDeclined(file);
	});

	it("rejects a blank name", async () => {
		const file = buildFpk([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.fill(0, INDEX_OFFSET + 8, INDEX_OFFSET + 0x10);
		await expectDeclined(file);
	});

	it("rejects an entry in front of the payload area", async () => {
		const file = buildFpk([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeUInt32LE(INDEX_OFFSET, INDEX_OFFSET);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildFpk([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeUInt32LE(file.length, INDEX_OFFSET);
		await expectDeclined(file);
	});

	it("rejects a truncated index", async () => {
		const file = buildFpk([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeInt32LE(3, 0);
		await expectDeclined(file);
	});

	it("rejects an encrypted index offset outside the file", async () => {
		const file = buildEncryptedFpk(
			[{ name: "first.dat", payload: Buffer.from("x") }],
			0x0f0f0f0f,
		);
		file.writeUInt32LE(file.length, file.length - 4);
		await expectDeclined(file);
	});
});
