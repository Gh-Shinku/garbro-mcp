import { encodeCp932 } from "@garbro-mcp/core";
import { techgianBinFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x40;
const DATA_KEY = 0x7f;

interface Entry {
	name: string;
	content: Buffer;
	method: number;
}

/** Mirrors GARbro's `CRuntimeRandomGenerator` so fixtures can reproduce the index stream. */
function runtimeRandoms(count: number): number[] {
	const values: number[] = [];
	let seed = 0;
	for (let index = 0; index < count; index += 1) {
		seed = (Math.imul(seed, 214013) + 2531011) >>> 0;
		values.push((seed >>> 16) & 0x7fff);
	}
	return values;
}

function buildBin(
	entries: readonly Entry[],
	encryptedIndex: boolean,
): {
	archive: Buffer;
	expected: Buffer[];
} {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("RFIL", 0, "ascii");
	archive.writeInt32LE(count, 8);
	archive.writeInt32LE(encryptedIndex ? 1234 : 0, 12);
	const expected: Buffer[] = [];
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x34);
		archive.writeUInt32LE(entry.content.length, record + 0x38);
		archive.writeInt32LE(entry.method, record + 0x3c);
		entry.content.copy(archive, position);
		const plain = Buffer.from(entry.content);
		let length = plain.length;
		if (entry.method === 1) length = plain.length;
		else if (entry.method === 2)
			length =
				plain.length === 0 ? 0 : Math.trunc((plain.length - 1) / 100) + 1;
		else if (entry.method === 4) length = Math.min(1024, plain.length);
		else length = 0;
		for (let index = 0; index < length; index += 1)
			plain[index] = (plain[index] ?? 0) ^ DATA_KEY;
		expected.push(plain);
		offset += entry.content.length;
		position += entry.content.length;
	}
	if (encryptedIndex) {
		const randoms = runtimeRandoms(count * RECORD_SIZE);
		for (let index = 0; index < count * RECORD_SIZE; index += 1) {
			const positionInArchive = INDEX_OFFSET + index;
			archive[positionInArchive] =
				(archive[positionInArchive] ?? 0) ^ (randoms[index] ?? 0);
		}
	}
	return { archive, expected };
}

describe("Tech Gian RFIL archive", () => {
	it("reads a plain index and applies the full payload key", async () => {
		const { archive, expected } = buildBin(
			[
				{ name: "one.bin", content: Buffer.from("plain data"), method: 0 },
				{ name: "two.bin", content: Buffer.from("secret!"), method: 1 },
			],
			false,
		);
		await expectArchive({
			format: techgianBinFormat,
			archive,
			sourcePath: "sample.bin",
			entries: [
				{
					path: "one.bin",
					size: 10,
					content: expected[0] ?? Buffer.alloc(0),
				},
				{
					path: "two.bin",
					size: 7,
					content: expected[1] ?? Buffer.alloc(0),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("decrypts an index marked with the runtime random flag", async () => {
		const { archive, expected } = buildBin(
			[{ name: "hidden.dat", content: Buffer.from("body"), method: 0 }],
			true,
		);
		await expectArchive({
			format: techgianBinFormat,
			archive,
			sourcePath: "sample.bin",
			entries: [
				{
					path: "hidden.dat",
					size: 4,
					content: expected[0] ?? Buffer.alloc(0),
				},
			],
		});
	});

	it("limits partial keys to one byte per hundred and the first kilobyte", async () => {
		const percent = Buffer.alloc(250, 0x41);
		const prefix = Buffer.alloc(2048, 0x42);
		const { archive, expected } = buildBin(
			[
				{ name: "pct.bin", content: percent, method: 2 },
				{ name: "pre.bin", content: prefix, method: 4 },
			],
			false,
		);
		await expectArchive({
			format: techgianBinFormat,
			archive,
			sourcePath: "sample.bin",
			entries: [
				{
					path: "pct.bin",
					size: 250,
					content: expected[0] ?? Buffer.alloc(0),
				},
				{
					path: "pre.bin",
					size: 2048,
					content: expected[1] ?? Buffer.alloc(0),
				},
			],
		});
	});

	it("rejects a foreign signature", async () => {
		const { archive } = buildBin(
			[{ name: "a.bin", content: Buffer.from("x"), method: 0 }],
			false,
		);
		archive.write("RFIM", 0, "ascii");
		await expectArchive({
			format: techgianBinFormat,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
