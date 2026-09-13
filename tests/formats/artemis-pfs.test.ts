import { BufferByteSource } from "@garbro-mcp/core";
import { pfsFormat } from "@garbro-mcp/formats";
import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

interface Entry {
	name: string;
	content: Buffer;
}

const INDEX_START = 7;

/**
 * Builds a `pf6`/`pf8` archive: the index size is at 0x03 and the index opens with the entry count. A
 * record is a name length, the name, a four-byte gap and the payload fields.
 */
function buildPf(entries: readonly Entry[], version: 6 | 8): Buffer {
	const records = entries.map((entry) => 4 + entry.name.length + 4 + 8);
	const indexSize = 4 + records.reduce((total, size) => total + size, 0);
	const dataOffset = INDEX_START + indexSize;
	const offsets: number[] = [];
	let running = dataOffset;
	for (const entry of entries) {
		offsets.push(running);
		running += entry.content.length;
	}

	const archive = Buffer.alloc(running);
	archive.write(`pf${version}`, 0, "latin1");
	archive.writeUInt32LE(indexSize, 3);
	const index = archive.subarray(INDEX_START, dataOffset);
	index.writeInt32LE(entries.length, 0);
	let cursor = 4;
	for (const [id, entry] of entries.entries()) {
		index.writeInt32LE(entry.name.length, cursor);
		index.write(entry.name, cursor + 4, "latin1");
		cursor += entry.name.length + 8;
		index.writeUInt32LE(offsets[id] ?? 0, cursor);
		index.writeUInt32LE(entry.content.length, cursor + 4);
		cursor += 8;
	}
	// The payload key is the SHA-1 hash of the index block, indexed by the absolute file position.
	const key =
		version === 8 ? createHash("sha1").update(index).digest() : undefined;
	for (const [id, entry] of entries.entries()) {
		const payload = Buffer.from(entry.content);
		if (key)
			for (let position = 0; position < payload.length; position += 1)
				payload[position] =
					(payload[position] ?? 0) ^
					(key[((offsets[id] ?? 0) + position) % key.length] ?? 0);
		payload.copy(archive, offsets[id] ?? 0);
	}
	return archive;
}

/** Builds a `pf2` archive, whose count lives in the header and whose records carry a wider gap. */
function buildPf2(entries: readonly Entry[]): Buffer {
	const records = entries.map((entry) => 4 + entry.name.length + 0x0c + 8);
	const indexSize = 8 + records.reduce((total, size) => total + size, 0);
	const dataOffset = INDEX_START + indexSize;
	const offsets: number[] = [];
	let running = dataOffset;
	for (const entry of entries) {
		offsets.push(running);
		running += entry.content.length;
	}

	const archive = Buffer.alloc(running);
	archive.write("pf2", 0, "latin1");
	archive.writeUInt32LE(indexSize, 3);
	archive.writeInt32LE(entries.length, 0x0b);
	const index = archive.subarray(INDEX_START, dataOffset);
	let cursor = 8;
	for (const [id, entry] of entries.entries()) {
		index.writeInt32LE(entry.name.length, cursor);
		index.write(entry.name, cursor + 4, "latin1");
		cursor += entry.name.length + 0x10;
		index.writeUInt32LE(offsets[id] ?? 0, cursor);
		index.writeUInt32LE(entry.content.length, cursor + 4);
		cursor += 8;
	}
	for (const [id, entry] of entries.entries())
		entry.content.copy(archive, offsets[id] ?? 0);
	return archive;
}

describe("Artemis engine resource archive", () => {
	it("lists and extracts pf6 entries", async () => {
		const first = Buffer.from("first artemis payload");
		const second = Buffer.from("second artemis payload, longer");
		await expectArchive({
			format: pfsFormat,
			archive: buildPf(
				[
					{ name: "first.txt", content: first },
					{ name: "second.txt", content: second },
				],
				6,
			),
			entries: [
				{ path: "first.txt", size: first.length, content: first },
				{ path: "second.txt", size: second.length, content: second },
			],
			metadata: { entryCount: 2, version: 6 },
		});
	});

	it("decrypts pf8 payloads with the index hash", async () => {
		const content = Buffer.from("encrypted artemis payload, repeatable text");
		await expectArchive({
			format: pfsFormat,
			archive: buildPf([{ name: "secret.txt", content }], 8),
			entries: [{ path: "secret.txt", size: content.length, content }],
			metadata: { entryCount: 1, version: 8 },
		});
	});

	it("lists and extracts pf2 entries", async () => {
		const content = Buffer.from("pf2 payload");
		await expectArchive({
			format: pfsFormat,
			archive: buildPf2([{ name: "script.scr", content }]),
			entries: [{ path: "script.scr", size: content.length, content }],
			metadata: { entryCount: 1, version: 2 },
		});
	});

	it("normalizes separators", async () => {
		const content = Buffer.from("nested payload");
		await expectArchive({
			format: pfsFormat,
			archive: buildPf([{ name: "dir\\file.txt", content }], 6),
			entries: [{ path: "dir/file.txt", size: content.length, content }],
		});
	});

	it("rejects an unknown version digit", async () => {
		const archive = buildPf([{ name: "a.txt", content: Buffer.from("x") }], 6);
		archive.write("pf3", 0, "latin1");
		expect(
			await pfsFormat.detect(new BufferByteSource(archive), "sample.pfs"),
		).toBe(false);
	});

	it("rejects a foreign signature", async () => {
		const archive = buildPf([{ name: "a.txt", content: Buffer.from("x") }], 6);
		archive.write("px6", 0, "latin1");
		expect(
			await pfsFormat.detect(new BufferByteSource(archive), "sample.pfs"),
		).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildPf([{ name: "a.txt", content: Buffer.from("x") }], 6);
		archive.writeInt32LE(0x40000, INDEX_START);
		expect(
			await pfsFormat.detect(new BufferByteSource(archive), "sample.pfs"),
		).toBe(false);
	});

	it("rejects an index that reaches past the archive", async () => {
		const archive = buildPf([{ name: "a.txt", content: Buffer.from("x") }], 6);
		archive.writeUInt32LE(0x1000, 3);
		expect(
			await pfsFormat.detect(new BufferByteSource(archive), "sample.pfs"),
		).toBe(false);
	});

	it("rejects a name that reaches past the index", async () => {
		const archive = buildPf([{ name: "a.txt", content: Buffer.from("x") }], 6);
		archive.writeInt32LE(0x100, INDEX_START + 4);
		expect(
			await pfsFormat.detect(new BufferByteSource(archive), "sample.pfs"),
		).toBe(false);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildPf([{ name: "a.txt", content: Buffer.from("x") }], 6);
		// The first record's offset field sits behind its name and the four-byte gap.
		archive.writeUInt32LE(0x1000, INDEX_START + 4 + 4 + 4 + 1 + 4);
		expect(
			await pfsFormat.detect(new BufferByteSource(archive), "sample.pfs"),
		).toBe(false);
	});

	it("rejects a file too small for its header", async () => {
		expect(
			await pfsFormat.detect(
				new BufferByteSource(Buffer.from("pf")),
				"sample.pfs",
			),
		).toBe(false);
	});
});
