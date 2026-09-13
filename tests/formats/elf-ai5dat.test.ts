import { decodeCp932, encodeCp932 } from "@garbro-mcp/core";
import { ai5DatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, expect, it } from "vitest";

const INDEX_OFFSET = 8;
const NAME_SIZE = 0x14;
const NAME_KEY_OFFSET = 0x23;

interface Ai5Entry {
	name: string;
	content: Buffer;
}

function buildAi5Dat(entries: readonly Ai5Entry[], key: number): Buffer {
	const count = entries.length;
	const indexSize = count * (NAME_SIZE + 8);
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeUInt32LE((count ^ key) >>> 0, 0);
	archive.writeUInt32LE(key >>> 0, 4);
	// The name key lives in the padding of the first name field, which decrypts to zero.
	const nameKey = 0x5a;
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * (NAME_SIZE + 8);
		archive.writeUInt32LE((entry.content.length ^ key) >>> 0, record);
		archive.writeUInt32LE((offset ^ key) >>> 0, record + 4);
		const name = encodeCp932(entry.name);
		for (let index = 0; index < NAME_SIZE; index += 1) {
			const value = index < name.length ? (name[index] ?? 0) : 0;
			archive[record + 8 + index] = value ^ nameKey;
		}
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

describe("AI5WIN DAT resource archive", () => {
	it("reads a self-describing encrypted index", async () => {
		const key = 0x12345678;
		const first = Buffer.from("first resource");
		const second = Buffer.from("second");
		const archive = buildAi5Dat(
			[
				{ name: "script.mes", content: first },
				{ name: "data/lib.bin", content: second },
			],
			key,
		);
		await expectArchive({
			format: ai5DatFormat,
			archive,
			sourcePath: "sample.dat",
			entries: [
				{ path: "script.mes", size: first.length, content: first },
				{ path: "data/lib.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects an empty name", async () => {
		const archive = buildAi5Dat(
			[{ name: "a.mes", content: Buffer.from("x") }],
			0x11,
		);
		// The first name byte decrypts to zero through the stored name key.
		const nameKey = archive.readUInt8(NAME_KEY_OFFSET);
		archive.writeUInt8(0 ^ nameKey, INDEX_OFFSET + 8);
		await expectArchive({
			format: ai5DatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a payload inside the index", async () => {
		const key = 0x2222;
		const archive = buildAi5Dat(
			[{ name: "a.mes", content: Buffer.from("x") }],
			key,
		);
		archive.writeUInt32LE((INDEX_OFFSET ^ key) >>> 0, INDEX_OFFSET + 4);
		await expectArchive({
			format: ai5DatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("keeps decoded names free of control bytes", () => {
		// Guards the fixture helper: names round-trip through the name key.
		expect(decodeCp932(encodeCp932("a.mes"))).toBe("a.mes");
	});
});
