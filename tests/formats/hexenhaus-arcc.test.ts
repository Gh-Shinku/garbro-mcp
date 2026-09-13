import { encodeCp932 } from "@garbro-mcp/core";
import { arccFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const COUNT_OFFSET = 0x14;
const NAME_CHUNK_OFFSET = 0x2a;
const FILE_HEADER_SIZE = 0x22;
const NAME_KEY = 0x69;

interface ArccEntry {
	name: string;
	content: Buffer;
}

/** Builds an archive with the NAME/NIDX/EIDX/CINF/ADDR chunk chain GARbro walks. */
function buildArcc(entries: readonly ArccEntry[]): Buffer {
	const count = entries.length;
	const nidxSize = count * 8;
	const eidxSize = count * 8;
	const cinfSize = entries.reduce(
		(sum, entry) => sum + 12 + encodeCp932(entry.name).length,
		0,
	);
	const addrOffset =
		NAME_CHUNK_OFFSET + 0x0e + 4 + nidxSize + 4 + eidxSize + 4 + cinfSize;
	const dataOffset = addrOffset + 4 + count * 12;
	const archive = Buffer.alloc(
		dataOffset +
			entries.reduce(
				(sum, entry) => sum + FILE_HEADER_SIZE + entry.content.length,
				0,
			),
	);
	archive.write("ARCC", 0, "ascii");
	archive.writeInt32LE(count, COUNT_OFFSET);
	archive.write("NAME", NAME_CHUNK_OFFSET, "ascii");
	archive.writeBigInt64LE(BigInt(addrOffset), NAME_CHUNK_OFFSET + 4);
	let position = NAME_CHUNK_OFFSET + 0x0e;
	archive.write("NIDX", position, "ascii");
	position += 4 + nidxSize;
	archive.write("EIDX", position, "ascii");
	position += 4 + eidxSize;
	archive.write("CINF", position, "ascii");
	position += 4;
	for (const entry of entries) {
		const name = encodeCp932(entry.name);
		const start = position;
		archive.writeUInt16LE(name.length, start + 6);
		for (const [index, value] of name.entries())
			archive[start + 10 + index] = value ^ NAME_KEY;
		position += 12 + name.length;
	}
	archive.write("ADDR", addrOffset, "ascii");
	let data = dataOffset;
	for (const [id, entry] of entries.entries()) {
		archive.writeBigInt64LE(BigInt(data), addrOffset + 4 + id * 12 + 2);
		archive.write("FILE", data, "ascii");
		archive.writeUInt32LE(entry.content.length, data + 0x18);
		entry.content.copy(archive, data + FILE_HEADER_SIZE);
		data += FILE_HEADER_SIZE + entry.content.length;
	}
	return archive;
}

describe("Hexenhaus ARCC resource archive", () => {
	it("walks the chunk chain and unwraps FILE records", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second!");
		await expectArchive({
			format: arccFormat,
			archive: buildArcc([
				{ name: "data/one.bin", content: first },
				{ name: "two.bin", content: second },
			]),
			sourcePath: "sample.arc",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("drops records with a zero size", async () => {
		const content = Buffer.from("kept payload");
		const archive = buildArcc([{ name: "a.bin", content }]);
		// Zeroing the size makes GARbro drop the only record.
		archive.writeUInt32LE(
			0,
			archive.length - FILE_HEADER_SIZE - content.length + 0x18,
		);
		await expectArchive({
			format: arccFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("rejects a missing chunk marker", async () => {
		const archive = buildArcc([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.write("NIDY", NAME_CHUNK_OFFSET + 0x0e, "ascii");
		await expectArchive({
			format: arccFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});
});
