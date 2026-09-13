import { BufferByteSource } from "@garbro-mcp/core";
import { leafLacFormat, leafLacPakFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const LAC_STRIDE = 0x78;
const LAC_NAME_SIZE = 0x3e;
const PAK_STRIDE = 0x28;
const PAK_NAME_SIZE = 0x20;

interface LacEntry {
	name: string;
	data: Buffer;
	/** Unpacked size; defaults to the stored length. */
	unpackedSize?: number;
	compressed?: boolean;
}

/** Builds a LAC archive: 0x3E-byte names, a flag byte, sizes and a 64-bit offset per record. */
function buildLac(entries: readonly LacEntry[]): Buffer {
	const tableSize = entries.length * LAC_STRIDE;
	const payloadBase = 8 + tableSize;
	const table = Buffer.alloc(tableSize);
	const payloads: Buffer[] = [];
	let payloadOffset = payloadBase;
	for (const [id, entry] of entries.entries()) {
		const record = id * LAC_STRIDE;
		table.write(entry.name, record, "latin1");
		table[record + LAC_NAME_SIZE] = entry.compressed ? 1 : 0;
		table.writeUInt32LE(entry.data.length, record + 0x54);
		table.writeUInt32LE(entry.unpackedSize ?? entry.data.length, record + 0x58);
		table.writeBigInt64LE(BigInt(payloadOffset), record + 0x60);
		payloads.push(entry.data);
		payloadOffset += entry.data.length;
	}
	const header = Buffer.alloc(8);
	header.write("LAC\0", 0, "latin1");
	header.writeInt32LE(entries.length, 4);
	return Buffer.concat([header, table, ...payloads]);
}

/** Masks a PAK name field the way the reference does: bytes XORed with 0xFF up to the terminator. */
function maskName(name: string): Buffer {
	const field = Buffer.alloc(PAK_NAME_SIZE);
	field.write(name, 0, "latin1");
	for (let index = 0; index < name.length; index += 1) {
		field[index] = (field[index] ?? 0) ^ 0xff;
	}
	field[name.length] = 0xff;
	return field;
}

interface PakEntry {
	name: string;
	data: Buffer;
	packed?: boolean;
	/** Words written in front of the stored stream, as the compression header. */
	header?: number[];
}

/** Builds a PAK archive: masked names, a flag byte at 0x1F and size/offset pairs. */
function buildPak(entries: readonly PakEntry[]): Buffer {
	const tableSize = entries.length * PAK_STRIDE;
	const payloadBase = 8 + tableSize;
	const table = Buffer.alloc(tableSize);
	const payloads: Buffer[] = [];
	let payloadOffset = payloadBase;
	for (const [id, entry] of entries.entries()) {
		const record = id * PAK_STRIDE;
		maskName(entry.name).copy(table, record);
		table[record + 0x1f] = entry.packed ? 1 : 0;
		const header = Buffer.from(
			(entry.header ?? []).flatMap((word) => {
				const buffer = Buffer.alloc(4);
				buffer.writeUInt32LE(word >>> 0, 0);
				return [...buffer];
			}),
		);
		const payload = Buffer.concat([header, entry.data]);
		table.writeUInt32LE(payload.length, record + 0x20);
		table.writeUInt32LE(payloadOffset, record + 0x24);
		payloads.push(payload);
		payloadOffset += payload.length;
	}
	const header = Buffer.alloc(8);
	header.write("LAC\0", 0, "latin1");
	header.writeInt32LE(entries.length, 4);
	return Buffer.concat([header, table, ...payloads]);
}

describe("Leaf LAC resource archive", () => {
	it("lists and extracts stored entries", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: leafLacFormat,
			archive: buildLac([
				{ name: "FIRST.BIN", data: first },
				{ name: "DIR\\SECOND.BIN", data: second },
			]),
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "DIR/SECOND.BIN", size: second.length, content: second },
			],
		});
	});

	it("unpacks a compressed entry with a space-filled frame", async () => {
		const unpacked = Buffer.from("space filled frame");
		const stored = literalLzssStream(unpacked);
		await expectArchive({
			format: leafLacFormat,
			archive: buildLac([
				{
					name: "PACKED.BIN",
					data: stored,
					unpackedSize: unpacked.length,
					compressed: true,
				},
			]),
			entries: [
				{ path: "PACKED.BIN", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("rejects a LAC record with an empty name", async () => {
		const archive = buildLac([{ name: "FILE.BIN", data: Buffer.from("x") }]);
		archive.fill(0, 8, 8 + LAC_NAME_SIZE);
		const source = new BufferByteSource(archive);
		expect(await leafLacFormat.detect(source)).toBe(false);
	});

	it("rejects a LAC payload outside the archive", async () => {
		const archive = buildLac([{ name: "FILE.BIN", data: Buffer.from("x") }]);
		archive.writeBigInt64LE(0x1000n, 8 + 0x60);
		const source = new BufferByteSource(archive);
		expect(await leafLacFormat.detect(source)).toBe(false);
	});

	it("lists and extracts PAK entries with masked names", async () => {
		const plain = Buffer.from("plain payload");
		await expectArchive({
			format: leafLacPakFormat,
			sourcePath: "sample.pak",
			archive: buildPak([{ name: "PLAIN.BIN", data: plain }]),
			entries: [{ path: "PLAIN.BIN", size: plain.length, content: plain }],
		});
	});

	it("resolves the PAK compression header while listing", async () => {
		const unpacked = Buffer.from("packed payload");
		const stored = literalLzssStream(unpacked);
		const archive = buildPak([
			{
				name: "PACKED.BIN",
				data: stored,
				packed: true,
				header: [unpacked.length],
			},
		]);
		const source = new BufferByteSource(archive);
		expect(await leafLacPakFormat.detect(source, "sample.pak")).toBe(true);
		const handle = await leafLacPakFormat.open(source, "sample.pak");
		expect(handle.entries).toEqual([
			{
				id: "0",
				path: "PACKED.BIN",
				size: BigInt(unpacked.length),
				packedSize: BigInt(stored.length),
				compressed: true,
				encrypted: false,
				offset: BigInt(8 + PAK_STRIDE + 4),
			},
		]);
		expect(handle.metadata).toEqual({ entryCount: 1 });
	});

	it("skips a second header word when the first matches the entry size", async () => {
		const unpacked = Buffer.from("double header");
		const stored = literalLzssStream(unpacked);
		// The first word equals the entry size, so the reference skips it before reading the unpacked
		// size from the second word.
		const firstWord = 8 + stored.length;
		const archive = buildPak([
			{
				name: "PACKED.BIN",
				data: stored,
				packed: true,
				header: [firstWord, unpacked.length],
			},
		]);
		const source = new BufferByteSource(archive);
		const handle = await leafLacPakFormat.open(source, "sample.pak");
		const entry = handle.entries[0];
		if (!entry) throw new Error("missing entry");
		expect(entry.size).toBe(BigInt(unpacked.length));
		expect(entry.packedSize).toBe(BigInt(stored.length));
		expect(await consumeBuffer(await handle.openEntry(entry.id))).toEqual(
			unpacked,
		);
	});

	it("treats a PAK entry of four bytes or less as stored", async () => {
		const data = Buffer.from("abcd");
		await expectArchive({
			format: leafLacPakFormat,
			sourcePath: "sample.pak",
			archive: buildPak([{ name: "TINY.BIN", data, packed: true }]),
			entries: [{ path: "TINY.BIN", size: data.length, content: data }],
		});
	});

	it("rejects a PAK name field that starts masked out", async () => {
		const archive = buildPak([{ name: "FILE.BIN", data: Buffer.from("x") }]);
		archive[8] = 0;
		const source = new BufferByteSource(archive);
		expect(await leafLacPakFormat.detect(source, "sample.pak")).toBe(false);
	});

	it("rejects a PAK payload outside the archive", async () => {
		const archive = buildPak([{ name: "FILE.BIN", data: Buffer.from("x") }]);
		archive.writeUInt32LE(0x1000, 8 + 0x24);
		const source = new BufferByteSource(archive);
		expect(await leafLacPakFormat.detect(source, "sample.pak")).toBe(false);
	});
});
