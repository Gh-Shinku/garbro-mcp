import {
	aoimyFormat,
	aoimyUnicodeFormat,
	boxFormat,
	xorWithByteKey,
	xorWithOffsetKey,
} from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x18;

interface Entry {
	name: string;
	content: Buffer;
}

/** Versions six and above store names inside the records; the payloads are keyed by a single byte. */
function buildBoxNamed(
	tag: string,
	key: number,
	entries: readonly Entry[],
): Buffer {
	const dataOffset = INDEX_OFFSET + RECORD_SIZE * entries.length;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("AOIB", 0, "ascii");
	archive.write(tag, 4, "latin1");
	archive.writeInt32LE(entries.length, 8);
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.write(entry.name, record, "latin1");
		archive.writeUInt32LE(position, record + 0x10);
		archive.writeUInt32LE(entry.content.length, record + 0x14);
		xorWithByteKey(entry.content, key).copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

/** The older versions use an offset ladder and generate their names. */
function buildBoxLadder(
	tag: string,
	key: number,
	payloads: readonly Buffer[],
): Buffer {
	const tableSize = payloads.length * 4;
	const dataOffset = INDEX_OFFSET + tableSize;
	const archive = Buffer.alloc(
		dataOffset + payloads.reduce((sum, item) => sum + item.length, 0),
	);
	archive.write("AOIB", 0, "ascii");
	archive.write(tag, 4, "latin1");
	archive.writeInt32LE(payloads.length, 8);
	let position = dataOffset;
	const offsets = payloads.map((item) => {
		const offset = position;
		position += item.length;
		return offset;
	});
	// The word at 0x10 is the first offset; one more word follows per entry.
	archive.writeUInt32LE(offsets[0] ?? 0, INDEX_OFFSET);
	for (let id = 1; id < payloads.length; id += 1)
		archive.writeUInt32LE(offsets[id] ?? 0, INDEX_OFFSET + id * 4);
	let write = dataOffset;
	for (const item of payloads) {
		xorWithByteKey(item, key).copy(archive, write);
		write += item.length;
	}
	return archive;
}

/** The newer layouts are big-endian and key each byte by its absolute offset. */
function buildAoimy(
	tag: "Y01\u0000" | "unicode",
	entries: readonly Entry[],
): Buffer {
	const unicode = tag === "unicode";
	const indexOffset = unicode ? 0x14 : INDEX_OFFSET;
	const nameSize = unicode ? 0x20 : 0x10;
	const recordSize = unicode ? 0x28 : 0x18;
	const dataOffset = indexOffset + recordSize * entries.length;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	if (unicode) {
		archive.write("AOIMY01\u0000", 0, "utf16le");
		// The unicode layout keeps its count behind the sixteen-byte tag.
		archive.writeInt32BE(entries.length, 0x10);
	} else {
		archive.write("AOIM", 0, "ascii");
		archive.write("Y01\u0000", 4, "latin1");
		archive.writeInt32BE(entries.length, 8);
	}
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * recordSize;
		if (unicode) archive.write(entry.name, record, "utf16le");
		else archive.write(entry.name, record, "latin1");
		archive.writeUInt32BE(position, record + nameSize);
		archive.writeUInt32BE(entry.content.length, record + nameSize + 4);
		xorWithOffsetKey(entry.content, position).copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

describe("Aoi BOX script archives", () => {
	it("reads the named layout with its version key", async () => {
		const first = Buffer.from("first script");
		const second = Buffer.from("second script");
		await expectArchive({
			format: boxFormat,
			archive: buildBoxNamed("OX6\u0000", 0xb4, [
				{ name: "one.evt", content: first },
				{ name: "two.evt", content: second },
			]),
			sourcePath: "sample.box",
			entries: [
				{ path: "one.evt", size: first.length, content: first },
				{ path: "two.evt", size: second.length, content: second },
			],
		});
	});

	it("reads the ladder layout with generated names", async () => {
		const first = Buffer.from("alpha script");
		const second = Buffer.from("beta script");
		await expectArchive({
			format: boxFormat,
			archive: buildBoxLadder("OX4 ", 0xad, [first, second]),
			sourcePath: "sample.box",
			entries: [
				{ path: "sample#00.evt", size: first.length, content: first },
				{ path: "sample#01.evt", size: second.length, content: second },
			],
		});
	});

	it("reads the newer big-endian layout with offset-keyed payloads", async () => {
		const content = Buffer.from("newer script");
		await expectArchive({
			format: aoimyFormat,
			archive: buildAoimy("Y01\u0000", [{ name: "one.evt", content }]),
			sourcePath: "sample.box",
			entries: [{ path: "one.evt", size: content.length, content }],
		});
	});

	it("reads the unicode layout with a UTF-16 name field", async () => {
		const content = Buffer.from("unicode script");
		await expectArchive({
			format: aoimyUnicodeFormat,
			archive: buildAoimy("unicode", [{ name: "one.evt", content }]),
			sourcePath: "sample.box",
			entries: [{ path: "one.evt", size: content.length, content }],
		});
	});

	it("rejects an unknown version tag", async () => {
		const content = Buffer.from("body");
		const archive = buildBoxNamed("OX9\u0000", 0xb4, [
			{ name: "one.evt", content },
		]);
		await expectArchive({
			format: boxFormat,
			archive,
			sourcePath: "sample.box",
			detected: false,
			entries: [],
		});
	});

	it("rejects a foreign newer tag", async () => {
		const content = Buffer.from("body");
		const archive = buildAoimy("Y01\u0000", [{ name: "one.evt", content }]);
		archive.write("Y02\u0000", 4, "latin1");
		await expectArchive({
			format: aoimyFormat,
			archive,
			sourcePath: "sample.box",
			detected: false,
			entries: [],
		});
	});
});
