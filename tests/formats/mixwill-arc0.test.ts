import { encodeCp932 } from "@garbro-mcp/core";
import { arc0Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const COUNT_OFFSET = 0x10004;
const INDEX_OFFSET = 0x10008;
const NAME_SIZE = 0x100;
const RECORD_SIZE = NAME_SIZE + 8;

interface Arc0Entry {
	name: string;
	content: Buffer;
}

function maskName(name: string): Buffer {
	const field = Buffer.alloc(NAME_SIZE);
	encodeCp932(name).copy(field, 0);
	for (let position = 0; position < NAME_SIZE; position += 1)
		field[position] = (field[position] ?? 0) ^ (position & 0xff);
	return field;
}

function buildArc0(entries: readonly Arc0Entry[]): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("ARC0", 0, "ascii");
	archive.writeInt32LE(count, COUNT_OFFSET);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		maskName(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + NAME_SIZE);
		archive.writeUInt32LE(offset, record + NAME_SIZE + 4);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

describe("Mixwill ARC0 archive", () => {
	it("unmasks position-XORed names", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second");
		await expectArchive({
			format: arc0Format,
			archive: buildArc0([
				{ name: "graphic/a.bmp", content: first },
				{ name: "b.wav", content: second },
			]),
			sourcePath: "sample.arc",
			entries: [
				{ path: "graphic/a.bmp", size: first.length, content: first },
				{ path: "b.wav", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects an empty name", async () => {
		const archive = buildArc0([{ name: "a.bmp", content: Buffer.from("a") }]);
		// The first masked byte decodes to zero, which GARbro rejects as an empty name.
		archive[INDEX_OFFSET] = 0;
		await expectArchive({
			format: arc0Format,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("rejects entries placed outside the file", async () => {
		const archive = buildArc0([{ name: "a.bmp", content: Buffer.from("a") }]);
		archive.writeUInt32LE(0x100000, INDEX_OFFSET + NAME_SIZE + 4);
		await expectArchive({
			format: arc0Format,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});
});
