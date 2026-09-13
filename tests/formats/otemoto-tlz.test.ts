import { encodeCp932 } from "@garbro-mcp/core";
import { tlzFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

const HEADER_SIZE = 0x10;
const RECORD_HEADER_SIZE = 0x10;

function buildTlz(
	entries: { name: string; content: Buffer; packed?: boolean }[],
): Buffer {
	const records = entries.map((entry) => {
		const payload = entry.packed
			? literalLzssStream(entry.content)
			: entry.content;
		return { ...entry, payload, name: encodeCp932(entry.name) };
	});
	const indexSize = records.reduce(
		(total, entry) => total + RECORD_HEADER_SIZE + entry.name.length,
		0,
	);
	const dataOffset = HEADER_SIZE + indexSize;
	const archive = Buffer.alloc(
		dataOffset +
			records.reduce((total, entry) => total + entry.payload.length, 0),
	);
	archive.write("TLZ1", 0, "ascii");
	archive.writeUInt32LE(HEADER_SIZE, 4);
	archive.writeInt32LE(entries.length, 0x0c);
	let indexOffset = HEADER_SIZE;
	let payloadOffset = dataOffset;
	for (const entry of records) {
		archive.writeUInt32LE(entry.content.length, indexOffset);
		archive.writeUInt32LE(entry.payload.length, indexOffset + 4);
		archive.writeUInt32LE(payloadOffset, indexOffset + 8);
		archive.writeUInt32LE(entry.name.length, indexOffset + 0x0c);
		entry.name.copy(archive, indexOffset + RECORD_HEADER_SIZE);
		entry.payload.copy(archive, payloadOffset);
		indexOffset += RECORD_HEADER_SIZE + entry.name.length;
		payloadOffset += entry.payload.length;
	}
	return archive;
}

describe("Otemoto TLZ resource archive", () => {
	it("reads stored and LZSS entries", async () => {
		const packed = Buffer.from("packed data");
		await expectArchive({
			format: tlzFormat,
			archive: buildTlz([
				{ name: "raw.bin", content: Buffer.from("raw") },
				{ name: "dir\\packed.scr", content: packed, packed: true },
			]),
			entries: [
				{ path: "raw.bin", size: 3, content: Buffer.from("raw") },
				{ path: "dir/packed.scr", size: packed.length, content: packed },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a zero-length name", async () => {
		const archive = buildTlz([{ name: "x", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0, HEADER_SIZE + 0x0c);
		await expectArchive({
			format: tlzFormat,
			archive,
			detected: false,
			entries: [],
		});
	});
});
