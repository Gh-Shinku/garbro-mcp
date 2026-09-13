import { BufferByteSource } from "@garbro-mcp/core";
import { umeSoftPkFormat, unpackUmePkEntry } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const RECORD_OVERHEAD = 14;
const SIZE_FIELD_OFFSET = 7;
const TRAILER_SIZE = 4;
const XOR_KEY = 0x42;

/** Encodes a payload with literal tokens only, one control byte per eight bytes. */
function encodeLiterals(content: Buffer): Buffer {
	const parts: number[] = [];
	for (let offset = 0; offset < content.length; offset += 8) {
		parts.push(0x00, ...content.subarray(offset, offset + 8));
	}
	return Buffer.from(parts);
}

interface Entry {
	name: string;
	content: Buffer;
	/** Stored payload when it differs from the extracted one. */
	stored?: Buffer;
}

/** Builds records: length byte, name, six skipped bytes, stored size and absolute payload offset. */
function buildRecords(
	entries: readonly Entry[],
	offsets: readonly number[],
	sizes: readonly number[],
): Buffer {
	const parts: Buffer[] = [];
	for (const [id, entry] of entries.entries()) {
		const nameBytes = Buffer.from(entry.name, "latin1");
		const record = Buffer.alloc(nameBytes.length + 1 + RECORD_OVERHEAD);
		record[0] = nameBytes.length;
		nameBytes.copy(record, 1);
		record.writeUInt32LE(sizes[id] ?? 0, nameBytes.length + SIZE_FIELD_OFFSET);
		record.writeUInt32LE(
			offsets[id] ?? 0,
			nameBytes.length + SIZE_FIELD_OFFSET + 4,
		);
		parts.push(record);
	}
	return Buffer.concat(parts);
}

/** Builds an archive whose payloads precede the index, which the trailer then measures. */
function buildPk(entries: readonly Entry[]): Buffer {
	const payloads = entries.map((entry) => entry.stored ?? entry.content);
	const offsets: number[] = [];
	let cursor = 0;
	for (const payload of payloads) {
		offsets.push(cursor);
		cursor += payload.length;
	}
	const records = buildRecords(
		entries,
		offsets,
		payloads.map((payload) => payload.length),
	);
	const index = Buffer.concat([records, Buffer.from([0])]);
	const payloadRegion = Buffer.concat(payloads);
	const archive = Buffer.alloc(
		payloadRegion.length + index.length + TRAILER_SIZE,
	);
	payloadRegion.copy(archive, 0);
	index.copy(archive, payloadRegion.length);
	archive.writeUInt32LE(index.length, payloadRegion.length + index.length);
	return archive;
}

describe("U-Me Soft PK resources archive", () => {
	it("decodes literals and overlapped matches", () => {
		// One literal `A` followed by a distance-one match of length three; the match token uses the
		// second control bit, so the control byte is 0b01000000.
		const stream = Buffer.from([0x40, 0x41, 0x10, 0x00]);
		expect(unpackUmePkEntry(stream, 4).toString("latin1")).toBe("AAAA");
	});

	it("reads stored entries", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const archive = buildPk([
			{ name: "first.bin", content: first },
			{ name: "second.bin", content: second },
		]);
		await expectArchive({
			format: umeSoftPkFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "first.bin", size: first.length, content: first },
				{ path: "second.bin", size: second.length, content: second },
			],
		});
	});

	it("decodes and deobfuscates script payloads", async () => {
		const content = Buffer.from("script text");
		const masked = Buffer.from(content);
		for (let index = 0; index < masked.length; index += 1)
			masked[index] = (masked[index] ?? 0) ^ XOR_KEY;
		const prefix = Buffer.alloc(4);
		prefix.writeInt32LE(content.length, 0);
		const archive = buildPk([
			{
				name: "script.scr",
				content,
				stored: Buffer.concat([prefix, encodeLiterals(masked)]),
			},
		]);
		await expectArchive({
			format: umeSoftPkFormat,
			archive,
			entries: [{ path: "script.scr", size: content.length, content }],
		});
	});

	it("leaves a script with a non-positive size untouched", async () => {
		const content = Buffer.from("plain script");
		const prefix = Buffer.alloc(4);
		prefix.writeInt32LE(0, 0);
		const stored = Buffer.concat([prefix, content]);
		const archive = buildPk([{ name: "script.scr", content, stored }]);
		await expectArchive({
			format: umeSoftPkFormat,
			archive,
			entries: [{ path: "script.scr", size: stored.length, content: stored }],
		});
	});

	it("rejects an archive without a usable index size", async () => {
		const archive = buildPk([
			{ name: "first.bin", content: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0, archive.length - TRAILER_SIZE);
		const source = new BufferByteSource(archive);
		expect(await umeSoftPkFormat.detect(source)).toBe(false);
	});

	it("rejects an index larger than the file", async () => {
		const archive = buildPk([
			{ name: "first.bin", content: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(archive.length, archive.length - TRAILER_SIZE);
		const source = new BufferByteSource(archive);
		expect(await umeSoftPkFormat.detect(source)).toBe(false);
	});

	it("rejects a payload that does not end before its record", async () => {
		const content = Buffer.from("payload");
		const archive = buildPk([{ name: "first.bin", content }]);
		// The record starts behind the payload region, so point the entry at the index instead.
		const sizePosition =
			content.length + 1 + "first.bin".length + SIZE_FIELD_OFFSET;
		archive.writeUInt32LE(content.length + 8, sizePosition + 4);
		const source = new BufferByteSource(archive);
		expect(await umeSoftPkFormat.detect(source)).toBe(false);
	});
});
