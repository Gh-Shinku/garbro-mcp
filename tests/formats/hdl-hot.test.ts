import { hotFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const HEADER_SIZE = 0x20;

function buildHot(entries: readonly Buffer[]): Buffer {
	// Payloads start behind the 0x20-byte header and the offset table closes the file.
	const dataOffset = HEADER_SIZE;
	const tableOffset =
		dataOffset + entries.reduce((sum, entry) => sum + entry.length, 0);
	const archive = Buffer.alloc(tableOffset + entries.length * 4);
	archive.write("HOT", 0, "ascii");
	archive.writeUInt32LE(tableOffset, 8);
	archive.writeInt32LE(entries.length, 0x0c);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		// The table stores offsets relative to the 0x20-byte header.
		archive.writeUInt32LE(offset - HEADER_SIZE, tableOffset + id * 4);
		entry.copy(archive, position);
		offset += entry.length;
		position += entry.length;
	}
	return archive;
}

describe("HDL HOT archive", () => {
	it("derives sizes from the trailing offset table", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second");
		const archive = buildHot([first, second]);
		// The last entry runs to the end of the offset table, so its payload covers the table bytes.
		const lastSize = second.length + 8;
		await expectArchive({
			format: hotFormat,
			archive,
			sourcePath: "sample.dat",
			entries: [
				{ path: "sample#00000", size: first.length, content: first },
				{
					path: "sample#00001",
					size: lastSize,
					content: archive.subarray(archive.length - lastSize),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a reserved word that is not zero", async () => {
		const archive = buildHot([Buffer.from("x")]);
		archive.writeUInt32LE(1, 4);
		await expectArchive({
			format: hotFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects an offset table beyond the file", async () => {
		const archive = buildHot([Buffer.from("x")]);
		archive.writeInt32LE(0x1000, 0x0c);
		await expectArchive({
			format: hotFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
