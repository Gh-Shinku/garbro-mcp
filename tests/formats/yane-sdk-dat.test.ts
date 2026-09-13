import { encodeCp932 } from "@garbro-mcp/core";
import { yaneDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 2;
const NAME_SIZE = 0x22;
const RECORD_SIZE = 0x2c;
const INDEX_KEY = 0x80;

interface YaneEntry {
	name: string;
	content: Buffer;
	encryptedSize?: number;
}

/** GARbro requires every payload to start strictly behind the index, so the fixture pads it. */
const PADDING = 0x10;

function buildYane(entries: readonly YaneEntry[]): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE + PADDING;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeUInt16LE((count ^ 0x8080) & 0xffff, 0);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		const payload = Buffer.from(entry.content);
		const encryptedSize = entry.encryptedSize ?? 0;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt16LE(encryptedSize, record + NAME_SIZE);
		archive.writeUInt32LE(entry.content.length, record + NAME_SIZE + 2);
		archive.writeUInt32LE(offset, record + NAME_SIZE + 6);
		for (let index = 0; index < encryptedSize; index += 1)
			payload[index] = (payload[index] ?? 0) ^ INDEX_KEY;
		payload.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	for (let index = 0; index < count * RECORD_SIZE; index += 1)
		archive[INDEX_OFFSET + index] =
			(archive[INDEX_OFFSET + index] ?? 0) ^ INDEX_KEY;
	return archive;
}

describe("YaneSDK DAT archive", () => {
	it("decrypts the index and obfuscated entry prefixes", async () => {
		const first = Buffer.from("encrypted header + plain body");
		const second = Buffer.from("plain");
		await expectArchive({
			format: yaneDatFormat,
			archive: buildYane([
				{ name: "data/a.bin", content: first, encryptedSize: 8 },
				{ name: "b.bin", content: second },
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "data/a.bin", size: first.length, content: first },
				{ path: "b.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("handles a fully encrypted entry", async () => {
		const content = Buffer.from("all encrypted");
		await expectArchive({
			format: yaneDatFormat,
			archive: buildYane([
				{ name: "a.bin", content, encryptedSize: content.length },
			]),
			sourcePath: "sample.dat",
			entries: [{ path: "a.bin", size: content.length, content }],
		});
	});

	it("rejects an offset inside the index", async () => {
		const archive = buildYane([{ name: "a.bin", content: Buffer.from("a") }]);
		// Store a masked offset of 4, which points back inside the index.
		archive.writeUInt32LE(0x80808084, INDEX_OFFSET + 0x28);
		await expectArchive({
			format: yaneDatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
