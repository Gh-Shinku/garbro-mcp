import { mcdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const TRAILER_SIZE = 8;
const RECORD_SIZE = 8;

interface McdEntry {
	content: Buffer;
}

function buildMcd(entries: readonly McdEntry[]): Buffer {
	const count = entries.length;
	const indexOffset = 0x10;
	const dataOffset = indexOffset + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset +
			entries.reduce((sum, entry) => sum + entry.content.length, 0) +
			TRAILER_SIZE,
	);
	archive.write("OLH ", 0, "ascii");
	archive.write("for Win", 4, "ascii");
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * RECORD_SIZE;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	const trailer = archive.length - TRAILER_SIZE;
	archive.writeUInt32LE(indexOffset, trailer);
	archive.writeInt32LE(count, trailer + 4);
	return archive;
}

describe("TSD engine MCD resource archive", () => {
	it("reads the trailing index", async () => {
		const first = Buffer.from("BM bitmap data");
		const second = Buffer.from("RIFF audio");
		await expectArchive({
			format: mcdFormat,
			archive: buildMcd([{ content: first }, { content: second }]),
			sourcePath: "sample.mcd",
			entries: [
				{ path: "sample#0000", size: first.length, content: first },
				{ path: "sample#0001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a missing marker", async () => {
		const archive = buildMcd([{ content: Buffer.from("x") }]);
		archive.write("for Lin", 4, "ascii");
		await expectArchive({
			format: mcdFormat,
			archive,
			sourcePath: "sample.mcd",
			detected: false,
			entries: [],
		});
	});

	it("rejects an index beyond the file", async () => {
		const archive = buildMcd([{ content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x1000, archive.length - TRAILER_SIZE);
		await expectArchive({
			format: mcdFormat,
			archive,
			sourcePath: "sample.mcd",
			detected: false,
			entries: [],
		});
	});
});
