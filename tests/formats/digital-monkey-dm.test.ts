import { encodeCp932 } from "@garbro-mcp/core";
import { dmFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x2c;

function buildDm(entries: { name: string; content: Buffer }[]): Buffer {
	const payloads = entries.map((entry) => deflateSync(entry.content));
	const dataOffset = INDEX_OFFSET + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + payloads.reduce((total, payload) => total + payload.length, 0),
	);
	archive.writeInt32LE(entries.length, 0);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(entry.content.length, record + 0x20);
		archive.writeUInt32LE(payload.length, record + 0x24);
		archive.writeUInt32LE(offset, record + 0x28);
		payload.copy(archive, offset);
		offset += payload.length;
	}
	return archive;
}

describe("Digital Monkey DM resource archive", () => {
	it("reads zlib entries and infers the image archive type", async () => {
		const content = Buffer.from("compressed content");
		await expectArchive({
			format: dmFormat,
			archive: buildDm([{ name: "dir\\asset.bin", content }]),
			sourcePath: "image.dm",
			entries: [{ path: "dir/asset.bin", size: content.length, content }],
			metadata: { entryCount: 1 },
		});
	});

	it("requires a dm extension", async () => {
		await expectArchive({
			format: dmFormat,
			archive: buildDm([{ name: "asset.bin", content: Buffer.from("x") }]),
			sourcePath: "image.dat",
			detected: false,
			entries: [],
		});
	});
});
