import { cgdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x10;

interface CgdEntry {
	content: Buffer;
	width: number;
	height: number;
	bpp: number;
	compression: number;
}

function buildCgd(entries: readonly CgdEntry[]): Buffer {
	const dataOffset = INDEX_OFFSET + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("spiel100", 0, "ascii");
	archive.writeInt32LE(entries.length, 8);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		archive.writeUInt16LE(entry.width, record + 8);
		archive.writeUInt16LE(entry.height, record + 0x0a);
		archive.writeUInt8(entry.bpp, record + 0x0e);
		archive.writeUInt8(entry.compression, record + 0x0f);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

describe("Spiel CGD image collection", () => {
	it("reads image records with their metadata", async () => {
		const first = Buffer.from("cgd one");
		const second = Buffer.from("cgd two!");
		await expectArchive({
			format: cgdFormat,
			archive: buildCgd([
				{ content: first, width: 640, height: 480, bpp: 24, compression: 1 },
				{ content: second, width: 320, height: 240, bpp: 32, compression: 2 },
			]),
			sourcePath: "sample.cgd",
			entries: [
				{ path: "sample#0000", size: first.length, content: first },
				{ path: "sample#0001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildCgd([
			{
				content: Buffer.from("x"),
				width: 1,
				height: 1,
				bpp: 8,
				compression: 0,
			},
		]);
		archive.write("spiel101", 0, "ascii");
		await expectArchive({
			format: cgdFormat,
			archive,
			sourcePath: "sample.cgd",
			detected: false,
			entries: [],
		});
	});

	it("rejects entries placed outside the file", async () => {
		const archive = buildCgd([
			{
				content: Buffer.from("x"),
				width: 1,
				height: 1,
				bpp: 8,
				compression: 0,
			},
		]);
		archive.writeUInt32LE(0x100000, INDEX_OFFSET + 4);
		await expectArchive({
			format: cgdFormat,
			archive,
			sourcePath: "sample.cgd",
			detected: false,
			entries: [],
		});
	});
});
