import { encodeCp932 } from "@garbro-mcp/core";
import { ykFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const HEADER_SIZE = 0x18;
const RECORD_SIZE = 12;

function rotateRight(value: number, count: number): number {
	const shift = count & 7;
	return ((value >>> shift) | (value << (8 - shift))) & 0xff;
}

/** Inverse of the port's key-derived rotation. */
function encryptData(data: Buffer, key: number): void {
	for (let position = 0; position < data.length; position += 1) {
		const shift =
			Math.imul(Math.imul(Math.imul(92, key), position), position + key) >>> 0;
		data[position] = rotateRight(data[position] ?? 0, 7 - (shift % 7));
	}
}

interface YkEntry {
	id: number;
	name: string;
	content: Buffer;
}

function buildNames(entries: readonly YkEntry[]): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const id = Buffer.alloc(4);
		id.writeInt32LE(entry.id, 0);
		parts.push(id, Buffer.from(encodeCp932(entry.name)), Buffer.from([0]));
	}
	return Buffer.concat(parts);
}

function buildYk(entries: readonly YkEntry[], key: number): Buffer {
	const names = buildNames(entries);
	const namesStored = Buffer.from(names);
	if (key !== 0) encryptData(namesStored, key);
	const records = [
		{ id: 0, content: namesStored },
		...entries.map((entry) => ({
			id: entry.id,
			content: (() => {
				const payload = Buffer.from(entry.content);
				if (key !== 0) encryptData(payload, key);
				return payload;
			})(),
		})),
	];
	const count = records.length;
	const indexSize = count * RECORD_SIZE;
	const dataOffset = HEADER_SIZE + indexSize;
	const archive = Buffer.alloc(
		dataOffset +
			records.reduce((sum, record) => sum + record.content.length, 0),
	);
	archive.writeInt32LE(key, 0x10);
	archive.writeInt32LE(count, 0x14);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [index, record] of records.entries()) {
		const entry = index * RECORD_SIZE + HEADER_SIZE;
		archive.writeInt32LE(record.id, entry);
		archive.writeUInt32LE(offset, entry + 4);
		archive.writeUInt32LE(record.content.length, entry + 8);
		record.content.copy(archive, position);
		offset += record.content.length;
		position += record.content.length;
	}
	return archive;
}

describe("Rune YK resource archive", () => {
	it("reads the id index and decrypts payloads", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second!");
		await expectArchive({
			format: ykFormat,
			archive: buildYk(
				[
					{ id: 1, name: "data/one.bin", content: first },
					{ id: 2, name: "two.bin", content: second },
				],
				0x1234,
			),
			sourcePath: "sample.yk",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2, key: 0x1234 },
		});
	});

	it("leaves unencrypted archives untouched", async () => {
		const content = Buffer.from("plain payload");
		await expectArchive({
			format: ykFormat,
			archive: buildYk([{ id: 1, name: "a.bin", content }], 0),
			sourcePath: "sample.yk",
			entries: [{ path: "a.bin", size: content.length, content }],
			metadata: { key: 0 },
		});
	});

	it("rejects a non-zero header prefix", async () => {
		const archive = buildYk(
			[{ id: 1, name: "a.bin", content: Buffer.from("x") }],
			0,
		);
		archive.writeInt32LE(1, 0);
		await expectArchive({
			format: ykFormat,
			archive,
			sourcePath: "sample.yk",
			detected: false,
			entries: [],
		});
	});
});
