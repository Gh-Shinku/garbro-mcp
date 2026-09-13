import { xuseBinFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x10;

function buildXuseBin(entries: readonly Buffer[]): Buffer {
	const dataOffset = INDEX_OFFSET + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.length, 0),
	);
	archive.writeUInt32LE(1, 0);
	archive.writeUInt32LE(dataOffset, 8);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt32LE(entry.length, record);
		archive.writeUInt32LE(offset, record + 4);
		entry.copy(archive, position);
		offset += entry.length;
		position += entry.length;
	}
	return archive;
}

describe("Xuse audio archive", () => {
	it("walks 0x10-byte records with generated stems", async () => {
		const first = Buffer.from("audio one");
		const second = Buffer.from("audio two!");
		await expectArchive({
			format: xuseBinFormat,
			archive: buildXuseBin([first, second]),
			sourcePath: "se.bin",
			entries: [
				{ path: "se#0000", size: first.length, content: first },
				{ path: "se#0001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("stops at a zero offset", async () => {
		const archive = buildXuseBin([Buffer.from("aa"), Buffer.from("bb")]);
		// Zero the second record's offset: the walk must stop after the first entry.
		archive.writeUInt32LE(0, INDEX_OFFSET + RECORD_SIZE + 4);

		await expectArchive({
			format: xuseBinFormat,
			archive,
			sourcePath: "se.bin",
			entries: [{ path: "se#0000", size: 2, content: Buffer.from("aa") }],
		});
	});

	it("rejects a non-increasing offset", async () => {
		const archive = buildXuseBin([Buffer.from("aa"), Buffer.from("bb")]);
		// Repeat the first data offset, which GARbro rejects as non-monotonic.
		archive.writeUInt32LE(
			INDEX_OFFSET + RECORD_SIZE * 2,
			INDEX_OFFSET + RECORD_SIZE + 4,
		);
		await expectArchive({
			format: xuseBinFormat,
			archive,
			sourcePath: "se.bin",
			detected: false,
			entries: [],
		});
	});
});
