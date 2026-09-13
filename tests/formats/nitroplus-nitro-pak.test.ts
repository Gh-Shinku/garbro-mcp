import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { nitroplusNitroPakFormat, nitroPakKey } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0x114;
const RECORD_FIELDS = 5;

function rotateRight(key: number): number {
	return ((key >>> 8) | (key << 24)) >>> 0;
}

/** Encrypts the leading bytes of a version three entry, as the reference reader undoes them. */
function encryptPrefix(payload: Buffer, key: number): Buffer {
	const output = Buffer.from(payload);
	let rotated = key;
	for (let i = 0; i < Math.min(output.length, 0x10); i += 1) {
		output[i] = (output[i] ?? 0) ^ (rotated & 0xff);
		rotated = rotateRight(rotated);
	}
	return output;
}

interface V2Source {
	name: string;
	payload: Buffer;
	stored: Buffer;
	unpackedSize: number;
	packed: boolean;
}

function buildV2(
	sources: readonly V2Source[],
	offsets?: readonly number[],
): Buffer {
	const records: Buffer[] = [];
	const payloads: Buffer[] = [];
	let cursor = 0;
	for (const [index, source] of sources.entries()) {
		const name = Buffer.from(encodeCp932(source.name));
		const record = Buffer.alloc(4 + name.length + RECORD_FIELDS * 4);
		record.writeInt32LE(name.length, 0);
		name.copy(record, 4);
		record.writeUInt32LE(offsets?.[index] ?? cursor, 4 + name.length);
		record.writeUInt32LE(source.unpackedSize, 8 + name.length);
		record.writeUInt32LE(source.stored.length, 12 + name.length);
		record.writeInt32LE(source.packed ? 1 : 0, 16 + name.length);
		record.writeUInt32LE(source.stored.length, 20 + name.length);
		records.push(record);
		payloads.push(source.stored);
		cursor += source.stored.length;
	}
	const table = Buffer.concat(records);
	const packedTable = deflateSync(table);
	const header = Buffer.alloc(INDEX_OFFSET);
	header.writeUInt32LE(2, 0);
	header.writeInt32LE(sources.length, 4);
	header.writeInt32LE(table.length, 8);
	header.writeUInt32LE(packedTable.length, 0xc);
	return Buffer.concat([header, packedTable, ...payloads]);
}

interface V3Source {
	name: string;
	payload: Buffer;
	stored: Buffer;
	unpackedSize: number;
	packed: boolean;
}

function buildV3(gameName: string, sources: readonly V3Source[]): Buffer {
	const records: Buffer[] = [];
	const payloads: Buffer[] = [];
	let cursor = 0;
	for (const source of sources) {
		const name = Buffer.from(encodeCp932(source.name));
		const key = nitroPakKey(name, name.length);
		const record = Buffer.alloc(4 + name.length + RECORD_FIELDS * 4);
		record.writeInt32LE(name.length, 0);
		name.copy(record, 4);
		const fields = [
			cursor,
			source.unpackedSize,
			0,
			source.packed ? 1 : 0,
			source.stored.length,
		];
		for (const [index, field] of fields.entries())
			record.writeUInt32LE((field ^ key) >>> 0, 4 + name.length + index * 4);
		records.push(record);
		payloads.push(source.stored);
		cursor += source.stored.length;
	}
	const table = Buffer.concat(records);
	const packedTable = deflateSync(table);
	const header = Buffer.alloc(INDEX_OFFSET);
	header.writeUInt32LE(3, 0);
	Buffer.from(gameName, "latin1").copy(header, 4);
	header.writeUInt32LE(0x64, 0x104);
	const gameKey = nitroPakKey(Buffer.from(gameName, "latin1"), gameName.length);
	header.writeUInt32LE((table.length ^ gameKey) >>> 0, 0x108);
	header.writeUInt32LE((sources.length ^ gameKey) >>> 0, 0x10c);
	header.writeUInt32LE((packedTable.length ^ 0x64) >>> 0, 0x110);
	return Buffer.concat([header, packedTable, ...payloads]);
}

async function expectDeclined(
	file: Buffer,
	sourcePath = "sample.pak",
): Promise<void> {
	const source = new BufferByteSource(file);
	expect(await nitroplusNitroPakFormat.detect(source, sourcePath)).toBe(false);
}

describe("Nitro+ resource archive", () => {
	it("derives the record key from a name in signed arithmetic", () => {
		expect(nitroPakKey(Buffer.from("A"), 1)).toBe(65);
		expect(nitroPakKey(Buffer.from("AA"), 2)).toBe(65 * 0x89 + 65);
		expect(nitroPakKey(Buffer.from([0x80]), 1)).toBe(0xffffff80);
	});

	it("reads a version two index with packed and plain entries", async () => {
		const plain = Buffer.from("plain payload");
		const packed = Buffer.from("packed payload");
		const file = buildV2([
			{
				name: "plain.txt",
				payload: plain,
				stored: plain,
				unpackedSize: plain.length,
				packed: false,
			},
			{
				name: "packed.txt",
				payload: packed,
				stored: deflateSync(packed),
				unpackedSize: packed.length,
				packed: true,
			},
		]);
		await expectArchive({
			format: nitroplusNitroPakFormat,
			sourcePath: "sample.pak",
			archive: file,
			entries: [
				{ path: "plain.txt", size: plain.length, content: plain },
				{ path: "packed.txt", size: packed.length, content: packed },
			],
			metadata: { version: 2, entryCount: 2 },
		});
	});

	it("marks version two packed entries as compressed", async () => {
		const packed = Buffer.from("packed payload");
		const stored = deflateSync(packed);
		const archive = await nitroplusNitroPakFormat.open(
			new BufferByteSource(
				buildV2([
					{
						name: "packed.txt",
						payload: packed,
						stored,
						unpackedSize: packed.length,
						packed: true,
					},
				]),
			),
			"sample.pak",
		);
		expect(archive.entries[0]).toMatchObject({
			compressed: true,
			size: BigInt(packed.length),
			packedSize: BigInt(stored.length),
		});
	});

	it("reads a version three index with an encrypted plain entry", async () => {
		const game = "NITROPLUS";
		// Unpacked entry payloads are encrypted with a key derived from the entry name.
		const key = nitroPakKey(Buffer.from(encodeCp932("plain.dat")), 9);
		const plain = Buffer.from("0123456789abcdefghij");
		const packed = Buffer.from("packed version three payload");
		const file = buildV3(game, [
			{
				name: "plain.dat",
				payload: plain,
				stored: encryptPrefix(plain, key),
				unpackedSize: plain.length,
				packed: false,
			},
			{
				name: "packed.dat",
				payload: packed,
				stored: deflateSync(packed),
				unpackedSize: packed.length,
				packed: true,
			},
		]);
		await expectArchive({
			format: nitroplusNitroPakFormat,
			sourcePath: "sample.pak",
			archive: file,
			entries: [
				{ path: "plain.dat", size: plain.length, content: plain },
				{ path: "packed.dat", size: packed.length, content: packed },
			],
			metadata: { version: 3, entryCount: 2 },
		});
	});

	it("marks version three plain entries as encrypted", async () => {
		const game = "NITROPLUS";
		// Unpacked entry payloads are encrypted with a key derived from the entry name.
		const key = nitroPakKey(Buffer.from(encodeCp932("plain.dat")), 9);
		const plain = Buffer.from("secret");
		const archive = await nitroplusNitroPakFormat.open(
			new BufferByteSource(
				buildV3(game, [
					{
						name: "plain.dat",
						payload: plain,
						stored: encryptPrefix(plain, key),
						unpackedSize: plain.length,
						packed: false,
					},
				]),
			),
			"sample.pak",
		);
		expect(archive.entries[0]).toMatchObject({
			compressed: false,
			encrypted: true,
			size: BigInt(plain.length),
		});
	});

	it("rejects a version three header without the expected size mask", async () => {
		const file = buildV3("NITROPLUS", []);
		file.writeUInt32LE(0x65, 0x104);
		await expectDeclined(file);
	});

	it("rejects a version three game name that leaves the printable range", async () => {
		const file = buildV3("NITROPLUS", []);
		file.writeUInt8(0x80, 4);
		await expectDeclined(file);
	});

	it("rejects a version three game name that is too long", async () => {
		await expectDeclined(buildV3("NITROPLUS-ENGINE-X", []));
	});

	it("rejects a version two index without entries", async () => {
		await expectDeclined(buildV2([]));
	});

	it("rejects a version two entry that leaves the file", async () => {
		const plain = Buffer.from("plain payload");
		await expectDeclined(
			buildV2(
				[
					{
						name: "plain.txt",
						payload: plain,
						stored: plain,
						unpackedSize: plain.length,
						packed: false,
					},
				],
				[0x10000],
			),
		);
	});

	it("rejects a version two index with a broken record", async () => {
		// An index whose first record announces a zero length name.
		const table = deflateSync(Buffer.alloc(4 + 9 + RECORD_FIELDS * 4, 0));
		const header = Buffer.alloc(INDEX_OFFSET);
		header.writeUInt32LE(2, 0);
		header.writeInt32LE(1, 4);
		header.writeUInt32LE(table.length, 0xc);
		await expectDeclined(Buffer.concat([header, table]));
	});
});
