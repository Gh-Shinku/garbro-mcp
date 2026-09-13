import { deflateSync } from "node:zlib";
import { encodeCp932 } from "@garbro-mcp/core";
import { zlkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 12;

interface Entry {
	name: string;
	payload: Buffer;
	unpackedSize: number;
	packed: boolean;
}

/** Records vary in length: three words, a flag byte, a name length byte and the name. */
function buildZlk(entries: readonly Entry[]): Buffer {
	const records = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		const header = Buffer.alloc(14);
		header.writeUInt32LE(entry.payload.length, 4);
		header.writeUInt32LE(entry.unpackedSize, 8);
		header.writeUInt8(entry.packed ? 1 : 0, 12);
		header.writeUInt8(name.length, 13);
		return Buffer.concat([header, name]);
	});
	const indexSize = records.reduce((sum, record) => sum + record.length, 0);
	const payloadSize = entries.reduce(
		(sum, entry) => sum + entry.payload.length,
		0,
	);
	const archive = Buffer.alloc(INDEX_OFFSET + indexSize + payloadSize);
	archive.write("ZLK ", 0, "ascii");
	archive.writeInt32LE(1, 4);
	archive.writeInt32LE(entries.length, 8);
	let position = INDEX_OFFSET;
	let data = INDEX_OFFSET + indexSize;
	for (const [id, record] of records.entries()) {
		// The record ships with zeros in its offset field, which is patched to the payload's position.
		record.copy(archive, position);
		archive.writeUInt32LE(data, position);
		entries[id]?.payload.copy(archive, data);
		data += entries[id]?.payload.length ?? 0;
		position += record.length;
	}
	return archive;
}

describe("Nyoken ZLK resource archive", () => {
	it("reads a stored and a deflated entry", async () => {
		const stored = Buffer.from("stored body");
		const expanded = Buffer.from("deflated body");
		const packed = deflateSync(expanded);
		await expectArchive({
			format: zlkFormat,
			archive: buildZlk([
				{
					name: "one.dat",
					payload: stored,
					unpackedSize: stored.length,
					packed: false,
				},
				{
					name: "two.dat",
					payload: packed,
					unpackedSize: expanded.length,
					packed: true,
				},
			]),
			sourcePath: "sample.zlk",
			entries: [
				{ path: "one.dat", size: stored.length, content: stored },
				{ path: "two.dat", size: expanded.length, content: expanded },
			],
		});
	});

	it("rejects a version outside its range", async () => {
		const content = Buffer.from("body");
		const archive = buildZlk([
			{
				name: "one.dat",
				payload: content,
				unpackedSize: content.length,
				packed: false,
			},
		]);
		archive.writeInt32LE(101, 4);
		await expectArchive({
			format: zlkFormat,
			archive,
			sourcePath: "sample.zlk",
			detected: false,
			entries: [],
		});
	});

	it("rejects a zero name length", async () => {
		const content = Buffer.from("body");
		const archive = buildZlk([
			{
				name: "one.dat",
				payload: content,
				unpackedSize: content.length,
				packed: false,
			},
		]);
		archive.writeUInt8(0, INDEX_OFFSET + 13);
		await expectArchive({
			format: zlkFormat,
			archive,
			sourcePath: "sample.zlk",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty entry count", async () => {
		const content = Buffer.from("body");
		const archive = buildZlk([
			{
				name: "one.dat",
				payload: content,
				unpackedSize: content.length,
				packed: false,
			},
		]);
		archive.writeInt32LE(0, 8);
		await expectArchive({
			format: zlkFormat,
			archive,
			sourcePath: "sample.zlk",
			detected: false,
			entries: [],
		});
	});
});
