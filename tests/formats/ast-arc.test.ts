import { BufferByteSource } from "@garbro-mcp/core";
import { astArcFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

interface Entry {
	name: string;
	/** Unpacked content; the index's unpacked size field. */
	content: Buffer;
	/** Stored bytes; defaults to the content. */
	stored?: Buffer;
}

/** Version 2 masks every name byte with 0xFF. */
function maskName(name: string): Buffer {
	const bytes = Buffer.from(name, "latin1");
	for (let index = 0; index < bytes.length; index += 1)
		bytes[index] = (bytes[index] ?? 0) ^ 0xff;
	return bytes;
}

/**
 * Builds an ARC1/ARC2 archive. The first record's offset precedes the record fields, and every later
 * record follows its predecessor at `9 + nameLength` bytes, so payload offsets are written into the
 * *next* record's leading field.
 */
function buildAst(version: 1 | 2, entries: readonly Entry[]): Buffer {
	const names = entries.map((entry) => {
		const raw =
			version === 2 ? maskName(entry.name) : Buffer.from(entry.name, "latin1");
		return raw;
	});
	const recordSizes = names.map((name) => 9 + name.length);
	const tableSize = 4 + recordSizes.reduce((total, size) => total + size, 0);
	const payloadStart = 4 + tableSize;
	// Stored bytes and offsets.
	const stored = entries.map((entry) => entry.stored ?? entry.content);
	const offsets: number[] = [];
	let running = payloadStart;
	for (const payload of stored) {
		offsets.push(running);
		running += payload.length;
	}

	const archive = Buffer.alloc(running);
	archive.write(`ARC${version}`, 0, "latin1");
	archive.writeInt32LE(entries.length, 4);
	// Each record starts with its own payload offset, so the first one sits at 0x08.
	let cursor = 8;
	for (const [index, entry] of entries.entries()) {
		archive.writeUInt32LE(offsets[index] ?? 0, cursor);
		archive.writeUInt32LE(entry.content.length, cursor + 4);
		const name = names[index] ?? Buffer.alloc(0);
		archive.writeUInt8(name.length, cursor + 8);
		name.copy(archive, cursor + 9);
		cursor += 9 + name.length;
	}
	let payloadOffset = payloadStart;
	for (const payload of stored) {
		payload.copy(archive, payloadOffset);
		payloadOffset += payload.length;
	}
	return archive;
}

describe("AST script engine resource archive", () => {
	it("lists version 2 entries and un-masks their payloads", async () => {
		const first = Buffer.from("plain payload");
		// A PNG stored exclusively-ored with 0xFF, which the opener detects by its signature.
		const png = Buffer.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2,
		]);
		const storedPng = Buffer.from(png);
		for (let index = 0; index < storedPng.length; index += 1)
			storedPng[index] = (storedPng[index] ?? 0) ^ 0xff;
		await expectArchive({
			format: astArcFormat,
			archive: buildAst(2, [
				{ name: "FIRST.BIN", content: first },
				{ name: "ICON.PNG", content: png, stored: storedPng },
			]),
			sourcePath: "sample.arc",
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "ICON.PNG", size: png.length, content: png },
			],
		});
	});

	it("unpacks LZSS payloads of version 2", async () => {
		const content = Buffer.from("compressible content, repeatable content");
		// The opener decodes the stored LZSS stream and then exclusive-ors the result, so the stored
		// stream carries the masked bytes.
		const masked = Buffer.from(content);
		for (let index = 0; index < masked.length; index += 1)
			masked[index] = (masked[index] ?? 0) ^ 0xff;
		// The record reports the unpacked size, which differs from the stored size.
		await expectArchive({
			format: astArcFormat,
			archive: buildAst(2, [
				{ name: "PACKED.BIN", content, stored: literalLzssStream(masked) },
			]),
			sourcePath: "sample.arc",
			entries: [{ path: "PACKED.BIN", size: content.length, content }],
		});
	});

	it("returns version 1 payloads as stored", async () => {
		const content = Buffer.from("version one content");
		await expectArchive({
			format: astArcFormat,
			archive: buildAst(1, [{ name: "PLAIN.BIN", content }]),
			sourcePath: "sample.arc",
			entries: [{ path: "PLAIN.BIN", size: content.length, content }],
		});
	});

	it("keeps a packed version 1 payload as stored", async () => {
		const content = Buffer.from("version one payload");
		const stored = Buffer.from(literalLzssStream(content));
		// Sizes differ, so the reference marks the entry as packed, but only version 2 decodes it.
		await expectArchive({
			format: astArcFormat,
			archive: buildAst(1, [{ name: "RAW.BIN", content, stored }]),
			sourcePath: "sample.arc",
			entries: [{ path: "RAW.BIN", size: stored.length, content: stored }],
		});
	});

	it("skips placeholder records", async () => {
		const content = Buffer.from("kept payload");
		const archive = buildAst(2, [
			{ name: "KEPT.BIN", content },
			{ name: "SKIPPED.BIN", content: Buffer.from("dropped") },
		]);
		// A record whose offset is zero is a placeholder; the second record starts behind the first.
		archive.writeUInt32LE(0, 8 + 9 + "KEPT.BIN".length);
		await expectArchive({
			format: astArcFormat,
			archive,
			sourcePath: "sample.arc",
			entries: [{ path: "KEPT.BIN", size: content.length, content: content }],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildAst(2, [{ name: "A.BIN", content: Buffer.from("x") }]);
		archive.write("ARCX", 0, "latin1");
		expect(
			await astArcFormat.detect(new BufferByteSource(archive), "sample.arc"),
		).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildAst(2, [{ name: "A.BIN", content: Buffer.from("x") }]);
		archive.writeInt32LE(0x40000, 4);
		expect(
			await astArcFormat.detect(new BufferByteSource(archive), "sample.arc"),
		).toBe(false);
	});

	it("rejects offsets that do not increase", async () => {
		const archive = buildAst(2, [
			{ name: "A.BIN", content: Buffer.from("first") },
			{ name: "B.BIN", content: Buffer.from("second") },
		]);
		// The second record's leading word is the second payload's offset; make it smaller.
		archive.writeUInt32LE(4, 8 + 9 + "A.BIN".length);
		expect(
			await astArcFormat.detect(new BufferByteSource(archive), "sample.arc"),
		).toBe(false);
	});

	it("rejects a name that reaches past the archive", async () => {
		const archive = buildAst(2, [{ name: "A.BIN", content: Buffer.from("x") }]);
		archive.writeUInt8(0x40, 8 + 8);
		expect(
			await astArcFormat.detect(new BufferByteSource(archive), "sample.arc"),
		).toBe(false);
	});

	it("rejects a file that is too small for its header", async () => {
		expect(
			await astArcFormat.detect(
				new BufferByteSource(Buffer.alloc(4)),
				"sample.arc",
			),
		).toBe(false);
	});
});
