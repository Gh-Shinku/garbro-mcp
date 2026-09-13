import { encodeCp932 } from "@garbro-mcp/core";
import { cabFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x0c;
const NAME_SIZE = 0x100;
const RECORD_SIZE = NAME_SIZE + 12;

function buildCab(
	entries: readonly {
		name: string;
		content: Buffer;
		unpackedSize?: number;
		offset?: number;
	}[],
): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("Pack", 0, "ascii");
	archive.write("Dat3", 4, "ascii");
	archive.writeInt32LE(count, 8);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.offset ?? offset, record + NAME_SIZE);
		archive.writeUInt32LE(entry.content.length, record + NAME_SIZE + 4);
		archive.writeUInt32LE(
			entry.unpackedSize ?? entry.content.length,
			record + NAME_SIZE + 8,
		);
		offset += entry.content.length;
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

describe("Entertainment Executive PackDat3 archive", () => {
	it("reads 0x100-byte names with stored and unpacked sizes", async () => {
		await expectArchive({
			format: cabFormat,
			archive: buildCab([
				{ name: "graphic.bmp", content: Buffer.from("bmp data") },
				{ name: "音声/voice.dat", content: Buffer.from("voice") },
			]),
			entries: [
				{ path: "graphic.bmp", size: 8, content: Buffer.from("bmp data") },
				{ path: "音声/voice.dat", size: 5, content: Buffer.from("voice") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("keeps the declared unpacked size while extracting raw bytes", async () => {
		const content = Buffer.from("raw payload");
		await expectArchive({
			format: cabFormat,
			archive: buildCab([
				{ name: "packed.bin", content, unpackedSize: content.length * 4 },
			]),
			entries: [{ path: "packed.bin", size: content.length, content }],
		});
	});

	it("rejects a missing format marker", async () => {
		const archive = buildCab([{ name: "a.bin", content: Buffer.from("a") }]);
		archive.write("Dat2", 4, "ascii");
		await expectArchive({
			format: cabFormat,
			archive,
			detected: false,
			entries: [],
		});
	});

	it("rejects entries placed outside the archive", async () => {
		const archive = buildCab([
			{ name: "a.bin", content: Buffer.from("a"), offset: 0x100000 },
		]);
		await expectArchive({
			format: cabFormat,
			archive,
			detected: false,
			entries: [],
		});
	});
});
