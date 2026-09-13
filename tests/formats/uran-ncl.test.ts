import { BufferByteSource } from "@garbro-mcp/core";
import { uranNclFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const STREAM_KEY = 10;

interface Record {
	name: string;
	content: Buffer;
	method?: number;
	/** Extra bytes the record's tail declares and the port has to skip. */
	tail?: number;
}

/** Adds the stream key back to every stored byte. */
function encodeSubStream(data: Buffer): Buffer {
	const output = Buffer.from(data);
	for (let i = 0; i < output.length; i += 1)
		output[i] = ((output[i] ?? 0) + STREAM_KEY) & 0xff;
	return output;
}

/** Builds an Uran archive: records walked one after another until the zero size word. */
function buildNcl(records: readonly Record[], terminate = true): Buffer {
	const parts: Buffer[] = [];
	for (const record of records) {
		const method = record.method ?? 1;
		const body =
			method === 2
				? deflateSync(record.content)
				: method === 3
					? record.content
					: record.content;
		const stored = encodeSubStream(body);
		const name = Buffer.from(record.name, "latin1");
		const header = Buffer.alloc(10);
		header.writeUInt32LE(1 + stored.length, 0);
		header.writeUInt32LE(record.content.length, 4);
		header.writeUInt16LE(name.length, 8);
		const tail = Buffer.alloc(6);
		tail.writeUInt16LE(record.tail ?? 0, 4);
		parts.push(
			header,
			name,
			tail,
			Buffer.alloc(record.tail ?? 0),
			// The method byte is shifted like the rest of the record, so the reader subtracts the key.
			Buffer.from([(method + STREAM_KEY) & 0xff]),
			stored,
		);
	}
	if (terminate) parts.push(Buffer.alloc(4));
	return Buffer.concat(parts);
}

describe("Uran resource archive", () => {
	it("lists stored and zlib payloads", async () => {
		const stored = Buffer.from("stored uran payload");
		const packed = Buffer.from("zlib uran payload contents");
		await expectArchive({
			format: uranNclFormat,
			archive: buildNcl([
				{ name: "one.bin", content: stored, method: 1 },
				{ name: "two.bin", content: packed, method: 2 },
			]),
			sourcePath: "sample.ncl",
			entries: [
				{ path: "one.bin", size: stored.length, content: stored },
				{ path: "two.bin", size: packed.length, content: packed },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("skips the tail bytes a record declares", async () => {
		const content = Buffer.from("tail payload");
		await expectArchive({
			format: uranNclFormat,
			archive: buildNcl([
				{ name: "one.bin", content, method: 1, tail: 5 },
				{ name: "two.bin", content, method: 1 },
			]),
			sourcePath: "sample.ncl",
			entries: [
				{ path: "one.bin", size: content.length, content },
				{ path: "two.bin", size: content.length, content },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("returns any other packed method as the decoded stream", async () => {
		const content = Buffer.from("method four payload");
		await expectArchive({
			format: uranNclFormat,
			archive: buildNcl([{ name: "one.bin", content, method: 4 }]),
			sourcePath: "sample.ncl",
			entries: [{ path: "one.bin", size: content.length, content }],
		});
	});

	it("ends the walk at a zero size word", async () => {
		const content = Buffer.from("only payload");
		const archive = Buffer.concat([
			buildNcl([{ name: "one.bin", content, method: 1 }], false),
			Buffer.alloc(4),
			Buffer.from("trailing junk"),
		]);
		await expectArchive({
			format: uranNclFormat,
			archive,
			sourcePath: "sample.ncl",
			entries: [{ path: "one.bin", size: content.length, content }],
		});
	});

	it("reports bzip2 payloads as unsupported", async () => {
		const archive = buildNcl([
			{ name: "one.bin", content: Buffer.from("bzip2 payload"), method: 3 },
		]);
		const source = new BufferByteSource(archive);
		expect(await uranNclFormat.detect(source, "sample.ncl")).toBe(true);
		const handle = await uranNclFormat.open(source, "sample.ncl");
		const entry = handle.entries[0];
		if (!entry) throw new Error("missing entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(/bzip2/);
		await handle.close();
	});

	it("rejects a file whose extension is not ncl", async () => {
		await expectDeclined(
			buildNcl([{ name: "one.bin", content: Buffer.alloc(4) }]),
			"sample.bin",
		);
	});

	it("rejects a zero name length", async () => {
		const archive = buildNcl([{ name: "one.bin", content: Buffer.alloc(4) }]);
		archive.writeUInt16LE(0, 8);
		await expectDeclined(archive, "sample.ncl");
	});

	it("rejects a name length above the limit", async () => {
		const archive = buildNcl([{ name: "one.bin", content: Buffer.alloc(4) }]);
		archive.writeUInt16LE(0x101, 8);
		await expectDeclined(archive, "sample.ncl");
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildNcl([{ name: "one.bin", content: Buffer.alloc(4) }]);
		archive.writeUInt32LE(0x1000, 0);
		await expectDeclined(archive, "sample.ncl");
	});

	it("rejects an archive without records", async () => {
		await expectDeclined(Buffer.alloc(4), "sample.ncl");
	});

	it("rejects a truncated record header", async () => {
		await expectDeclined(Buffer.alloc(6, 0x41), "sample.ncl");
	});

	it("decodes a payload whose first byte needs the subtraction", async () => {
		// The stored bytes below the stream key wrap around, which the subtraction has to undo.
		const content = Buffer.from([0x00, 0xff, 0x00, 0xaa]);
		const source = new BufferByteSource(
			buildNcl([{ name: "one.bin", content, method: 1 }]),
		);
		const handle = await uranNclFormat.open(source, "sample.ncl");
		const entry = handle.entries[0];
		if (!entry) throw new Error("missing entry");
		expect(await consumeBuffer(await handle.openEntry(entry.id))).toEqual(
			content,
		);
		await handle.close();
	});
});

async function expectDeclined(
	archive: Buffer,
	sourcePath: string,
): Promise<void> {
	const source = new BufferByteSource(archive);
	expect(await uranNclFormat.detect(source, sourcePath)).toBe(false);
}
