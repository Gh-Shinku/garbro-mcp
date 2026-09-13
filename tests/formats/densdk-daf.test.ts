import { BufferByteSource } from "@garbro-mcp/core";
import { densdkDaf1Format, densdkDaf2Format } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

interface Entry {
	name: string;
	content: Buffer;
	/** The stored payload; defaults to the content. */
	stored?: Buffer;
	/** Whether the record marks the payload as packed. */
	packed?: boolean;
}

function storedOf(entry: Entry): Buffer {
	return entry.stored ?? entry.content;
}

const DAF1_INDEX_OFFSET = 0x14;
const DAF1_RECORD_HEADER_SIZE = 0x18;

/** Builds a `DAF1` archive: records start at 0x14 and the payload area at 0x10's value. */
function buildDaf1(entries: readonly Entry[]): Buffer {
	const indexSize = entries.reduce(
		(total, entry) => total + DAF1_RECORD_HEADER_SIZE + entry.name.length,
		0,
	);
	const dataOffset = DAF1_INDEX_OFFSET + indexSize;
	const stored = entries.map(storedOf);
	const offsets: number[] = [];
	let running = dataOffset;
	for (const payload of stored) {
		offsets.push(running);
		running += payload.length;
	}

	const archive = Buffer.alloc(running);
	archive.write("DAF1", 0, "latin1");
	archive.writeUInt32LE(DAF1_INDEX_OFFSET, 4);
	archive.writeInt32LE(entries.length, 8);
	archive.writeUInt32LE(dataOffset, 0x10);
	let cursor = DAF1_INDEX_OFFSET;
	for (const [id, entry] of entries.entries()) {
		const entrySize = DAF1_RECORD_HEADER_SIZE + entry.name.length;
		archive.writeUInt32LE(entrySize, cursor);
		archive.writeUInt32LE(offsets[id] ?? 0, cursor + 4);
		archive.writeUInt32LE(storedOf(entry).length, cursor + 8);
		archive.writeUInt32LE(entry.content.length, cursor + 0x0c);
		archive.writeInt32LE(entry.packed ? 1 : 0, cursor + 0x14);
		archive.write(entry.name, cursor + DAF1_RECORD_HEADER_SIZE, "latin1");
		cursor += entrySize;
	}
	let payloadOffset = dataOffset;
	for (const payload of stored) {
		payload.copy(archive, payloadOffset);
		payloadOffset += payload.length;
	}
	return archive;
}

const DAF2_INDEX_START = 0x30;
const DAF2_NAME_OFFSET = 0x34;
const DAF2_PACKED_FIELD_OFFSET = 0x30;

/** Writes a 32-bit key into the four header bytes the reference folds it out of. */
function writeDaf2Key(archive: Buffer, key: number): void {
	archive.writeUInt8((key >>> 24) & 0xff, 0x20);
	archive.writeUInt8((key >>> 16) & 0xff, 0x25);
	archive.writeUInt8((key >>> 8) & 0xff, 0x2a);
	archive.writeUInt8(key & 0xff, 0x2f);
}

const DAF2_KEY = 0x12345678;

/** Builds a `DAF2` archive, whose header words are exclusive-ored with the key. */
function buildDaf2(entries: readonly Entry[], packedIndex = false): Buffer {
	// Payload offsets are relative to the payload base, so the index does not depend on where the
	// payload area starts and can be packed as it is.
	// A record covers its name at 0x34, so its size is the name offset plus the name.
	const indexSize = entries.reduce(
		(total, entry) => total + DAF2_NAME_OFFSET + entry.name.length,
		0,
	);
	const index = Buffer.alloc(indexSize);
	const relativeOffsets: number[] = [];
	let cursor = 0;
	let running = 0;
	for (const entry of entries) {
		relativeOffsets.push(running);
		running += storedOf(entry).length;
		const entrySize = DAF2_NAME_OFFSET + entry.name.length;
		index.writeInt32LE((entrySize ^ DAF2_KEY) | 0, cursor);
		index.writeUInt32LE(
			(relativeOffsets[relativeOffsets.length - 1] ?? 0) ^ DAF2_KEY,
			cursor + 4,
		);
		index.writeUInt32LE((storedOf(entry).length ^ DAF2_KEY) >>> 0, cursor + 8);
		index.writeUInt32LE((entry.content.length ^ DAF2_KEY) >>> 0, cursor + 0x0c);
		index.writeInt32LE(entry.packed ? 1 : 0, cursor + DAF2_PACKED_FIELD_OFFSET);
		index.write(entry.name, cursor + DAF2_NAME_OFFSET, "latin1");
		cursor += entrySize;
	}

	const packedIndexBytes = packedIndex ? deflateSync(index) : Buffer.alloc(0);
	const baseOffset = packedIndex
		? DAF2_INDEX_START + packedIndexBytes.length
		: DAF2_INDEX_START + index.length;
	const stored = entries.map(storedOf);
	const indexBlock = packedIndex ? packedIndexBytes : index;
	const archive = Buffer.alloc(
		baseOffset + stored.reduce((total, payload) => total + payload.length, 0),
	);
	archive.write("DAF2", 0, "latin1");
	archive.writeInt32LE((entries.length ^ DAF2_KEY) | 0, 8);
	archive.writeUInt32LE((indexBlock.length ^ DAF2_KEY) >>> 0, 0x10);
	archive.writeUInt32LE((index.length ^ DAF2_KEY) >>> 0, 0x14);
	archive.writeInt32LE(packedIndex ? 1 : 0, 0x18);
	archive.writeUInt32LE((baseOffset ^ DAF2_KEY) >>> 0, 0x1c);
	writeDaf2Key(archive, DAF2_KEY);
	indexBlock.copy(archive, DAF2_INDEX_START);
	let payloadOffset = baseOffset;
	for (const payload of stored) {
		payload.copy(archive, payloadOffset);
		payloadOffset += payload.length;
	}
	return archive;
}

describe("DenSDK resource archive", () => {
	it("lists stored and zlib entries behind a DAF1 index", async () => {
		const raw = Buffer.from("stored densdk payload");
		const content = Buffer.from("compressed densdk payload, repeatable");
		await expectArchive({
			format: densdkDaf1Format,
			archive: buildDaf1([
				{ name: "raw.bin", content: raw },
				{
					name: "packed.bin",
					content,
					stored: deflateSync(content),
					packed: true,
				},
			]),
			entries: [
				{ path: "raw.bin", size: raw.length, content: raw },
				{ path: "packed.bin", size: content.length, content },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("normalizes DAF1 separators", async () => {
		const content = Buffer.from("nested payload");
		await expectArchive({
			format: densdkDaf1Format,
			archive: buildDaf1([{ name: "dir\\file.bin", content }]),
			entries: [{ path: "dir/file.bin", size: content.length, content }],
		});
	});

	it("rejects a DAF1 record that is too small", async () => {
		const archive = buildDaf1([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x10, DAF1_INDEX_OFFSET);
		expect(
			await densdkDaf1Format.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});

	it("rejects a DAF1 payload area that precedes the index", async () => {
		const archive = buildDaf1([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x10, 0x10);
		expect(
			await densdkDaf1Format.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});

	it("lists stored and zlib entries behind a plain DAF2 index", async () => {
		const raw = Buffer.from("stored daf2 payload");
		const content = Buffer.from("compressed daf2 payload, repeatable");
		await expectArchive({
			format: densdkDaf2Format,
			archive: buildDaf2([
				{ name: "raw.bin", content: raw },
				{
					name: "packed.bin",
					content,
					stored: deflateSync(content),
					packed: true,
				},
			]),
			entries: [
				{ path: "raw.bin", size: raw.length, content: raw },
				{ path: "packed.bin", size: content.length, content },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads a zlib-packed DAF2 index", async () => {
		const content = Buffer.from("payload behind a packed index");
		await expectArchive({
			format: densdkDaf2Format,
			archive: buildDaf2([{ name: "file.bin", content }], true),
			entries: [{ path: "file.bin", size: content.length, content }],
		});
	});

	it("normalizes DAF2 separators", async () => {
		const content = Buffer.from("nested payload");
		await expectArchive({
			format: densdkDaf2Format,
			archive: buildDaf2([{ name: "dir\\file.bin", content }]),
			entries: [{ path: "dir/file.bin", size: content.length, content }],
		});
	});

	it("rejects an insane DAF2 entry count", async () => {
		const archive = buildDaf2([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeInt32LE((0x40000 ^ DAF2_KEY) | 0, 8);
		expect(
			await densdkDaf2Format.detect(
				new BufferByteSource(archive),
				"sample.daf",
			),
		).toBe(false);
	});

	it("rejects a DAF2 record that is too small", async () => {
		const archive = buildDaf2([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeInt32LE((0x20 ^ DAF2_KEY) | 0, DAF2_INDEX_START);
		expect(
			await densdkDaf2Format.detect(
				new BufferByteSource(archive),
				"sample.daf",
			),
		).toBe(false);
	});

	it("rejects a DAF2 payload outside the archive", async () => {
		const archive = buildDaf2([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt32LE((0x10000 ^ DAF2_KEY) >>> 0, 0x1c);
		expect(
			await densdkDaf2Format.detect(
				new BufferByteSource(archive),
				"sample.daf",
			),
		).toBe(false);
	});

	it("rejects foreign signatures", async () => {
		const daf1 = buildDaf1([{ name: "a.bin", content: Buffer.from("x") }]);
		daf1.write("DAF3", 0, "latin1");
		expect(
			await densdkDaf1Format.detect(new BufferByteSource(daf1), "sample.dat"),
		).toBe(false);
		const daf2 = buildDaf2([{ name: "a.bin", content: Buffer.from("x") }]);
		daf2.write("DAF3", 0, "latin1");
		expect(
			await densdkDaf2Format.detect(new BufferByteSource(daf2), "sample.daf"),
		).toBe(false);
	});
});
