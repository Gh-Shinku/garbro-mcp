import { encodeCp932 } from "@garbro-mcp/core";
import { isaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;

interface Entry {
	name: string;
	content: Buffer;
}

/**
 * Records start at 0x10 with a fixed-width name field, then four skipped bytes, the data offset and the
 * size, and every record advances by the name field plus the stride.
 */
function buildIsa(
	entries: readonly Entry[],
	nameLength: number,
	recordLength: number,
	version: number,
): Buffer {
	const recordSize = nameLength + recordLength;
	const dataOffset = INDEX_OFFSET + recordSize * entries.length;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("ISM ", 0, "ascii");
	archive.write("ARCHIVED", 4, "ascii");
	archive.writeInt16LE(entries.length, 0x0c);
	archive.writeUInt16LE(version, 0x0e);
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * recordSize;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(position, record + nameLength + 4);
		archive.writeUInt32LE(entry.content.length, record + nameLength + 8);
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

describe("ISM engine ISA resource archive", () => {
	it("reads the first layout for a version other than one", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: isaFormat,
			archive: buildIsa(
				[
					{ name: "one.isg", content: first },
					{ name: "two.png", content: second },
				],
				0x0c,
				0x14,
				0,
			),
			sourcePath: "sample.isa",
			entries: [
				{ path: "one.isg", size: first.length, content: first },
				{ path: "two.png", size: second.length, content: second },
			],
		});
	});

	it("reads the second layout for version one", async () => {
		const content = Buffer.from("version one body");
		await expectArchive({
			format: isaFormat,
			archive: buildIsa([{ name: "wide.dat", content }], 0x30, 0x10, 1),
			sourcePath: "sample.isa",
			entries: [{ path: "wide.dat", size: content.length, content }],
		});
	});

	it("repairs a truncated audio extension as metadata", async () => {
		const content = Buffer.from("sound body");
		const archive = buildIsa([{ name: "voice.OG", content }], 0x0c, 0x14, 0);
		await expectArchive({
			format: isaFormat,
			archive,
			sourcePath: "sample.isa",
			entries: [{ path: "voice.OG", size: content.length, content }],
		});
	});

	it("rejects a missing marker", async () => {
		const content = Buffer.from("body");
		const archive = buildIsa([{ name: "one.dat", content }], 0x0c, 0x14, 0);
		archive.write("ARCHIVEE", 4, "ascii");
		await expectArchive({
			format: isaFormat,
			archive,
			sourcePath: "sample.isa",
			detected: false,
			entries: [],
		});
	});

	it("rejects a payload outside the file", async () => {
		const content = Buffer.from("body");
		const archive = buildIsa([{ name: "one.dat", content }], 0x0c, 0x14, 0);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + 0x0c + 4);
		await expectArchive({
			format: isaFormat,
			archive,
			sourcePath: "sample.isa",
			detected: false,
			entries: [],
		});
	});
});
