import { encodeCp932 } from "@garbro-mcp/core";
import { witchDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 8;

interface WitchEntry {
	name: string;
	content: Buffer;
	width?: number;
	height?: number;
}

function buildWitch(entries: readonly WitchEntry[]): Buffer {
	const records = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		const header = Buffer.alloc(4 + name.length + 16);
		header.writeUInt32LE(name.length, 0);
		name.copy(header, 4);
		header.writeUInt32LE(entry.width ?? 32, 4 + name.length);
		header.writeUInt32LE(entry.height ?? 24, 4 + name.length + 4);
		return header;
	});
	const dataOffset =
		INDEX_OFFSET + records.reduce((sum, record) => sum + record.length, 0);
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeUInt32LE(0x00144b4d, 0);
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	let position = INDEX_OFFSET;
	for (const [id, entry] of entries.entries()) {
		const record = records[id];
		if (!record) continue;
		const nameLength = record.readUInt32LE(0);
		record.writeUInt32LE(entry.content.length, 4 + nameLength + 8);
		record.writeUInt32LE(offset, 4 + nameLength + 12);
		record.copy(archive, position);
		position += record.length;
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Witch DAT resource archive", () => {
	it("reads image records with dimensions and payload ranges", async () => {
		const first = Buffer.from("pcd raw data");
		const second = Buffer.from("second image");
		await expectArchive({
			format: witchDatFormat,
			archive: buildWitch([
				{ name: "cg/first.pcd", content: first, width: 640, height: 480 },
				{ name: "second.pcd", content: second },
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "cg/first.pcd", size: first.length, content: first },
				{ path: "second.pcd", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a zero name length", async () => {
		const archive = buildWitch([{ name: "a.pcd", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0, INDEX_OFFSET);
		await expectArchive({
			format: witchDatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects entries placed outside the file", async () => {
		const archive = buildWitch([{ name: "a.pcd", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x100000, INDEX_OFFSET + 4 + 4 + 12);
		await expectArchive({
			format: witchDatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
