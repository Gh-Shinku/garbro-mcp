import { encodeCp932 } from "@garbro-mcp/core";
import { mgdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x22;
const NAME_KEY = Buffer.from("Powerd by Masys", "ascii");

interface MgdEntry {
	name: string;
	content: Buffer;
}

function buildMgd(entries: readonly MgdEntry[], encrypted = false): Buffer {
	const records = entries.map((entry) => {
		const name = Buffer.from(encodeCp932(entry.name));
		if (encrypted) {
			for (let position = 0; position < name.length; position += 1)
				name[position] =
					(name[position] ?? 0) ^ (NAME_KEY[position % 0x0f] ?? 0);
		}
		const header = Buffer.alloc(2 + name.length);
		header.writeUInt8(0, 0);
		header.writeUInt8(name.length, 1);
		name.copy(header, 2);
		return Buffer.concat([header, Buffer.alloc(8)]);
	});
	const dataOffset =
		INDEX_OFFSET + records.reduce((sum, record) => sum + record.length, 0);
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("MGD", 0, "ascii");
	archive.writeUInt16LE(encrypted ? 100 : 0, 3);
	archive.writeInt16LE(entries.length, 0x20);
	let position = INDEX_OFFSET;
	let offset = dataOffset;
	for (const [id, record] of records.entries()) {
		const entry = entries[id];
		if (!entry) continue;
		const nameSize = record.readUInt8(1);
		record.writeUInt32LE(entry.content.length, 2 + nameSize);
		record.writeUInt32LE(offset, 2 + nameSize + 4);
		record.copy(archive, position);
		position += record.length;
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Masys MGD resource archive", () => {
	it("reads length-prefixed name records", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second");
		await expectArchive({
			format: mgdFormat,
			archive: buildMgd([
				{ name: "data/one.bin", content: first },
				{ name: "two.bin", content: second },
			]),
			sourcePath: "sample.mgd",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("decrypts names when the flag is 100", async () => {
		const content = Buffer.from("encrypted names");
		await expectArchive({
			format: mgdFormat,
			archive: buildMgd([{ name: "secret/file.bin", content }], true),
			sourcePath: "sample.mgd",
			entries: [{ path: "secret/file.bin", size: content.length, content }],
		});
	});

	it("rejects a zero name length", async () => {
		const archive = buildMgd([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt8(0, INDEX_OFFSET + 1);
		await expectArchive({
			format: mgdFormat,
			archive,
			sourcePath: "sample.mgd",
			detected: false,
			entries: [],
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildMgd([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.write("XGD", 0, "ascii");
		await expectArchive({
			format: mgdFormat,
			archive,
			sourcePath: "sample.mgd",
			detected: false,
			entries: [],
		});
	});
});
