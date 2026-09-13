import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { glibGFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const HEADER_SIZE = 0x14;
const KEY_SIZE = 256;
/** An index has to hold the substitution table and an entry count. */
const MIN_INDEX_SIZE = KEY_SIZE + 4;

interface GmlEntry {
	name: string;
	stored: Buffer;
	header?: Buffer;
}

interface BuildOptions {
	key?: Buffer;
	/** Patches the unpacked index after the records were laid out. */
	mutateIndex?: (index: Buffer) => void;
}

/** A substitution table that shifts every byte by one, so a wrong table is easy to spot. */
function buildKey(): Buffer {
	const key = Buffer.alloc(KEY_SIZE);
	for (let index = 0; index < key.length; index += 1)
		key[index] = (index + 1) & 0xff;
	return key;
}

/**
 * Builds a GLib archive. The index is packed with the literal-only LZSS stream, whose size only
 * depends on the index size, so the payload offsets can be filled in before packing.
 */
function buildArchive(
	entries: readonly GmlEntry[],
	options: BuildOptions = {},
): Buffer {
	const key = options.key ?? buildKey();
	const names = entries.map((entry) => encodeCp932(entry.name));
	const recordSizes = names.map((name) => 4 + name.length + 8 + 4);
	const indexSize =
		MIN_INDEX_SIZE + recordSizes.reduce((total, size) => total + size, 0);
	const packedSize = indexSize + Math.ceil(indexSize / 8);
	const dataOffset = HEADER_SIZE + packedSize;

	const records: Buffer[] = [];
	let running = 0;
	for (const [position, entry] of entries.entries()) {
		const name = names[position] ?? Buffer.alloc(0);
		const record = Buffer.alloc(recordSizes[position] ?? 0);
		record.writeInt32LE(name.length, 0);
		name.copy(record, 4);
		// Offsets are relative to the data offset in the header.
		record.writeUInt32LE(running, 4 + name.length);
		record.writeUInt32LE(entry.stored.length, 8 + name.length);
		(entry.header ?? Buffer.alloc(4)).copy(record, 12 + name.length);
		records.push(record);
		running += entry.stored.length;
	}

	const count = Buffer.alloc(4);
	count.writeInt32LE(entries.length, 0);
	const index = Buffer.concat([key, count, ...records]);
	options.mutateIndex?.(index);

	const xored = Buffer.from(literalLzssStream(index));
	for (let position = 0; position < xored.length; position += 1)
		xored[position] = (xored[position] ?? 0) ^ 0xff;

	const header = Buffer.alloc(HEADER_SIZE);
	header.write("GML_ARC\0", 0, "latin1");
	header.writeUInt32LE(dataOffset, 8);
	header.writeUInt32LE(index.length, 0x0c);
	header.writeUInt32LE(xored.length, 0x10);
	return Buffer.concat([
		header,
		xored,
		...entries.map((entry) => entry.stored),
	]);
}

/** Applies the archive's substitution table the way the opener does. */
function substitute(payload: Buffer, header: Buffer, key = buildKey()): Buffer {
	const decoded = Buffer.from(payload);
	for (let index = 4; index < decoded.length; index += 1)
		decoded[index] = key[decoded[index] ?? 0] ?? 0;
	header.copy(decoded, 0);
	return decoded;
}

/** Position of the first record's field, given the length of a name. */
const firstRecord = MIN_INDEX_SIZE;

describe("GLib resource archive", () => {
	it("lists entries and substitutes their payloads", async () => {
		const key = buildKey();
		const firstHeader = Buffer.from([1, 2, 3, 4]);
		const first = Buffer.concat([
			Buffer.alloc(4),
			Buffer.from([0x10, 0x20, 0xff]),
		]);
		const second = Buffer.concat([
			Buffer.alloc(4),
			Buffer.from([0x00, 0x7f, 0x41]),
		]);
		await expectArchive({
			format: glibGFormat,
			archive: buildArchive(
				[
					{ name: "FIRST.BIN", stored: first, header: firstHeader },
					{ name: "DIR\\SECOND.BIN", stored: second },
				],
				{ key },
			),
			sourcePath: "sample.g",
			entries: [
				{
					path: "FIRST.BIN",
					size: first.length,
					content: substitute(first, firstHeader, key),
				},
				{
					path: "DIR/SECOND.BIN",
					size: second.length,
					content: substitute(second, Buffer.alloc(4), key),
				},
			],
		});
	});

	it("trims names that are padded to their recorded length", async () => {
		const stored = Buffer.from([0, 0, 0, 0, 5]);
		await expectArchive({
			format: glibGFormat,
			archive: buildArchive([{ name: "PADDED.BIN\0\0", stored }]),
			sourcePath: "sample.g",
			entries: [
				{
					path: "PADDED.BIN",
					size: stored.length,
					content: substitute(stored, Buffer.alloc(4)),
				},
			],
		});
	});

	it("rejects a payload shorter than its entry header", async () => {
		const archive = buildArchive([
			{ name: "TINY.BIN", stored: Buffer.from([0, 0, 0]) },
		]);
		const source = new BufferByteSource(archive);
		const handle = await glibGFormat.open(source, "sample.g");
		const entry = handle.entries[0];
		if (!entry) throw new Error("Missing entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow();
	});

	it("rejects a foreign signature", async () => {
		const archive = buildArchive([{ name: "A.BIN", stored: Buffer.alloc(4) }]);
		archive.write("XML_", 0, "latin1");
		expect(
			await glibGFormat.detect(new BufferByteSource(archive), "sample.g"),
		).toBe(false);
	});

	it("rejects a file that is not marked ARC", async () => {
		const archive = buildArchive([{ name: "A.BIN", stored: Buffer.alloc(4) }]);
		archive.write("XXX\0", 4, "latin1");
		expect(
			await glibGFormat.detect(new BufferByteSource(archive), "sample.g"),
		).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildArchive([{ name: "A.BIN", stored: Buffer.alloc(4) }], {
			mutateIndex: (index) => index.writeInt32LE(0, KEY_SIZE),
		});
		expect(
			await glibGFormat.detect(new BufferByteSource(archive), "sample.g"),
		).toBe(false);
	});

	it("rejects an index that is too small to hold a key", async () => {
		const archive = buildArchive([{ name: "A.BIN", stored: Buffer.alloc(4) }]);
		archive.writeUInt32LE(MIN_INDEX_SIZE - 1, 0x0c);
		expect(
			await glibGFormat.detect(new BufferByteSource(archive), "sample.g"),
		).toBe(false);
	});

	it("rejects packed data that reaches past the archive", async () => {
		const archive = buildArchive([{ name: "A.BIN", stored: Buffer.alloc(4) }]);
		archive.writeUInt32LE(0x10000, 0x10);
		expect(
			await glibGFormat.detect(new BufferByteSource(archive), "sample.g"),
		).toBe(false);
	});

	it("rejects a name length that reaches past the index", async () => {
		const archive = buildArchive([{ name: "A.BIN", stored: Buffer.alloc(4) }], {
			mutateIndex: (index) => index.writeInt32LE(0x1000, firstRecord),
		});
		expect(
			await glibGFormat.detect(new BufferByteSource(archive), "sample.g"),
		).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const archive = buildArchive([{ name: "A.BIN", stored: Buffer.alloc(4) }], {
			mutateIndex: (index) => index.writeUInt32LE(0x1000, firstRecord + 4 + 5),
		});
		expect(
			await glibGFormat.detect(new BufferByteSource(archive), "sample.g"),
		).toBe(false);
	});
});
