import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { nitroplusNpaSteinsGateFormat } from "../../packages/formats/src/nitroplus/npa-sg.js";

const KEY = Buffer.from([
	0x42 ^ 0xff,
	0x55 ^ 0xff,
	0x43 ^ 0xff,
	0x4b ^ 0xff,
	0x54 ^ 0xff,
	0x49 ^ 0xff,
	0x43 ^ 0xff,
	0x4b ^ 0xff,
]);

/** Applies the repeating key from the first byte, as the reader does for every encrypted region. */
function decrypt(data: Buffer): Buffer {
	const output = Buffer.from(data);
	for (let index = 0; index < output.length; index += 1)
		output[index] = (output[index] ?? 0) ^ (KEY[index % KEY.length] ?? 0);
	return output;
}

interface SgEntry {
	name: Buffer;
	data: Buffer;
}

/**
 * Builds a Steins;Gate archive: the little endian index size, an encrypted index of name, size and
 * offset records, then the encrypted payloads. Every encrypted region restarts at the first key byte.
 */
function buildSg(entries: SgEntry[], indexSizeOverride?: number): Buffer {
	const indexSize =
		4 +
		entries.reduce((total, entry) => total + 4 + entry.name.length + 4 + 8, 0);
	const payloadOffset = 4 + indexSize;
	let position = payloadOffset;
	const records: Buffer[] = [];
	const payloads: Buffer[] = [];
	for (const entry of entries) {
		const record = Buffer.alloc(4 + entry.name.length + 4 + 8);
		record.writeInt32LE(entry.name.length, 0);
		entry.name.copy(record, 4);
		record.writeUInt32LE(entry.data.length, 4 + entry.name.length);
		record.writeBigInt64LE(BigInt(position), 4 + entry.name.length + 4);
		records.push(record);
		payloads.push(entry.data);
		position += entry.data.length;
	}
	const header = Buffer.alloc(4);
	header.writeInt32LE(indexSizeOverride ?? indexSize, 0);
	const index = Buffer.alloc(4);
	index.writeInt32LE(entries.length, 0);
	return Buffer.concat([
		header,
		decrypt(Buffer.concat([index, ...records])),
		...payloads.map((payload) => decrypt(payload)),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("nitroplus steins gate npa", () => {
	it("lists and decrypts entries", async () => {
		const data = Buffer.from("encrypted payload bytes here");
		const file = buildSg([{ name: Buffer.from("SCRIPT.SCX", "latin1"), data }]);
		const source = sourceOf(file);
		expect(await nitroplusNpaSteinsGateFormat.detect(source)).toBe(true);
		const archive = await nitroplusNpaSteinsGateFormat.open(source, "game.npa");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"SCRIPT.SCX",
			]);
			expect(Number(archive.entries[0]?.size)).toBe(data.length);
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.metadata).toMatchObject({ entryCount: 1 });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(data);
			// The stored payload really is encrypted on disk.
			expect(file.subarray(file.length - data.length)).not.toEqual(data);
		} finally {
			await archive.close();
		}
	});

	it("keeps the index readable when it is not encrypted correctly", async () => {
		const file = buildSg([
			{ name: Buffer.from("A.BIN", "latin1"), data: Buffer.from("x") },
		]);
		// Flipping a byte of the stored count breaks the entry count check.
		file[4] = (file[4] ?? 0) ^ 0xff;
		expect(await nitroplusNpaSteinsGateFormat.detect(sourceOf(file))).toBe(
			false,
		);
	});

	it("declines an index that is too small", async () => {
		const file = buildSg([
			{ name: Buffer.from("A.BIN", "latin1"), data: Buffer.from("x") },
		]);
		file.writeInt32LE(0x10, 0);
		expect(await nitroplusNpaSteinsGateFormat.detect(sourceOf(file))).toBe(
			false,
		);
	});

	it("declines an index that covers the whole file", async () => {
		const file = buildSg([
			{ name: Buffer.from("A.BIN", "latin1"), data: Buffer.from("x") },
		]);
		file.writeInt32LE(file.length, 0);
		expect(await nitroplusNpaSteinsGateFormat.detect(sourceOf(file))).toBe(
			false,
		);
	});

	it("declines an index above the size limit", async () => {
		const file = buildSg([
			{ name: Buffer.from("A.BIN", "latin1"), data: Buffer.from("x") },
		]);
		file.writeInt32LE(0x1000000, 0);
		expect(await nitroplusNpaSteinsGateFormat.detect(sourceOf(file))).toBe(
			false,
		);
	});

	it("declines an empty entry count", async () => {
		const file = buildSg([
			{ name: Buffer.from("A.BIN", "latin1"), data: Buffer.from("x") },
		]);
		decrypt(file.subarray(4, 8)).copy(file, 4);
		file.writeInt32LE(0, 4);
		expect(await nitroplusNpaSteinsGateFormat.detect(sourceOf(file))).toBe(
			false,
		);
	});

	it("declines an index whose average entry size is too small", async () => {
		const file = buildSg([{ name: Buffer.alloc(0), data: Buffer.from("x") }]);
		expect(await nitroplusNpaSteinsGateFormat.detect(sourceOf(file))).toBe(
			false,
		);
	});

	it("decodes cp932 and utf-16 names", async () => {
		const file = buildSg([
			{
				name: Buffer.from([0x82, 0xa0, 0x2e, 0x74, 0x78, 0x74]),
				data: Buffer.from("a"),
			},
			{ name: Buffer.from("B\0I\0N\0", "latin1"), data: Buffer.from("bb") },
		]);
		const source = sourceOf(file);
		const archive = await nitroplusNpaSteinsGateFormat.open(source, "game.npa");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"あ.txt",
				"BIN",
			]);
		} finally {
			await archive.close();
		}
	});

	it("normalizes directory separators in names", async () => {
		const file = buildSg([
			{
				name: Buffer.from("dir\\sub\\file.bin", "latin1"),
				data: Buffer.from("data"),
			},
		]);
		const source = sourceOf(file);
		const archive = await nitroplusNpaSteinsGateFormat.open(source, "game.npa");
		try {
			expect(archive.entries[0]?.path).toBe("dir/sub/file.bin");
			expect(archive.entries[0]?.rawPath).toBe("dir\\sub\\file.bin");
		} finally {
			await archive.close();
		}
	});
});
