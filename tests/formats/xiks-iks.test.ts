import { encodeCp932 } from "@garbro-mcp/core";
import { iksFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x28;
const PAYLOAD_KEY = 0x66;

interface IksEntry {
	name: string;
	content: Buffer;
}

function xor(data: Buffer): Buffer {
	const result = Buffer.from(data);
	for (const [index, value] of data.entries())
		result[index] = (value ?? 0) ^ PAYLOAD_KEY;
	return result;
}

function buildIks(entries: readonly IksEntry[]): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("NPSR", 0, "ascii");
	archive.writeInt32LE(count, 4);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		const name = encodeCp932(entry.name);
		archive.writeUInt8(name.length, record);
		name.copy(archive, record + 1);
		archive.writeUInt32LE(entry.content.length, record + 0x1c);
		archive.writeUInt32LE(offset, record + 0x20);
		xor(entry.content).copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

describe("X[iks] IKS archive", () => {
	it("reads 0x28-byte records and XOR-decrypts payloads", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second");
		await expectArchive({
			format: iksFormat,
			archive: buildIks([
				{ name: "data/one.bin", content: first },
				{ name: "音声.bin", content: second },
			]),
			sourcePath: "game.dat",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "音声.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("caps the name length at 0x17 bytes and stops at a NUL terminator", async () => {
		const content = Buffer.from("x");
		const archive = buildIks([{ name: "a.bin", content }]);
		// Claim a longer name than the record allows; GARbro clamps the field to 0x17 bytes.
		archive.writeUInt8(0x40, INDEX_OFFSET);
		await expectArchive({
			format: iksFormat,
			archive,
			sourcePath: "game.dat",
			entries: [{ path: "a.bin", size: content.length, content }],
		});
	});

	it("rejects a payload that overlaps the index", async () => {
		const archive = buildIks([{ name: "a.bin", content: Buffer.from("a") }]);
		archive.writeUInt32LE(0x10, INDEX_OFFSET + 0x20);
		await expectArchive({
			format: iksFormat,
			archive,
			sourcePath: "game.dat",
			detected: false,
			entries: [],
		});
	});
});
