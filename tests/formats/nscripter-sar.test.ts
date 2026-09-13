import { encodeCp932 } from "@garbro-mcp/core";
import { nscripterSarFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 6;

interface Entry {
	name: string;
	content: Buffer;
}

/** The header and every record field are big-endian, and names are plain null-terminated bytes. */
function buildSar(entries: readonly Entry[]): Buffer {
	const names = entries.map((entry) =>
		Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
	);
	const indexSize = names.reduce((sum, name) => sum + name.length + 8, 0);
	const baseOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		baseOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt16BE(entries.length, 0);
	archive.writeUInt32BE(baseOffset, 2);
	let position = INDEX_OFFSET;
	let data = baseOffset;
	for (const [id, entry] of entries.entries()) {
		const name = names[id] ?? Buffer.alloc(0);
		name.copy(archive, position);
		position += name.length;
		archive.writeUInt32BE(data - baseOffset, position);
		archive.writeUInt32BE(entry.content.length, position + 4);
		position += 8;
		entry.content.copy(archive, data);
		data += entry.content.length;
	}
	return archive;
}

describe("NScripter SAR resource archive", () => {
	it("reads big-endian records with plain names", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: nscripterSarFormat,
			archive: buildSar([
				{ name: "one.txt", content: first },
				{ name: "two.txt", content: second },
			]),
			sourcePath: "sample.sar",
			entries: [
				{ path: "one.txt", size: first.length, content: first },
				{ path: "two.txt", size: second.length, content: second },
			],
		});
	});

	it("rejects an empty entry count", async () => {
		const archive = buildSar([{ name: "one.txt", content: Buffer.from("x") }]);
		archive.writeInt16BE(0, 0);
		await expectArchive({
			format: nscripterSarFormat,
			archive,
			sourcePath: "sample.sar",
			detected: false,
			entries: [],
		});
	});

	it("rejects a payload start that is too small for the count", async () => {
		const archive = buildSar([{ name: "one.txt", content: Buffer.from("x") }]);
		archive.writeUInt32BE(INDEX_OFFSET, 2);
		await expectArchive({
			format: nscripterSarFormat,
			archive,
			sourcePath: "sample.sar",
			detected: false,
			entries: [],
		});
	});

	it("rejects an entry whose payload leaves the file", async () => {
		const archive = buildSar([{ name: "one.txt", content: Buffer.from("x") }]);
		// The size word follows the name, so point it well past the end.
		const sizeOffset = INDEX_OFFSET + encodeCp932("one.txt").length + 1 + 4;
		archive.writeUInt32BE(0x1000, sizeOffset);
		await expectArchive({
			format: nscripterSarFormat,
			archive,
			sourcePath: "sample.sar",
			detected: false,
			entries: [],
		});
	});
});
