import { encodeCp932 } from "@garbro-mcp/core";
import { electriciteitDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x2c;
const NAME_SIZE = 0x10;

interface DatEntry {
	name: string;
	content: Buffer;
}

function buildElectriciteit(entries: readonly DatEntry[]): Buffer {
	const count = entries.length;
	const firstOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		firstOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt32LE(count, 0);
	let offset = firstOffset;
	let position = firstOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x24);
		archive.writeUInt32LE(entry.content.length, record + 0x28);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

describe("Electriciteit DAT resource archive", () => {
	it("reads 0x2c-byte records", async () => {
		const first = Buffer.from("first resource");
		const second = Buffer.from("second");
		await expectArchive({
			format: electriciteitDatFormat,
			archive: buildElectriciteit([
				{ name: "data/one.bin", content: first },
				{ name: "two.bin", content: second },
			]),
			sourcePath: "sound.dat",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("flags bitmap archives", async () => {
		const content = Buffer.from("bitmap");
		await expectArchive({
			format: electriciteitDatFormat,
			archive: buildElectriciteit([{ name: "a.bin", content }]),
			sourcePath: "bg.dat",
			entries: [{ path: "a.bin", size: content.length, content }],
		});
	});

	it("rejects a payload inside the index", async () => {
		const archive = buildElectriciteit([
			{ name: "a.bin", content: Buffer.from("x") },
		]);
		archive.writeUInt32LE(INDEX_OFFSET, INDEX_OFFSET + 0x24);
		await expectArchive({
			format: electriciteitDatFormat,
			archive,
			sourcePath: "sound.dat",
			detected: false,
			entries: [],
		});
	});

	it("requires the dat extension", async () => {
		await expectArchive({
			format: electriciteitDatFormat,
			archive: buildElectriciteit([
				{ name: "a.bin", content: Buffer.from("x") },
			]),
			sourcePath: "sound.bin",
			detected: false,
			entries: [],
		});
	});
});
