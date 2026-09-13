import { encodeCp932 } from "@garbro-mcp/core";
import { minkGrpFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 8;
const NAME_SIZE = 0x18;
const RECORD_SIZE = 0x20;

interface GrpEntry {
	name: string;
	content: Buffer;
}

function buildGrp(entries: readonly GrpEntry[]): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt32LE(count, 0);
	archive.writeUInt32LE(INDEX_OFFSET, 4);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + NAME_SIZE);
		archive.writeUInt32LE(entry.content.length, record + NAME_SIZE + 4);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

/** Builds a MADSCR script payload with the given id and body. */
function script(id: number, body: Buffer): Buffer {
	const payload = Buffer.concat([
		Buffer.from("MADSCR", "ascii"),
		Buffer.alloc(0x1a),
		body,
	]);
	payload.writeUInt16LE(id, 8);
	return payload;
}

describe("Mink GRP archive", () => {
	it("reads 0x20-byte records from the index offset", async () => {
		const first = Buffer.from("plain data");
		const second = Buffer.from("more");
		await expectArchive({
			format: minkGrpFormat,
			archive: buildGrp([
				{ name: "data/a.bin", content: first },
				{ name: "b.bin", content: second },
			]),
			sourcePath: "sample.grp",
			entries: [
				{ path: "data/a.bin", size: first.length, content: first },
				{ path: "b.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("XOR-decrypts known MADSCR scripts behind their header", async () => {
		const plain = script(0x7e83, Buffer.from("decrypted body"));
		const stored = Buffer.from(plain);
		for (let position = 0x20; position < stored.length; position += 1)
			stored[position] = (stored[position] ?? 0) ^ 0x66;
		await expectArchive({
			format: minkGrpFormat,
			archive: buildGrp([{ name: "scene.msc", content: stored }]),
			sourcePath: "sample.grp",
			entries: [{ path: "scene.msc", size: stored.length, content: plain }],
		});
	});

	it("leaves unknown script ids untouched", async () => {
		const payload = script(0x1234, Buffer.from("plain body"));
		await expectArchive({
			format: minkGrpFormat,
			archive: buildGrp([{ name: "scene.msc", content: payload }]),
			sourcePath: "sample.grp",
			entries: [{ path: "scene.msc", size: payload.length, content: payload }],
		});
	});

	it("rejects blank names", async () => {
		const archive = buildGrp([{ name: "a.bin", content: Buffer.from("a") }]);
		archive.fill(0, INDEX_OFFSET, INDEX_OFFSET + NAME_SIZE);
		await expectArchive({
			format: minkGrpFormat,
			archive,
			sourcePath: "sample.grp",
			detected: false,
			entries: [],
		});
	});
});
