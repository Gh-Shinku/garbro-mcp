import { encodeCp932 } from "@garbro-mcp/core";
import { morningTtdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

const KEY = 0x12345678;
const INDEX_OFFSET = 0x14;
const RECORD_SIZE = 0x2c;

function buildTtd(
	entries: { name: string; content: Buffer; packed?: boolean }[],
): Buffer {
	const payloads = entries.map((entry) =>
		entry.packed
			? Buffer.concat([
					Buffer.from("DSFF0000", "ascii"),
					literalLzssStream(entry.content),
				])
			: entry.content,
	);
	const dataOffset = INDEX_OFFSET + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + payloads.reduce((total, value) => total + value.length, 0),
	);
	archive.write(".FRC", 0, "ascii");
	archive.writeUInt32LE(KEY, 4);
	archive.writeInt32LE(entries.length, 0x0c);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(payload.length, record);
		archive.writeUInt32LE(offset, record + 4);
		encodeCp932(entry.name).copy(archive, record + 12);
		payload.copy(archive, offset);
		offset += payload.length;
	}
	for (let offset = INDEX_OFFSET; offset < dataOffset; offset += 4)
		archive.writeUInt32LE(archive.readUInt32LE(offset) ^ KEY, offset);
	return archive;
}

describe("Morning TTD resource archive", () => {
	it("decrypts the index and expands DSFF LZSS entries", async () => {
		const packed = Buffer.from("packed");
		await expectArchive({
			format: morningTtdFormat,
			archive: buildTtd([
				{ name: "raw.bin", content: Buffer.from("raw") },
				{ name: "dir\\packed.bin", content: packed, packed: true },
			]),
			entries: [
				{ path: "raw.bin", size: 3, content: Buffer.from("raw") },
				{
					path: "dir/packed.bin",
					size: literalLzssStream(packed).length + 8,
					content: packed,
				},
			],
			metadata: { entryCount: 2 },
		});
	});
});
