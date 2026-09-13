import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { yukaYkcFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x18;
const RECORD_SIZE = 0x14;
const SCRIPT_TEXT_OFFSET = 0x24;

/** Builds a script payload whose text is xored behind the header, as the engine stores it. */
function buildScript(text: string): Buffer {
	const encoded = Buffer.from(encodeCp932(text));
	const payload = Buffer.alloc(SCRIPT_TEXT_OFFSET + encoded.length);
	payload.write("YKS001", 0, "latin1");
	payload.writeUInt16LE(1, 6);
	payload.writeUInt32LE(SCRIPT_TEXT_OFFSET, 0x20);
	encoded.copy(payload, SCRIPT_TEXT_OFFSET);
	for (let i = SCRIPT_TEXT_OFFSET; i < payload.length; i += 1)
		payload[i] = (payload[i] ?? 0) ^ 0xaa;
	return payload;
}

interface YkcSource {
	name: Buffer;
	payload: Buffer;
}

function buildYkc(
	version: "01" | "02",
	sources: readonly YkcSource[],
	indexPadding = 0,
): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("YKC0", 0, "latin1");
	header.write(version, 4, "latin1");
	let cursor = HEADER_SIZE;
	const payloads: Buffer[] = [];
	const offsets: number[] = [];
	for (const source of sources) {
		offsets.push(cursor);
		payloads.push(source.payload);
		cursor += source.payload.length;
	}
	const names: Buffer[] = [];
	const nameOffsets: number[] = [];
	for (const source of sources) {
		nameOffsets.push(cursor);
		names.push(source.name);
		cursor += source.name.length;
	}
	const indexOffset = cursor;
	const index = Buffer.alloc(sources.length * RECORD_SIZE + indexPadding);
	for (const [i, source] of sources.entries()) {
		index.writeUInt32LE(nameOffsets[i] ?? 0, i * RECORD_SIZE);
		index.writeUInt32LE(source.name.length, i * RECORD_SIZE + 4);
		index.writeUInt32LE(offsets[i] ?? 0, i * RECORD_SIZE + 8);
		index.writeUInt32LE(source.payload.length, i * RECORD_SIZE + 0xc);
	}
	header.writeUInt32LE(indexOffset, 0x10);
	header.writeUInt32LE(index.length, 0x14);
	return Buffer.concat([header, ...payloads, ...names, index]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	const source = new BufferByteSource(file);
	expect(await yukaYkcFormat.detect(source, "sample.ykc")).toBe(false);
}

describe("Yuka engine resource archive", () => {
	it("lists entries with shift-jis names", async () => {
		const payload = Buffer.from("plain payload");
		const file = buildYkc("01", [
			{ name: Buffer.from("sub/plain.txt", "latin1"), payload },
		]);
		await expectArchive({
			format: yukaYkcFormat,
			sourcePath: "sample.ykc",
			archive: file,
			entries: [
				{ path: "sub/plain.txt", size: payload.length, content: payload },
			],
			metadata: { entryCount: 1 },
		});
	});

	it("lists entries with utf-8 names", async () => {
		const payload = Buffer.from("plain payload");
		const name = "スクリプト/データ.txt";
		await expectArchive({
			format: yukaYkcFormat,
			sourcePath: "sample.ykc",
			archive: buildYkc("02", [{ name: Buffer.from(name, "utf8"), payload }]),
			entries: [{ path: name, size: payload.length, content: payload }],
		});
	});

	it("decrypts a script payload", async () => {
		const payload = buildScript("print(1);\r\n");
		const expected = Buffer.from(payload);
		for (let i = SCRIPT_TEXT_OFFSET; i < expected.length; i += 1)
			expected[i] = (expected[i] ?? 0) ^ 0xaa;
		expected[6] = 0;
		await expectArchive({
			format: yukaYkcFormat,
			sourcePath: "sample.ykc",
			archive: buildYkc("01", [
				{ name: Buffer.from("script.yks", "latin1"), payload },
			]),
			entries: [
				{ path: "script.yks", size: payload.length, content: expected },
			],
		});
	});

	it("leaves a script alone when its version word differs", async () => {
		const payload = buildScript("print(1);\r\n");
		payload.writeUInt16LE(2, 6);
		await expectArchive({
			format: yukaYkcFormat,
			sourcePath: "sample.ykc",
			archive: buildYkc("01", [
				{ name: Buffer.from("script.yks", "latin1"), payload },
			]),
			entries: [{ path: "script.yks", size: payload.length, content: payload }],
		});
	});

	it("leaves a payload alone when it is not a script", async () => {
		const payload = buildScript("print(1);\r\n");
		await expectArchive({
			format: yukaYkcFormat,
			sourcePath: "sample.ykc",
			archive: buildYkc("01", [
				{ name: Buffer.from("script.txt", "latin1"), payload },
			]),
			entries: [{ path: "script.txt", size: payload.length, content: payload }],
		});
	});

	it("ignores trailing bytes that do not fill a record", async () => {
		const payload = Buffer.from("plain payload");
		await expectArchive({
			format: yukaYkcFormat,
			sourcePath: "sample.ykc",
			archive: buildYkc(
				"01",
				[{ name: Buffer.from("plain.txt", "latin1"), payload }],
				6,
			),
			entries: [{ path: "plain.txt", size: payload.length, content: payload }],
		});
	});

	it("rejects a file without a known version word", async () => {
		const file = buildYkc("01", [
			{ name: Buffer.from("plain.txt", "latin1"), payload: Buffer.from("x") },
		]);
		file.write("03", 4, "latin1");
		await expectDeclined(file);
	});

	it("rejects an index that leaves the file", async () => {
		const file = buildYkc("01", [
			{ name: Buffer.from("plain.txt", "latin1"), payload: Buffer.from("x") },
		]);
		file.writeUInt32LE(file.length, 0x14);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildYkc("01", [
			{ name: Buffer.from("plain.txt", "latin1"), payload: Buffer.from("x") },
		]);
		const indexOffset = file.readUInt32LE(0x10);
		file.writeUInt32LE(file.length * 4, indexOffset + 0xc);
		await expectDeclined(file);
	});

	it("rejects a name that leaves the file", async () => {
		const file = buildYkc("01", [
			{ name: Buffer.from("plain.txt", "latin1"), payload: Buffer.from("x") },
		]);
		const indexOffset = file.readUInt32LE(0x10);
		file.writeUInt32LE(file.length * 4, indexOffset);
		await expectDeclined(file);
	});
});
