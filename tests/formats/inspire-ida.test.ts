import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { idaFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 8;
const RECORD_HEADER_SIZE = 0x28;
const FLAG_NOT = 0x1;
const FLAG_XOR = 0x2;
const FLAG_ADD = 0x8;
const FLAG_RLE = 0x4;
const FLAG_ZLIB = 0x10;

interface Spec {
	name: string;
	nameMode?: "short" | "long" | "utf16" | "empty";
	plain: Buffer;
	flags: number;
	key: number;
	declaredSize?: number;
	/** Stored bytes for payloads that are rle or zlib encoded. */
	stored?: Buffer;
}

/** Inverts the key chained decrypt, which keys every byte with the plaintext one before it. */
function storeIda(plain: Buffer, flags: number, key: number): Buffer {
	const output = Buffer.alloc(plain.length);
	let current = key & 0xff;
	for (let position = 0; position < plain.length; position += 1) {
		let value = plain[position] ?? 0;
		if ((flags & FLAG_NOT) !== 0) value ^= 0xff;
		if ((flags & FLAG_XOR) !== 0) value ^= current;
		if ((flags & FLAG_ADD) !== 0) value = (value - current) & 0xff;
		output[position] = value;
		current = plain[position] ?? 0;
	}
	return output;
}

function encodeName(name: string, mode: Spec["nameMode"]): Buffer {
	const raw = Buffer.from(name, "latin1");
	switch (mode) {
		case "empty":
			return Buffer.alloc(1);
		case "long": {
			const header = Buffer.alloc(3);
			header.writeUInt8(0xff, 0);
			header.writeUInt16LE(raw.length, 1);
			return Buffer.concat([header, raw]);
		}
		case "utf16": {
			const header = Buffer.alloc(4);
			header.writeUInt8(0xff, 0);
			header.writeUInt16LE(0xfffe, 1);
			header.writeUInt8(name.length, 3);
			return Buffer.concat([header, Buffer.from(name, "utf16le")]);
		}
		default: {
			const header = Buffer.alloc(1);
			header.writeUInt8(raw.length, 0);
			return Buffer.concat([header, raw]);
		}
	}
}

/** Lays out the header, one record per entry and the payloads behind them. */
function buildIda(specs: readonly Spec[]): Buffer {
	const names = specs.map((spec) => encodeName(spec.name, spec.nameMode));
	const stored = specs.map(
		(spec) => spec.stored ?? storeIda(spec.plain, spec.flags, spec.key),
	);
	const lengths = names.map((name) => RECORD_HEADER_SIZE + name.length);
	let offset =
		HEADER_SIZE + lengths.reduce((total, length) => total + length, 0);
	const records: Buffer[] = [];
	for (const [id, spec] of specs.entries()) {
		const header = Buffer.alloc(RECORD_HEADER_SIZE);
		header.writeUInt32LE(lengths[id] ?? 0, 0);
		header.writeUInt32LE(offset, 4);
		header.writeUInt32LE(spec.declaredSize ?? spec.plain.length, 8);
		header.writeUInt32LE(spec.flags >>> 0, 0x10);
		header.writeUInt32LE(spec.key >>> 0, 0x14);
		records.push(header, names[id] ?? Buffer.alloc(0));
		offset += stored[id]?.length ?? 0;
	}
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("XAF", 0, "latin1");
	header.writeInt32LE(0x010000, 4);
	return Buffer.concat([header, ...records, ...stored]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	expect(await idaFormat.detect(new BufferByteSource(file), "sample.ida")).toBe(
		false,
	);
}

describe("Inspire resource archive", () => {
	it("lists raw entries and reads their payloads", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		await expectArchive({
			format: idaFormat,
			sourcePath: "sample.ida",
			archive: buildIda([
				{ name: "first.dat", plain: first, flags: 0, key: 0 },
				{ name: "second.dat", plain: second, flags: 0, key: 0 },
			]),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("decrypts entries whose flags chain a key", async () => {
		const plainXor = Buffer.from("xor payload bytes");
		const plainAdd = Buffer.from("add payload bytes");
		const plainNot = Buffer.from("not payload bytes");
		const plainAll = Buffer.from("every codec at once");
		await expectArchive({
			format: idaFormat,
			sourcePath: "sample.mha",
			archive: buildIda([
				{ name: "xor.dat", plain: plainXor, flags: FLAG_XOR, key: 0x5a },
				{ name: "add.dat", plain: plainAdd, flags: FLAG_ADD, key: 0x13 },
				{ name: "not.dat", plain: plainNot, flags: FLAG_NOT, key: 0 },
				{
					name: "all.dat",
					plain: plainAll,
					flags: FLAG_ADD | FLAG_XOR | FLAG_NOT,
					key: 0xf1,
				},
			]),
			entries: [
				{ path: "xor.dat", size: plainXor.length, content: plainXor },
				{ path: "add.dat", size: plainAdd.length, content: plainAdd },
				{ path: "not.dat", size: plainNot.length, content: plainNot },
				{ path: "all.dat", size: plainAll.length, content: plainAll },
			],
		});
	});

	it("marks encrypted and compressed entries", async () => {
		const plain = Buffer.from("marked payload");
		const file = buildIda([
			{ name: "plain.dat", plain, flags: 0, key: 0 },
			{ name: "crypt.dat", plain, flags: FLAG_XOR, key: 7 },
		]);
		const archive = await idaFormat.open(
			new BufferByteSource(file),
			"sample.ida",
		);
		expect(archive.entries.map((entry) => entry.encrypted)).toEqual([
			false,
			true,
		]);
	});

	it("unpacks rle payloads", async () => {
		const plain = Buffer.from("AAABBBBBBBBBBBBBBB");
		// A repeat run of three, a literal, then a repeat sized by a sixteen bit count.
		const stored = Buffer.concat([
			Buffer.from([plain.length, 0, 0, 0]),
			Buffer.from([0x40 | 3, 0x41]),
			Buffer.from([0x01, 0x42]),
			Buffer.from([0xc1, 14, 0, 0x42]),
		]);
		await expectArchive({
			format: idaFormat,
			sourcePath: "sample.ida",
			archive: buildIda([
				{
					name: "run.dat",
					plain,
					flags: FLAG_RLE,
					key: 0,
					stored,
				},
			]),
			entries: [{ path: "run.dat", size: plain.length, content: plain }],
		});
	});

	it("inflates zlib payloads", async () => {
		const plain = Buffer.from("zlib payload contents");
		const stored = deflateSync(plain);
		await expectArchive({
			format: idaFormat,
			sourcePath: "sample.ida",
			archive: buildIda([
				{
					name: "packed.dat",
					plain,
					flags: FLAG_ZLIB,
					key: 0,
					stored,
				},
			]),
			entries: [{ path: "packed.dat", size: plain.length, content: plain }],
		});
	});

	it("uses adjacent sizes in an archive that holds a packed entry", async () => {
		const raw = Buffer.from("raw payload");
		const plain = Buffer.from("compressed payload contents");
		const stored = deflateSync(plain);
		await expectArchive({
			format: idaFormat,
			sourcePath: "sample.ida",
			archive: buildIda([
				{ name: "raw.dat", plain: raw, flags: 0, key: 0 },
				{
					name: "packed.dat",
					plain,
					flags: FLAG_ZLIB,
					key: 0,
					stored,
				},
			]),
			entries: [
				{ path: "raw.dat", size: raw.length, content: raw },
				{ path: "packed.dat", size: plain.length, content: plain },
			],
		});
	});

	it("reads wide and long names", async () => {
		const plain = Buffer.from("named payload");
		await expectArchive({
			format: idaFormat,
			sourcePath: "sample.ida",
			archive: buildIda([
				{ name: "wide.dat", nameMode: "utf16", plain, flags: 0, key: 0 },
				{ name: "long.dat", nameMode: "long", plain, flags: 0, key: 0 },
			]),
			entries: [
				{ path: "wide.dat", size: plain.length, content: plain },
				{ path: "long.dat", size: plain.length, content: plain },
			],
		});
	});

	it("keeps a nameless entry and normalizes backslashes", async () => {
		const plain = Buffer.from("nameless payload");
		const nested = Buffer.from("nested payload");
		const file = buildIda([
			{ name: "", nameMode: "empty", plain, flags: 0, key: 0 },
			{ name: "dir\\nested.dat", plain: nested, flags: 0, key: 0 },
		]);
		const archive = await idaFormat.open(
			new BufferByteSource(file),
			"sample.ida",
		);
		expect(archive.entries.map((entry) => entry.path)).toEqual([
			"",
			"dir/nested.dat",
		]);
		const second = archive.entries[1];
		if (!second) throw new Error("Missing entry");
		const content = await consumeBuffer(await archive.openEntry(second.id));
		expect(content.equals(nested)).toBe(true);
	});

	it("rejects a truncated rle stream", async () => {
		const plain = Buffer.from("payload");
		const file = buildIda([
			{
				name: "run.dat",
				plain,
				flags: FLAG_RLE,
				key: 0,
				stored: Buffer.from([0xff]),
			},
		]);
		const archive = await idaFormat.open(
			new BufferByteSource(file),
			"sample.ida",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("Missing entry");
		await expect(archive.openEntry(entry.id)).rejects.toBeInstanceOf(
			GarbroError,
		);
	});

	it("rejects a version ahead of the format", async () => {
		const file = buildIda([
			{ name: "first.dat", plain: Buffer.from("x"), flags: 0, key: 0 },
		]);
		file.writeInt32LE(0x020000, 4);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildIda([
			{ name: "first.dat", plain: Buffer.from("x"), flags: 0, key: 0 },
		]);
		file.writeUInt32LE(file.length, HEADER_SIZE + 4);
		await expectDeclined(file);
	});

	it("rejects an entry that starts in front of its record", async () => {
		const file = buildIda([
			{ name: "first.dat", plain: Buffer.from("x"), flags: 0, key: 0 },
			{ name: "second.dat", plain: Buffer.from("y"), flags: 0, key: 0 },
		]);
		file.writeUInt32LE(HEADER_SIZE + 4, HEADER_SIZE + 4);
		await expectDeclined(file);
	});

	it("rejects a record that leaves the file", async () => {
		const file = buildIda([
			{ name: "first.dat", plain: Buffer.from("x"), flags: 0, key: 0 },
		]);
		file.writeUInt32LE(0x1000, HEADER_SIZE);
		await expectDeclined(file);
	});

	it("rejects an empty index", async () => {
		const file = buildIda([
			{ name: "first.dat", plain: Buffer.from("x"), flags: 0, key: 0 },
		]);
		file.writeUInt32LE(0, HEADER_SIZE);
		await expectDeclined(file);
	});

	it("rejects a name that runs past its record", async () => {
		const file = buildIda([
			{ name: "first.dat", plain: Buffer.from("x"), flags: 0, key: 0 },
		]);
		// The name length says twenty bytes while the record only carries the fixed header.
		file.writeUInt8(20, HEADER_SIZE + RECORD_HEADER_SIZE);
		await expectDeclined(file);
	});
});
