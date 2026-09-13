import { encodeCp932 } from "@garbro-mcp/core";
import { mugiBinFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const OFFSET_TABLE_OFFSET = 0x8000;
const SIZE_TABLE_OFFSET = 0xa000;
const INDEX_SIZE = 0xc000;

interface Entry {
	name: string;
	stored: Buffer;
	unpackedSize: number;
}

/**
 * Lays out the fixed index region: names from 0, the offset table at 0x8000 and the unpacked sizes at
 * 0xA000. The table ends with the file size, which also bounds the last entry.
 */
function buildMugi(entries: readonly Entry[]): Buffer {
	const offsets: number[] = [INDEX_SIZE];
	let data = INDEX_SIZE;
	for (const entry of entries) {
		data += entry.stored.length;
		offsets.push(data);
	}
	const archive = Buffer.alloc(data);
	// The first offset must equal the index size, and the table closes with the file size.
	offsets[0] = INDEX_SIZE;
	for (const [id, entry] of entries.entries()) {
		encodeCp932(entry.name).copy(archive, id * 0x10);
		archive.writeUInt32LE(offsets[id] ?? 0, OFFSET_TABLE_OFFSET + id * 4);
		archive.writeUInt32LE(entry.unpackedSize, SIZE_TABLE_OFFSET + id * 4);
	}
	// The terminating word holds the end of the last payload.
	archive.writeUInt32LE(
		archive.length,
		OFFSET_TABLE_OFFSET + entries.length * 4,
	);
	let position = INDEX_SIZE;
	for (const entry of entries) {
		entry.stored.copy(archive, position);
		position += entry.stored.length;
	}
	return archive;
}

describe("Mugi's BIN resource archive", () => {
	it("reads plain and packed entries from the fixed index", async () => {
		const plain = Buffer.from("plain body");
		// With the default LZSS settings this literal-and-match stream decodes to five 'A' characters.
		const stream = Buffer.from([0x01, 0x41, 0xee, 0xf1]);
		await expectArchive({
			format: mugiBinFormat,
			archive: buildMugi([
				{ name: "one.dat", stored: plain, unpackedSize: plain.length },
				{ name: "two.dat", stored: stream, unpackedSize: 5 },
			]),
			sourcePath: "sample.bin",
			entries: [
				{ path: "one.dat", size: plain.length, content: plain },
				{ path: "two.dat", size: 5, content: Buffer.from("AAAAA") },
			],
		});
	});

	it("rejects a first offset that is not the index size", async () => {
		const plain = Buffer.from("plain body");
		const archive = buildMugi([
			{ name: "one.dat", stored: plain, unpackedSize: plain.length },
		]);
		archive.writeUInt32LE(INDEX_SIZE + 4, OFFSET_TABLE_OFFSET);
		await expectArchive({
			format: mugiBinFormat,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a decreasing offset", async () => {
		const plain = Buffer.from("plain body");
		const archive = buildMugi([
			{ name: "one.dat", stored: plain, unpackedSize: plain.length },
			{ name: "two.dat", stored: plain, unpackedSize: plain.length },
		]);
		// A value below the first offset violates the non-decreasing requirement.
		archive.writeUInt32LE(INDEX_SIZE - 4, OFFSET_TABLE_OFFSET + 4);
		await expectArchive({
			format: mugiBinFormat,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a file that is only the index region", async () => {
		await expectArchive({
			format: mugiBinFormat,
			archive: Buffer.alloc(INDEX_SIZE),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
