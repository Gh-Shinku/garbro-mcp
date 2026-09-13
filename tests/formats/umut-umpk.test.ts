import { encodeCp932 } from "@garbro-mcp/core";
import { umpkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, expect, it } from "vitest";

const NAME_LENGTH_OFFSET = 0x18;
const HEADER_NAME_BIAS = 0x1a;
const DATA_BIAS = 8;

/** Mirrors the key fold of GARbro `PakOpener.GetEntryKey`, without the zero substitution. */
function rawEntryKey(name: string, size: number, id: number): number {
	let nameSum = 0;
	for (let position = 0; position < name.length; position += 1)
		nameSum += name.charCodeAt(position);
	let key = (size + id) >>> 0;
	key = (key + nameSum + (key >>> 8) + (key >>> 16) + (key >>> 24)) >>> 0;
	return key & 0xff;
}

/** GARbro substitutes 0x37 whenever the folded key is zero. */
function entryKey(name: string, size: number, id: number): number {
	return rawEntryKey(name, size, id) || 0x37;
}

interface UmpkEntry {
	name: string;
	content: Buffer;
	id?: number;
}

function buildUmpk(entries: readonly UmpkEntry[], headerName = "um"): Buffer {
	const baseOffset = HEADER_NAME_BIAS + encodeCp932(headerName).length;
	const records = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		const record = Buffer.alloc(20 + name.length);
		record.writeUInt32LE(16 + name.length, 0);
		record.writeUInt32LE(entry.content.length, 4);
		record.writeUInt32LE(0, 8);
		record.writeUInt32LE(entry.id ?? 0, 12);
		record.writeUInt32LE(name.length, 16);
		name.copy(record, 20);
		return record;
	});
	const recordTotal = records.reduce((sum, record) => sum + record.length, 0);
	const dataOffset = baseOffset + 12 + recordTotal;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("UMPK", 0, "ascii");
	archive.write("0001", 4, "ascii");
	archive.writeUInt8(encodeCp932(headerName).length, NAME_LENGTH_OFFSET);
	encodeCp932(headerName).copy(archive, HEADER_NAME_BIAS);
	archive.writeInt32LE(entries.length, baseOffset + 8);
	let position = baseOffset + 12;
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = records[index];
		if (!record) continue;
		// The stored offset is relative to the end of the file header.
		record.writeUInt32LE(offset - DATA_BIAS - baseOffset, 8);
		record.copy(archive, position);
		position += record.length;
		const key = entryKey(entry.name, entry.content.length, entry.id ?? 0);
		const payload = Buffer.from(entry.content);
		for (let byte = 0; byte < payload.length; byte += 1)
			payload[byte] = (payload[byte] ?? 0) ^ key;
		payload.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("UM Utility UMPK audio archive", () => {
	it("reads variable-length records and XOR-decrypts payloads", async () => {
		const first = Buffer.from("RIFF first");
		const second = Buffer.from("RIFF second!");
		await expectArchive({
			format: umpkFormat,
			archive: buildUmpk([
				{ name: "bgm01.wav", content: first, id: 7 },
				{ name: "se02.wav", content: second, id: 9 },
			]),
			sourcePath: "sample.pak",
			entries: [
				{ path: "bgm01.wav", size: first.length, content: first },
				{ path: "se02.wav", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("keeps the fallback key path working", async () => {
		const content = Buffer.from("payload");
		// Find an id whose derived key folds to zero, which makes GARbro use 0x37.
		let id = 0;
		while (id < 0x1000 && rawEntryKey("a.wav", content.length, id) !== 0)
			id += 1;
		expect(id).toBeLessThan(0x1000);
		await expectArchive({
			format: umpkFormat,
			archive: buildUmpk([{ name: "a.wav", content, id }]),
			sourcePath: "sample.pak",
			entries: [{ path: "a.wav", size: content.length, content }],
		});
	});

	it("rejects a non-zero reserved word", async () => {
		const archive = buildUmpk([{ name: "a.wav", content: Buffer.from("x") }]);
		archive.writeUInt32LE(1, HEADER_NAME_BIAS + 2);
		await expectArchive({
			format: umpkFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});
});
