import { encodeCp932 } from "@garbro-mcp/core";
import { advdxPkdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 8;
const KEY_OFFSET = 0x87;
const NAME_SIZE = 0x80;
const RECORD_SIZE = NAME_SIZE + 8;

function buildPkd(
	entries: readonly { name: string; content: Buffer }[],
	key: number,
): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("PACK", 0, "ascii");
	archive.writeInt32LE(count, 4);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + NAME_SIZE);
		archive.writeUInt32LE(offset, record + NAME_SIZE + 4);
		offset += entry.content.length;
		for (const [index, value] of entry.content.entries())
			archive[position + index] = value ^ key;
		position += entry.content.length;
	}
	for (let index = 0; index < count * RECORD_SIZE; index += 1) {
		const at = INDEX_OFFSET + index;
		archive[at] = (archive[at] ?? 0) ^ key;
	}
	// The key itself is stored in the clear inside the first record's name field.
	archive.writeUInt8(key, KEY_OFFSET);
	return archive;
}

describe("AdvDX PKD archive", () => {
	it("decrypts an XOR-encrypted index and payloads", async () => {
		const key = 0x5a;
		await expectArchive({
			format: advdxPkdFormat,
			archive: buildPkd(
				[
					{ name: "one.bin", content: Buffer.from("first payload") },
					{ name: "dir/two.bin", content: Buffer.from("second") },
				],
				key,
			),
			entries: [
				{ path: "one.bin", size: 13, content: Buffer.from("first payload") },
				{ path: "dir/two.bin", size: 6, content: Buffer.from("second") },
			],
			metadata: { entryCount: 2, key },
		});
	});

	it("extracts raw payloads when the key is zero", async () => {
		const content = Buffer.from("plain");
		await expectArchive({
			format: advdxPkdFormat,
			archive: buildPkd([{ name: "a.bin", content }], 0),
			entries: [{ path: "a.bin", size: content.length, content }],
			metadata: { key: 0 },
		});
	});

	it("rejects entries placed outside the archive", async () => {
		const archive = buildPkd([{ name: "a.bin", content: Buffer.from("a") }], 0);
		// Re-encrypt the stored offset field after pointing it far outside the file.
		archive.writeUInt32LE(0x100000, INDEX_OFFSET + NAME_SIZE + 4);
		await expectArchive({
			format: advdxPkdFormat,
			archive,
			detected: false,
			entries: [],
		});
	});
});
