import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { dpmFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x10;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x10;

interface EntrySpec {
	name: string;
	payload: Buffer;
	key?: number;
}

/** The seeds `DpmArchive.DecryptEntry2` derives from an entry key. */
function seeds(key: number): { first: number; second: number } {
	return {
		first: (0xaa + (((key >>> 16) ^ ((key + 0x5a) >>> 0)) & 0xff)) & 0xff,
		second:
			(0x55 + (((key >>> 24) ^ (((key >>> 8) + 0xa5) >>> 0)) & 0xff)) & 0xff,
	};
}

/**
 * Builds the stored form of a keyed payload. Decoding adds a running sum of the seeds mixed with each
 * stored byte, so each byte can be solved directly from the plain byte before it.
 */
function encryptEntry(plain: Buffer, key: number): Buffer {
	const { first, second } = seeds(key);
	const stored = Buffer.alloc(plain.length);
	let value = 0;
	for (let index = 0; index < plain.length; index += 1) {
		const step = ((plain[index] ?? 0) - value) & 0xff;
		stored[index] = first ^ ((step + second) & 0xff);
		value = (plain[index] ?? 0) & 0xff;
	}
	return stored;
}

/** Lays out the header, the payloads and the index records. */
function buildDpm(entries: readonly EntrySpec[]): Buffer {
	const payloads = entries.map((entry) =>
		entry.key === undefined || entry.key === 0
			? entry.payload
			: encryptEntry(entry.payload, entry.key),
	);
	const dataBase = HEADER_SIZE;
	let cursor = dataBase;
	const offsets: number[] = [];
	for (const payload of payloads) {
		offsets.push(cursor - dataBase);
		cursor += payload.length;
	}
	const indexOffset = cursor;
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("DPMX", 0, "latin1");
	header.writeUInt32LE(dataBase, 4);
	header.writeInt32LE(entries.length, 8);
	header.writeUInt32LE(indexOffset - HEADER_SIZE, 0xc);
	const records: Buffer[] = [];
	for (const [index, entry] of entries.entries()) {
		const record = Buffer.alloc(RECORD_SIZE);
		const name = Buffer.from(encodeCp932(entry.name));
		name.copy(record, 0, 0, Math.min(name.length, NAME_SIZE));
		record.writeUInt32LE(entry.key ?? 0, NAME_SIZE);
		record.writeUInt32LE(offsets[index] ?? 0, NAME_SIZE + 4);
		record.writeUInt32LE(entry.payload.length, NAME_SIZE + 8);
		records.push(record);
	}
	return Buffer.concat([header, ...payloads, ...records]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	expect(await dpmFormat.detect(new BufferByteSource(file), "sample.dpm")).toBe(
		false,
	);
}

describe("Hot Soup Processor DPM resource archive", () => {
	it("lists stored entries", async () => {
		const first = Buffer.from("first payload bytes");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: dpmFormat,
			sourcePath: "sample.dpm",
			archive: buildDpm([
				{ name: "first.dat", payload: first },
				{ name: "second.dat", payload: second },
			]),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("decodes an entry with a key", async () => {
		const plain = Buffer.from("keyed payload contents");
		await expectArchive({
			format: dpmFormat,
			sourcePath: "sample.dpm",
			archive: buildDpm([
				{ name: "keyed.dat", payload: plain, key: 0x12345678 },
			]),
			entries: [{ path: "keyed.dat", size: plain.length, content: plain }],
		});
	});

	it("decodes an entry whose key has no high bytes", async () => {
		const plain = Buffer.from("another keyed payload");
		await expectArchive({
			format: dpmFormat,
			sourcePath: "sample.dpm",
			archive: buildDpm([{ name: "keyed.dat", payload: plain, key: 7 }]),
			entries: [{ path: "keyed.dat", size: plain.length, content: plain }],
		});
	});

	it("marks keyed entries as encrypted", async () => {
		const plain = Buffer.from("payload bytes here");
		const archive = await dpmFormat.open(
			new BufferByteSource(
				buildDpm([
					{ name: "plain.dat", payload: plain },
					{ name: "keyed.dat", payload: plain, key: 0x9abcdef0 },
				]),
			),
			"sample.dpm",
		);
		expect(archive.entries.map((entry) => entry.encrypted)).toEqual([
			false,
			true,
		]);
	});

	it("normalizes a name with a backslash", async () => {
		const payload = Buffer.from("nested payload");
		await expectArchive({
			format: dpmFormat,
			sourcePath: "sample.dpm",
			archive: buildDpm([{ name: "dir\\nested.dat", payload }]),
			entries: [
				{ path: "dir/nested.dat", size: payload.length, content: payload },
			],
		});
	});

	it("rejects a foreign signature", async () => {
		const file = buildDpm([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.write("ZZZZ", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects an archive without a usable count", async () => {
		const file = buildDpm([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeInt32LE(0, 8);
		await expectDeclined(file);
	});

	it("rejects an index that leaves the file", async () => {
		const file = buildDpm([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeUInt32LE(file.length, 0xc);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildDpm([{ name: "first.dat", payload: Buffer.from("x") }]);
		const indexOffset = HEADER_SIZE + file.readUInt32LE(0xc);
		file.writeUInt32LE(file.length, indexOffset + NAME_SIZE + 8);
		await expectDeclined(file);
	});
});
