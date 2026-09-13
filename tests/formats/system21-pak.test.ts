import { encodeCp932 } from "@garbro-mcp/core";
import { system21PakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const OLD_SIGNATURE = Buffer.from([0x8f, 0xad, 0x8f, 0x97]);
const NEW_SIGNATURE = Buffer.from([0x89, 0xf5, 0x8a, 0x79]);
const INDEX_OFFSET = 12;

interface Entry {
	name: string;
	content: Buffer;
}

/**
 * Records are a fixed-width name field plus a stored size, and payloads follow each other from the data
 * offset the header announces.
 */
function buildPak(
	entries: readonly Entry[],
	nameSize: number,
	signature: Buffer,
): Buffer {
	const stride = nameSize + 4;
	const dataOffset = INDEX_OFFSET + stride * entries.length;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	signature.copy(archive, 0);
	archive.writeUInt32LE(dataOffset, 4);
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * stride;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + nameSize);
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

describe("System21 PAK resource archive", () => {
	it("reads the new signature with the narrowest name field", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: system21PakFormat,
			archive: buildPak(
				[
					{ name: "one.dat", content: first },
					{ name: "two.dat", content: second },
				],
				0x14,
				NEW_SIGNATURE,
			),
			sourcePath: "sample.pak",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("reads the old signature with the widest name field", async () => {
		const content = Buffer.from("old style body");
		await expectArchive({
			format: system21PakFormat,
			archive: buildPak([{ name: "wide.dat", content }], 0x64, OLD_SIGNATURE),
			sourcePath: "sample.pak",
			entries: [{ path: "wide.dat", size: content.length, content }],
		});
	});

	it("falls through to a wider field when the narrow one does not divide", async () => {
		// A single 0x34-wide record makes the index 0x38 bytes long, which 0x18 cannot divide.
		const content = Buffer.from("middle width body");
		await expectArchive({
			format: system21PakFormat,
			archive: buildPak([{ name: "mid.dat", content }], 0x34, NEW_SIGNATURE),
			sourcePath: "sample.pak",
			entries: [{ path: "mid.dat", size: content.length, content }],
		});
	});

	it("rejects a foreign signature", async () => {
		const content = Buffer.from("body");
		const archive = buildPak(
			[{ name: "one.dat", content }],
			0x14,
			NEW_SIGNATURE,
		);
		archive.writeUInt32LE(0x12345678, 0);
		await expectArchive({
			format: system21PakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty index", async () => {
		const content = Buffer.from("body");
		const archive = buildPak(
			[{ name: "one.dat", content }],
			0x14,
			NEW_SIGNATURE,
		);
		archive.writeUInt32LE(INDEX_OFFSET, 4);
		await expectArchive({
			format: system21PakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});
});
