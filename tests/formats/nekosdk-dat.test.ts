import { BufferByteSource } from "@garbro-mcp/core";
import { nekosdkDatFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const XOR_KEY = 0xcacaca;
const RECORD_SIZE = 0x8c;
const NAME_SIZE = 0x80;

interface Entry {
	name: string;
	/** Stored payload; packed entries hold the LZSS stream. */
	stored: Buffer;
	unpacked?: Buffer;
}

/**
 * Builds the archive: the record array starts at offset 0 and the first record's offset field at
 * 0x88 is also the word the reference reads to derive the record count, so the payload region
 * follows `(entries + 1)` records.
 */
function buildDat(entries: readonly Entry[]): Buffer {
	const recordCount = entries.length + 1;
	const firstOffset = recordCount * RECORD_SIZE;
	const payloadSize = entries.reduce(
		(total, entry) => total + entry.stored.length,
		0,
	);
	const archive = Buffer.alloc(firstOffset + payloadSize);
	let payloadOffset = firstOffset;
	for (const [id, entry] of entries.entries()) {
		const record = id * RECORD_SIZE;
		const name = Buffer.from(entry.name, "latin1");
		name.copy(archive, record, 0, NAME_SIZE - 1);
		archive.writeUInt32LE(
			(entry.unpacked ? entry.unpacked.length : 0) ^ XOR_KEY,
			record + 0x80,
		);
		archive.writeUInt32LE(entry.stored.length ^ XOR_KEY, record + 0x84);
		archive.writeUInt32LE(payloadOffset ^ XOR_KEY, record + 0x88);
		entry.stored.copy(archive, payloadOffset);
		payloadOffset += entry.stored.length;
	}
	return archive;
}

describe("NekoSDK DAT resource archive", () => {
	it("reads masked records and decodes packed entries", async () => {
		const raw = Buffer.from("verbatim entry");
		const unpacked = Buffer.from("lzss packed entry payload");
		const archive = buildDat([
			{ name: "raw.bin", stored: raw },
			{
				name: "packed.bin",
				stored: literalLzssStream(unpacked),
				unpacked,
			},
		]);
		await expectArchive({
			format: nekosdkDatFormat,
			archive,
			sourcePath: "sample.dat",
			metadata: { entryCount: 2 },
			entries: [
				{ path: "raw.bin", size: raw.length, content: raw },
				{ path: "packed.bin", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("requires the dat extension", async () => {
		const archive = buildDat([
			{ name: "raw.bin", stored: Buffer.from("payload") },
		]);
		const source = new BufferByteSource(archive);
		expect(await nekosdkDatFormat.detect(source, "sample.bin")).toBe(false);
		expect(await nekosdkDatFormat.detect(source, "sample.dat")).toBe(true);
	});

	it("rejects a first offset that is not a record multiple", async () => {
		const archive = buildDat([
			{ name: "raw.bin", stored: Buffer.from("payload") },
		]);
		archive.writeUInt32LE((RECORD_SIZE + 4) ^ XOR_KEY, 0x88);
		const source = new BufferByteSource(archive);
		expect(await nekosdkDatFormat.detect(source, "sample.dat")).toBe(false);
	});

	it("rejects a record with an empty name", async () => {
		const archive = buildDat([
			{ name: "raw.bin", stored: Buffer.from("payload") },
		]);
		archive[0] = 0;
		const source = new BufferByteSource(archive);
		expect(await nekosdkDatFormat.detect(source, "sample.dat")).toBe(false);
	});

	it("rejects an entry placed before the payload region", async () => {
		// The first record's offset field doubles as the count word, so patch the second record.
		const archive = buildDat([
			{ name: "one.bin", stored: Buffer.from("first") },
			{ name: "two.bin", stored: Buffer.from("second") },
		]);
		archive.writeUInt32LE(0x10 ^ XOR_KEY, RECORD_SIZE + 0x88);
		const source = new BufferByteSource(archive);
		expect(await nekosdkDatFormat.detect(source, "sample.dat")).toBe(false);
	});
});
