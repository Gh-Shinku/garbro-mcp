import { deflateSync } from "node:zlib";
import { encodeCp932, FileByteSource } from "@garbro-mcp/core";
import { jamDatFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const TABLE_OFFSET = 0x18;
const SECTION_COUNT = 5;
const HEADER_SIZE = TABLE_OFFSET + SECTION_COUNT * 8;
const ENTRY_STRIDE = 24;
const DIRECTORY_FLAGS = 0x80000000;

/**
 * Encodes the delta cipher the reference applies: every byte from the second on stores itself plus the
 * running index and the previous *plaintext* byte, both reduced to eight bits.
 */
function deltaEncode(plain: Buffer, length: number): Buffer {
	const encoded = Buffer.from(plain);
	if (encoded.length === 0) return encoded;
	let previous = plain[0] ?? 0;
	for (let position = 1; position < length; position += 1) {
		const value = plain[position] ?? 0;
		encoded[position] = (value + ((position + previous) & 0xff)) & 0xff;
		previous = value;
	}
	return encoded;
}

interface Record {
	id?: number;
	offset?: number;
	size?: number;
	unpackedSize?: number;
	flags?: number;
	nameIndex?: number;
}

interface IndexOptions {
	records: readonly Record[];
	names: readonly string[];
	archiveName: string;
	version?: number;
	arcNames?: readonly string[];
}

function buildCStringPool(strings: readonly string[]): {
	pool: Buffer;
	offsets: number[];
} {
	const parts: Buffer[] = [];
	const offsets: number[] = [];
	let position = 0;
	for (const value of strings) {
		offsets.push(position);
		const encoded = Buffer.concat([encodeCp932(value), Buffer.from([0])]);
		parts.push(encoded);
		position += encoded.length;
	}
	return { pool: Buffer.concat(parts), offsets };
}

/** Builds the sibling index: five descriptors at 0x18 and the five sections behind them. */
function buildIndex(options: IndexOptions): Buffer {
	const count = options.records.length;
	const recordSection = Buffer.alloc(4 + ENTRY_STRIDE * count);
	recordSection.writeInt32LE(count, 0);
	for (const [index, record] of options.records.entries()) {
		const position = 4 + index * ENTRY_STRIDE;
		recordSection.writeInt32LE(record.id ?? 0, position);
		recordSection.writeUInt32LE(record.offset ?? 0, position + 4);
		recordSection.writeUInt32LE(record.size ?? 0, position + 8);
		recordSection.writeUInt32LE(record.unpackedSize ?? 0, position + 12);
		recordSection.writeUInt32LE(record.flags ?? 0, position + 16);
		if (record.nameIndex !== undefined)
			recordSection.writeInt32LE(record.nameIndex, position + 20);
	}

	const names = buildCStringPool(options.names);
	const arcNames = buildCStringPool(options.arcNames ?? [options.archiveName]);
	const nameSection = Buffer.alloc(4 + 4 * names.offsets.length);
	nameSection.writeInt32LE(names.offsets.length, 0);
	for (const [index, offset] of names.offsets.entries())
		nameSection.writeInt32LE(offset, 4 + index * 4);
	const arcSection = Buffer.alloc(4 + 4 * arcNames.offsets.length);
	arcSection.writeInt32LE(arcNames.offsets.length, 0);
	for (const [index, offset] of arcNames.offsets.entries())
		arcSection.writeInt32LE(offset, 4 + index * 4);

	const sections = [
		recordSection,
		nameSection,
		names.pool,
		arcSection,
		arcNames.pool,
	];
	// The reference decrypts each counted section from behind its count word, only as far as the count
	// it announces, and decrypts the two name pools in full from their first byte.
	const decryptLengths = [
		ENTRY_STRIDE * count,
		4 * names.offsets.length,
		names.pool.length,
		4 * arcNames.offsets.length,
		arcNames.pool.length,
	];
	const decryptStarts = [4, 4, 0, 4, 0];
	const encrypted = sections.map((section, index) => {
		const start = decryptStarts[index] ?? 0;
		const length = decryptLengths[index] ?? 0;
		return Buffer.concat([
			Buffer.from(section.subarray(0, start)),
			deltaEncode(section.subarray(start), length),
		]);
	});

	const header = Buffer.alloc(HEADER_SIZE);
	header.writeUInt32LE(options.version ?? 1, 0x14);
	let position = HEADER_SIZE;
	const body: Buffer[] = [];
	for (const [index, section] of encrypted.entries()) {
		header.writeUInt32LE(position, TABLE_OFFSET + index * 8);
		header.writeUInt32LE(section.length, TABLE_OFFSET + index * 8 + 4);
		body.push(section);
		position += section.length;
	}
	return Buffer.concat([header, ...body]);
}

describe("Jam Creation DAT archive", () => {
	it("reads entries for this volume through a directory record", async () => {
		const plain = Buffer.from("plain body");
		const secret = Buffer.from("secret body");
		const encrypted = deltaEncode(secret, secret.length);
		const volume = Buffer.alloc(0x10 + plain.length + encrypted.length);
		plain.copy(volume, 0x10);
		encrypted.copy(volume, 0x10 + plain.length);
		const index = buildIndex({
			records: [
				{ flags: DIRECTORY_FLAGS, nameIndex: 0 },
				{
					id: 0,
					offset: 0x10,
					size: plain.length,
					unpackedSize: plain.length,
					flags: 0,
					nameIndex: 1,
				},
				{
					id: 0,
					offset: 0x10 + plain.length,
					size: secret.length,
					unpackedSize: secret.length,
					flags: 0x200,
					nameIndex: 2,
				},
				{
					id: 7,
					offset: 0x10,
					size: plain.length,
					unpackedSize: plain.length,
					flags: 0,
					nameIndex: 1,
				},
			],
			names: ["graphics", "one.dat", "two.dat"],
			archiveName: "data.dat",
		});
		await withCompanionFiles(
			"data.dat",
			{ "data.dat": volume, "00000000.dat": index },
			async (mainPath) => {
				await expectCompanionArchive({
					format: jamDatFormat,
					mainPath,
					entries: [
						{ path: "graphics/one.dat", size: plain.length, content: plain },
						{
							path: "graphics/two.dat",
							size: secret.length,
							content: secret,
						},
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("decodes packed entries with zlib", async () => {
		const unpacked = Buffer.from("inflated contents");
		const packed = deflateSync(unpacked);
		const volume = Buffer.alloc(8 + packed.length);
		packed.copy(volume, 8);
		const index = buildIndex({
			records: [
				{
					id: 0,
					offset: 8,
					size: packed.length,
					unpackedSize: unpacked.length,
					flags: 0x100,
					nameIndex: 0,
				},
			],
			names: ["packed.dat"],
			archiveName: "data.dat",
		});
		await withCompanionFiles(
			"data.dat",
			{ "data.dat": volume, "00000000.dat": index },
			async (mainPath) => {
				await expectCompanionArchive({
					format: jamDatFormat,
					mainPath,
					entries: [
						{
							path: "packed.dat",
							size: unpacked.length,
							content: unpacked,
						},
					],
				});
			},
		);
	});

	it("rejects an index with an unknown version", async () => {
		const volume = Buffer.alloc(0x18);
		const index = buildIndex({
			records: [
				{
					id: 0,
					offset: 0x10,
					size: 4,
					unpackedSize: 4,
					flags: 0,
					nameIndex: 0,
				},
			],
			names: ["one.dat"],
			archiveName: "data.dat",
			version: 2,
		});
		await withCompanionFiles(
			"data.dat",
			{ "data.dat": volume, "00000000.dat": index },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await jamDatFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects a volume whose name is missing from the archive table", async () => {
		const volume = Buffer.alloc(0x18);
		const index = buildIndex({
			records: [
				{
					id: 0,
					offset: 0x10,
					size: 4,
					unpackedSize: 4,
					flags: 0,
					nameIndex: 0,
				},
			],
			names: ["one.dat"],
			archiveName: "other.dat",
		});
		await withCompanionFiles(
			"data.dat",
			{ "data.dat": volume, "00000000.dat": index },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await jamDatFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});
});
