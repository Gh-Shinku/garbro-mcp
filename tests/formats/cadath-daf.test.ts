import { encodeCp932 } from "@garbro-mcp/core";
import { dafFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";
import { deflateSync } from "node:zlib";

const INDEX_OFFSET = 8;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x18;
const SNR_HEADER_SIZE = 12;
const CGF_SEED = 0x3977141b;

function addSnrKey(data: Buffer): void {
	let key = 0x84;
	for (let position = 0; position < data.length; position += 1) {
		data[position] = ((data[position] ?? 0) + key) & 0xff;
		for (
			let count = Math.floor(((position & 0xf) + 2) / 3);
			count > 0;
			count -= 1
		) {
			key = (key + 0x99) & 0xff;
		}
	}
}

/** The CGF stream is symmetric, so encryption and decryption share one implementation. */
function xorCgf(data: Buffer): void {
	let key = CGF_SEED;
	for (let position = 0; position < data.length; position += 4) {
		key = ((key << 3) | (key >>> 29)) >>> 0;
		const available = Math.min(4, data.length - position);
		for (let byte = 0; byte < available; byte += 1)
			data[position + byte] =
				(data[position + byte] ?? 0) ^ ((key >>> (byte * 8)) & 0xff);
		key = (key + CGF_SEED) >>> 0;
	}
}

/** Builds the stored form of an `.snr` payload for the given plaintext. */
function buildSnr(plain: Buffer): Buffer {
	const body = Buffer.concat([Buffer.alloc(4), deflateSync(plain)]);
	xorCgf(body);
	addSnrKey(body);
	return Buffer.concat([
		Buffer.from("SNR\x1a", "latin1"),
		Buffer.alloc(SNR_HEADER_SIZE - 4),
		body,
	]);
}

interface DafEntry {
	name: string;
	stored: Buffer;
}

function buildDaf(entries: readonly DafEntry[]): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.stored.length, 0),
	);
	archive.write("DAF\x1a", 0, "latin1");
	archive.writeInt32LE(count, 4);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.stored.length, record + 4);
		encodeCp932(entry.name).copy(archive, record + 8);
		entry.stored.copy(archive, position);
		offset += entry.stored.length;
		position += entry.stored.length;
	}
	return archive;
}

describe("Cadath DAF archive", () => {
	it("reads a flat offset table and inflates .snr payloads", async () => {
		const plain = Buffer.from("decoded snr payload");
		const other = Buffer.from("plain entry");
		await expectArchive({
			format: dafFormat,
			archive: buildDaf([
				{ name: "image.snr", stored: buildSnr(plain) },
				{ name: "note.txt", stored: other },
			]),
			sourcePath: "sample.daf",
			entries: [
				{ path: "image.snr", size: plain.length, content: plain },
				{ path: "note.txt", size: other.length, content: other },
			],
			metadata: { entryCount: 2, decodedEntryCount: 1 },
		});
	});

	it("falls back to raw bytes when the .snr payload is invalid", async () => {
		const stored = Buffer.concat([
			Buffer.from("SNR\x1a", "latin1"),
			Buffer.alloc(SNR_HEADER_SIZE - 4),
			Buffer.alloc(16, 0x41),
		]);
		await expectArchive({
			format: dafFormat,
			archive: buildDaf([{ name: "broken.snr", stored }]),
			sourcePath: "sample.daf",
			entries: [{ path: "broken.snr", size: stored.length, content: stored }],
			metadata: { decodedEntryCount: 0 },
		});
	});

	it("rejects entries placed outside the file", async () => {
		const archive = buildDaf([
			{ name: "a.bin", stored: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x100000, INDEX_OFFSET);
		await expectArchive({
			format: dafFormat,
			archive,
			sourcePath: "sample.daf",
			detected: false,
			entries: [],
		});
	});
});
