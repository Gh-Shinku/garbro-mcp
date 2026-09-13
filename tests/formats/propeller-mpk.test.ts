import { encodeCp932 } from "@garbro-mcp/core";
import { propellerMpkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x20;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x28;

interface MpkEntry {
	name: string;
	content: Buffer;
	xorScript?: boolean;
}

function buildMpk(entries: readonly MpkEntry[], key: number): Buffer {
	const dataOffset = INDEX_OFFSET + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeUInt32LE(INDEX_OFFSET, 0);
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + NAME_SIZE);
		archive.writeUInt32LE(entry.content.length, record + NAME_SIZE + 4);
		for (const [index, value] of entry.content.entries())
			archive[position + index] = entry.xorScript ? value ^ 0x88 : value;
		offset += entry.content.length;
		position += entry.content.length;
	}
	for (let index = 0; index < entries.length * RECORD_SIZE; index += 1) {
		const at = INDEX_OFFSET + index;
		archive[at] = (archive[at] ?? 0) ^ key;
	}
	// The key is stored in the clear in the last byte of the first name field.
	archive.writeUInt8(key, INDEX_OFFSET + NAME_SIZE - 1);
	return archive;
}

describe("Propeller MPK archive", () => {
	it("decrypts the index and leaves regular entries untouched", async () => {
		const key = 0x3d;
		await expectArchive({
			format: propellerMpkFormat,
			archive: buildMpk(
				[
					{ name: "data\\file.bin", content: Buffer.from("payload") },
					{ name: "script\\main.msc", content: Buffer.from("plain script") },
				],
				key,
			),
			sourcePath: "sample.bin",
			entries: [
				{ path: "data/file.bin", size: 7, content: Buffer.from("payload") },
				{
					path: "script/main.msc",
					size: 12,
					content: Buffer.from("plain script"),
				},
			],
			metadata: { entryCount: 2, key },
		});
	});

	it("de-obfuscates .msc payloads whose stored first byte is 0x88", async () => {
		// The engine stores obfuscated scripts XORed with 0x88, so a plaintext leading zero byte
		// shows up as the 0x88 marker that GARbro tests for.
		const script = Buffer.concat([
			Buffer.from([0]),
			Buffer.from("secret script body"),
		]);
		await expectArchive({
			format: propellerMpkFormat,
			archive: buildMpk(
				[{ name: "main.msc", content: script, xorScript: true }],
				0x21,
			),
			sourcePath: "sample.bin",
			entries: [{ path: "main.msc", size: script.length, content: script }],
		});
	});

	it("rejects an index that does not fit the file", async () => {
		const archive = buildMpk([{ name: "a.bin", content: Buffer.from("a") }], 0);
		archive.writeInt32LE(0x1000, 4);
		await expectArchive({
			format: propellerMpkFormat,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
