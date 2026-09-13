import { BufferByteSource } from "@garbro-mcp/core";
import { leafAmFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

interface Entry {
	name: string;
	content: Buffer;
}

/** Builds an `am00` archive; the index is masked with the key byte. */
function buildAm(entries: readonly Entry[], key = 0x5a): Buffer {
	// Records are laid out first, because the index has to be masked as a whole.
	const payloadBase =
		9 + entries.reduce((total, entry) => total + entry.name.length + 1 + 8, 0);
	const records: Buffer[] = [];
	let payloadOffset = payloadBase;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "latin1");
		const record = Buffer.alloc(name.length + 1 + 8);
		name.copy(record, 0);
		record.writeUInt32LE(payloadOffset - payloadBase, name.length + 1);
		record.writeUInt32LE(entry.content.length, name.length + 5);
		records.push(record);
		payloadOffset += entry.content.length;
	}
	const index = Buffer.concat(records);
	for (let position = 0; position < index.length; position += 1)
		index[position] = (index[position] ?? 0) ^ key;

	const archive = Buffer.alloc(
		payloadBase +
			entries.reduce((total, entry) => total + entry.content.length, 0),
	);
	archive.write("am00", 0, "latin1");
	archive.writeUInt32LE(index.length, 4);
	archive.writeUInt8(key, 8);
	index.copy(archive, 9);
	let cursor = payloadBase;
	for (const entry of entries) {
		entry.content.copy(archive, cursor);
		cursor += entry.content.length;
	}
	return archive;
}

describe("Leaf AM video resources archive", () => {
	it("lists entries and extracts their payloads", async () => {
		const first = Buffer.from("first video payload");
		const second = Buffer.from("second video payload, longer");
		await expectArchive({
			format: leafAmFormat,
			archive: buildAm([
				{ name: "op.am", content: first },
				{ name: "ed.am", content: second },
			]),
			sourcePath: "sample.am",
			entries: [
				{ path: "op.am", size: first.length, content: first },
				{ path: "ed.am", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("unmasks the index with a non-zero key", async () => {
		const content = Buffer.from("masked index payload");
		await expectArchive({
			format: leafAmFormat,
			archive: buildAm([{ name: "movie.am", content }], 0xff),
			sourcePath: "sample.am",
			entries: [{ path: "movie.am", size: content.length, content }],
		});
	});

	it("keeps names verbatim", async () => {
		const content = Buffer.from("payload");
		// The reference is not hierarchical, so a backslash stays part of the name.
		await expectArchive({
			format: leafAmFormat,
			archive: buildAm([{ name: "dir\\movie.am", content }]),
			sourcePath: "sample.am",
			entries: [{ path: "dir\\movie.am", size: content.length, content }],
		});
	});

	it("accepts an empty index", async () => {
		const archive = buildAm([]);
		await expectArchive({
			format: leafAmFormat,
			archive,
			sourcePath: "sample.am",
			entries: [],
			metadata: { entryCount: 0 },
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildAm([{ name: "a.am", content: Buffer.from("x") }]);
		archive.write("am01", 0, "latin1");
		expect(
			await leafAmFormat.detect(new BufferByteSource(archive), "sample.am"),
		).toBe(false);
	});

	it("rejects an index that reaches past the archive", async () => {
		const archive = buildAm([{ name: "a.am", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x1000, 4);
		expect(
			await leafAmFormat.detect(new BufferByteSource(archive), "sample.am"),
		).toBe(false);
	});

	it("rejects an empty name", async () => {
		// An unmasked index keeps the patch below readable.
		const archive = buildAm([{ name: "a.am", content: Buffer.from("x") }], 0);
		// The first index byte is the name's first character; make it the terminator instead.
		archive.writeUInt8(0, 9);
		expect(
			await leafAmFormat.detect(new BufferByteSource(archive), "sample.am"),
		).toBe(false);
	});

	it("rejects a name without a terminator", async () => {
		// An unmasked index keeps the patch below readable.
		const archive = buildAm([{ name: "a.am", content: Buffer.from("x") }], 0);
		// Cut the declared index so that it ends inside a name.
		archive.writeUInt32LE(3, 4);
		expect(
			await leafAmFormat.detect(new BufferByteSource(archive), "sample.am"),
		).toBe(false);
	});

	it("rejects a trailing partial record", async () => {
		const archive = buildAm([{ name: "a.am", content: Buffer.from("x") }]);
		// Shrink the declared index by four bytes so the last record is incomplete.
		archive.writeUInt32LE(archive.readUInt32LE(4) - 4, 4);
		expect(
			await leafAmFormat.detect(new BufferByteSource(archive), "sample.am"),
		).toBe(false);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildAm([{ name: "a.am", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x1000, 9 + "a.am".length + 1);
		expect(
			await leafAmFormat.detect(new BufferByteSource(archive), "sample.am"),
		).toBe(false);
	});

	it("rejects a file that is too small for its header", async () => {
		expect(
			await leafAmFormat.detect(
				new BufferByteSource(Buffer.from("am00")),
				"sample.am",
			),
		).toBe(false);
	});
});
