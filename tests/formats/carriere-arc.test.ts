import { BufferByteSource } from "@garbro-mcp/core";
import { carriereArcFormat, carriereScenarioFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const ARC_SIGNATURE = Buffer.from([0x87, 0x9b, 0x94, 0x8f]);
const ARC_SECOND_WORD = Buffer.from([0x9a, 0x91, 0x9e, 0x86]);
const SCRIPT_SIGNATURE = Buffer.from([0xbe, 0xad, 0xbc, 0xb7]);
const SCRIPT_SECOND_WORD = Buffer.from([0xb6, 0xa9, 0xba, 0xff]);
const NAME_SIZE = 0x104;
const RECORD_SIZE = 0x110;

interface ArcEntry {
	name: string;
	/** Unpacked content. */
	content: Buffer;
	/** Stored bytes; defaults to the content. */
	stored?: Buffer;
}

/** Writes a 0x104-byte name block, which the reference always skips in full. */
function writeName(archive: Buffer, offset: number, name: string): void {
	archive.write(name, offset, "latin1");
}

function buildCarriere(entries: readonly ArcEntry[]): Buffer {
	const indexSize = entries.length * RECORD_SIZE;
	const payloadBase = 0x0c + indexSize;
	const stored = entries.map((entry) => entry.stored ?? entry.content);
	const archive = Buffer.alloc(
		payloadBase + stored.reduce((total, payload) => total + payload.length, 0),
	);
	ARC_SIGNATURE.copy(archive, 0);
	ARC_SECOND_WORD.copy(archive, 4);
	archive.writeInt32LE(entries.length, 8);
	let payloadOffset = payloadBase;
	for (const [id, entry] of entries.entries()) {
		const record = 0x0c + id * RECORD_SIZE;
		writeName(archive, record, entry.name);
		const payload = stored[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(payloadOffset, record + NAME_SIZE);
		archive.writeUInt32LE(entry.content.length, record + NAME_SIZE + 4);
		archive.writeUInt32LE(payload.length, record + NAME_SIZE + 8);
		payload.copy(archive, payloadOffset);
		payloadOffset += payload.length;
	}
	return archive;
}

interface ScriptEntry {
	name: string;
	content: Buffer;
	/** Stream flags: 1 exclusive-ors the payload, 2 runs LZSS over it. */
	flags: number;
}

/** Builds a data stream block: stored size, flags, unpacked size and the payload. */
function buildStream(content: Buffer, flags: number): Buffer {
	let payload = Buffer.from(content);
	if ((flags & 2) !== 0) payload = Buffer.from(literalLzssStream(payload));
	if ((flags & 1) !== 0)
		for (let position = 0; position < payload.length; position += 1)
			payload[position] = (payload[position] ?? 0) ^ 0xff;
	const block = Buffer.alloc(12 + payload.length);
	block.writeUInt32LE(block.length, 0);
	block.writeInt32LE(flags, 4);
	block.writeInt32LE(content.length, 8);
	payload.copy(block, 12);
	return block;
}

/** Builds a `~ARCHIVE` fixture whose index is optionally LZSS-packed. */
function buildCarriereScenario(
	entries: readonly ScriptEntry[],
	indexFlags = 0,
): Buffer {
	const index = Buffer.alloc(4 + entries.length * (NAME_SIZE + 8));
	index.writeInt32LE(entries.length, 0);
	let cursor = 4;
	for (const entry of entries) {
		writeName(index, cursor, entry.name);
		cursor += NAME_SIZE;
		// Placeholders; the offsets need the whole index size, which is known here.
		cursor += 8;
	}
	let indexPayload: Buffer = index;
	if ((indexFlags & 2) !== 0)
		indexPayload = Buffer.from(literalLzssStream(indexPayload));
	const storedIndex = Buffer.from(indexPayload);
	if ((indexFlags & 1) !== 0)
		for (let position = 0; position < storedIndex.length; position += 1)
			storedIndex[position] = (storedIndex[position] ?? 0) ^ 0xff;
	const indexLength = 12 + storedIndex.length;

	const blocks = entries.map((entry) =>
		buildStream(entry.content, entry.flags),
	);
	const payloadBase = 8 + indexLength;
	let payloadOffset = payloadBase;
	for (const [id, block] of blocks.entries()) {
		const record = 4 + id * (NAME_SIZE + 8) + NAME_SIZE;
		index.writeUInt32LE(payloadOffset - payloadBase, record);
		index.writeUInt32LE(block.length, record + 4);
		payloadOffset += block.length;
	}
	// The index has been patched after packing, so rebuild the stored form.
	let finalPayload: Buffer = index;
	if ((indexFlags & 2) !== 0)
		finalPayload = Buffer.from(literalLzssStream(finalPayload));
	if ((indexFlags & 1) !== 0)
		for (let position = 0; position < finalPayload.length; position += 1)
			finalPayload[position] = (finalPayload[position] ?? 0) ^ 0xff;

	const archive = Buffer.alloc(payloadOffset);
	SCRIPT_SIGNATURE.copy(archive, 0);
	SCRIPT_SECOND_WORD.copy(archive, 4);
	archive.writeUInt32LE(indexLength, 8);
	archive.writeInt32LE(indexFlags, 12);
	archive.writeInt32LE(index.length, 16);
	finalPayload.copy(archive, 20);
	let cursorBlock = payloadBase;
	for (const block of blocks) {
		block.copy(archive, cursorBlock);
		cursorBlock += block.length;
	}
	return archive;
}

describe("Carriere resource archive", () => {
	it("lists stored and LZSS entries", async () => {
		const raw = Buffer.from("raw carriere payload");
		const content = Buffer.from("compressed carriere payload, repeatable");
		await expectArchive({
			format: carriereArcFormat,
			archive: buildCarriere([
				{ name: "raw.bin", content: raw },
				{
					name: "packed.bin",
					content,
					stored: Buffer.from(literalLzssStream(content)),
				},
			]),
			entries: [
				{ path: "raw.bin", size: raw.length, content: raw },
				{ path: "packed.bin", size: content.length, content },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("skips name padding and normalizes separators", async () => {
		const content = Buffer.from("nested payload");
		const archive = buildCarriere([{ name: "dir\\file.bin", content }]);
		// Padding behind the terminator is part of the fixed name block and is skipped.
		archive.write("padding", 0x0c + "dir\\file.bin".length + 1, "latin1");
		await expectArchive({
			format: carriereArcFormat,
			archive,
			entries: [{ path: "dir/file.bin", size: content.length, content }],
		});
	});

	it("rejects a wrong second magic word", async () => {
		const archive = buildCarriere([
			{ name: "a.bin", content: Buffer.from("x") },
		]);
		archive.writeUInt32LE(0, 4);
		expect(
			await carriereArcFormat.detect(
				new BufferByteSource(archive),
				"sample.arc",
			),
		).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildCarriere([
			{ name: "a.bin", content: Buffer.from("x") },
		]);
		archive.writeInt32LE(0x40000, 8);
		expect(
			await carriereArcFormat.detect(
				new BufferByteSource(archive),
				"sample.arc",
			),
		).toBe(false);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildCarriere([
			{ name: "a.bin", content: Buffer.from("x") },
		]);
		archive.writeUInt32LE(0x1000, 0x0c + NAME_SIZE);
		expect(
			await carriereArcFormat.detect(
				new BufferByteSource(archive),
				"sample.arc",
			),
		).toBe(false);
	});
});

describe("Carriere scripts archive", () => {
	it("lists entries and decodes their data streams", async () => {
		const raw = Buffer.from("raw script payload");
		const xored = Buffer.from("exclusive-ored script payload");
		const packed = Buffer.from("compressed script payload, repeatable");
		const combined = Buffer.from("exclusive-ored compressed payload");
		await expectArchive({
			format: carriereScenarioFormat,
			archive: buildCarriereScenario([
				{ name: "raw.sc", content: raw, flags: 0 },
				{ name: "xor.sc", content: xored, flags: 1 },
				{ name: "packed.sc", content: packed, flags: 2 },
				{ name: "both.sc", content: combined, flags: 3 },
			]),
			entries: [
				{ path: "raw.sc", size: raw.length, content: raw },
				{ path: "xor.sc", size: xored.length, content: xored },
				{ path: "packed.sc", size: packed.length, content: packed },
				{ path: "both.sc", size: combined.length, content: combined },
			],
			metadata: { entryCount: 4 },
		});
	});

	it("decodes a packed index", async () => {
		const content = Buffer.from("payload behind a packed index");
		await expectArchive({
			format: carriereScenarioFormat,
			archive: buildCarriereScenario(
				[{ name: "only.sc", content, flags: 0 }],
				2,
			),
			entries: [{ path: "only.sc", size: content.length, content }],
		});
	});

	it("rejects a wrong second magic word", async () => {
		const archive = buildCarriereScenario([
			{ name: "a.sc", content: Buffer.from("x"), flags: 0 },
		]);
		archive.writeUInt32LE(0, 4);
		expect(
			await carriereScenarioFormat.detect(
				new BufferByteSource(archive),
				"sample.arc",
			),
		).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildCarriereScenario([
			{ name: "a.sc", content: Buffer.from("x"), flags: 0 },
		]);
		archive.writeInt32LE(0x40000, 20);
		expect(
			await carriereScenarioFormat.detect(
				new BufferByteSource(archive),
				"sample.arc",
			),
		).toBe(false);
	});

	it("rejects an index that reaches past the archive", async () => {
		const archive = buildCarriereScenario([
			{ name: "a.sc", content: Buffer.from("x"), flags: 0 },
		]);
		archive.writeUInt32LE(0x1000, 8);
		expect(
			await carriereScenarioFormat.detect(
				new BufferByteSource(archive),
				"sample.arc",
			),
		).toBe(false);
	});

	it("rejects a data stream that is too short for its header", async () => {
		const archive = buildCarriereScenario([
			{ name: "a.sc", content: Buffer.from("x"), flags: 0 },
		]);
		const payloadBase = 8 + archive.readUInt32LE(8);
		archive.writeUInt32LE(4, payloadBase);
		expect(
			await carriereScenarioFormat.detect(
				new BufferByteSource(archive),
				"sample.arc",
			),
		).toBe(false);
	});
});
