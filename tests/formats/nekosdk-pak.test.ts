import { deflateSync } from "node:zlib";
import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { nekoSdkPakFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_READ_SIZE = 0x10;
/** Key schedule of the four byte payload header. */
const KEY_BASE = 0x22;
const KEY_STEP = 8;

interface PakEntry {
	name: string;
	unpacked: Buffer;
}

/** The index key is the sum of the name's bytes read as signed values. */
function nameKey(name: Buffer): number {
	let key = 0;
	for (const byte of name) key += byte < 0x80 ? byte : byte - 0x100;
	return key;
}

/** Encrypts the first four bytes of a payload the way the opener decrypts them. */
function encryptHeader(payload: Buffer, storedSize: number): Buffer {
	const encrypted = Buffer.from(payload);
	let key = Math.floor(storedSize / KEY_STEP) + KEY_BASE;
	for (let index = 0; index < Math.min(4, encrypted.length); index += 1) {
		encrypted[index] = (encrypted[index] ?? 0) ^ (key & 0xff);
		key = (key << 3) >>> 0;
	}
	return encrypted;
}

/**
 * Builds a NEKOPACK4 archive. Every payload is a zlib stream whose first four bytes are stored
 * encrypted, followed by the unpacked size in its last word.
 */
function buildPak(entries: readonly PakEntry[], version = "A"): Buffer {
	const prepared = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		const deflated = deflateSync(entry.unpacked);
		const trailer = Buffer.alloc(4);
		trailer.writeUInt32LE(entry.unpacked.length, 0);
		// The stored range is the zlib stream plus its four byte size word; the opener drops the
		// word and decrypts the first four bytes of the stream.
		const storedSize = deflated.length + 4;
		return {
			name,
			payload: encryptHeader(Buffer.concat([deflated, trailer]), storedSize),
		};
	});
	const recordSize = prepared.reduce(
		(total, item) => total + 4 + item.name.length + 8,
		0,
	);
	const headerSize = version === "A" ? 0x0e : 0x0a;
	const payloadBase = headerSize + recordSize + 4;
	const header = Buffer.alloc(HEADER_READ_SIZE);
	header.write("NEKOPACK4", 0, "ascii");
	header.write(version, 9, "ascii");
	// In the A layout the word is the whole index size; in the S layout it is the first name length.
	header.writeUInt32LE(
		version === "A" ? recordSize + 4 : (prepared[0]?.name.length ?? 0),
		0x0a,
	);

	const records: Buffer[] = [];
	const payloads: Buffer[] = [];
	let running = 0;
	for (const item of prepared) {
		const key = nameKey(item.name);
		const record = Buffer.alloc(4 + item.name.length + 8);
		record.writeUInt32LE(item.name.length, 0);
		item.name.copy(record, 4);
		record.writeUInt32LE(
			((payloadBase + running) ^ (key >>> 0)) >>> 0,
			4 + item.name.length,
		);
		record.writeUInt32LE(
			(item.payload.length ^ (key >>> 0)) >>> 0,
			8 + item.name.length,
		);
		records.push(record);
		payloads.push(item.payload);
		running += item.payload.length;
	}
	return Buffer.concat([
		header.subarray(0, headerSize),
		...records,
		Buffer.alloc(4),
		...payloads,
	]);
}

describe("NekoSDK NEKOPACK4 resource archive", () => {
	it("lists entries and unpacks their zlib payloads", async () => {
		const first = Buffer.from("first payload, repeated payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: nekoSdkPakFormat,
			archive: buildPak([
				{ name: "FIRST.BIN", unpacked: first },
				{ name: "DIR\\SECOND.BIN", unpacked: second },
			]),
			sourcePath: "sample.pak",
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "DIR/SECOND.BIN", size: second.length, content: second },
			],
		});
	});

	it("reads the index of the S layout", async () => {
		const unpacked = Buffer.from("s layout payload");
		await expectArchive({
			format: nekoSdkPakFormat,
			archive: buildPak([{ name: "ONLY.BIN", unpacked }], "S"),
			sourcePath: "sample.pak",
			entries: [{ path: "ONLY.BIN", size: unpacked.length, content: unpacked }],
		});
	});

	it("derives the index key from signed name bytes", async () => {
		// A CP932 name whose high bytes make the signed sum negative, which an unsigned sum never is.
		const name = "\u6f22\u5b57.BIN";
		const unpacked = Buffer.from("signed key payload");
		expect(nameKey(encodeCp932(name))).toBeLessThan(0);
		await expectArchive({
			format: nekoSdkPakFormat,
			archive: buildPak([{ name, unpacked }]),
			sourcePath: "sample.pak",
			entries: [{ path: name, size: unpacked.length, content: unpacked }],
		});
	});

	it("rejects a foreign marker", async () => {
		const archive = buildPak([
			{ name: "FILE.BIN", unpacked: Buffer.from("payload") },
		]);
		archive.write("NEKOPACKX", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await nekoSdkPakFormat.detect(source)).toBe(false);
	});

	it("rejects an unknown version", async () => {
		const archive = buildPak([
			{ name: "FILE.BIN", unpacked: Buffer.from("payload") },
		]);
		archive.write("X", 9, "ascii");
		const source = new BufferByteSource(archive);
		expect(await nekoSdkPakFormat.detect(source)).toBe(false);
	});

	it("rejects an index that reaches past the archive", async () => {
		const archive = buildPak([
			{ name: "FILE.BIN", unpacked: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x10000, 0x0a);
		const source = new BufferByteSource(archive);
		expect(await nekoSdkPakFormat.detect(source)).toBe(false);
	});

	it("rejects an index without entries", async () => {
		const archive = Buffer.alloc(0x10, 0);
		archive.write("NEKOPACK4A", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await nekoSdkPakFormat.detect(source)).toBe(false);
	});

	it("rejects a name longer than the name buffer", async () => {
		const archive = buildPak([
			{ name: "FILE.BIN", unpacked: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x101, 0x0e);
		const source = new BufferByteSource(archive);
		expect(await nekoSdkPakFormat.detect(source)).toBe(false);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildPak([
			{ name: "FILE.BIN", unpacked: Buffer.from("payload") },
		]);
		const key = nameKey(encodeCp932("FILE.BIN"));
		archive.writeUInt32LE((0x1000 ^ (key >>> 0)) >>> 0, 0x0e + 4 + 8);
		const source = new BufferByteSource(archive);
		expect(await nekoSdkPakFormat.detect(source)).toBe(false);
	});
});
