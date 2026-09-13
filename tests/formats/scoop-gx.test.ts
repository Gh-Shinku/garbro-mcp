import { deflateSync } from "node:zlib";
import { encodeCp932 } from "@garbro-mcp/core";
import { gxFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x12;

interface Entry {
	name: string;
	payload: Buffer;
	unpackedSize: number;
	compression: number;
}

/**
 * Builds the index, a name table inside the index region, and the payloads behind it. Each record
 * carries a compression word, the name offset, and the offset, stored size and unpacked size words.
 */
function buildGx(entries: readonly Entry[]): Buffer {
	const indexEnd = INDEX_OFFSET + RECORD_SIZE * entries.length;
	const names = Buffer.concat(
		entries.map((entry) =>
			Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
		),
	);
	const indexSize = indexEnd + names.length;
	const dataOffset = indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.payload.length, 0),
	);
	archive.write("PARROT1.0", 0, "ascii");
	archive.writeUInt16LE(entries.length, 0xa);
	archive.writeUInt32LE(indexSize, 0xc);
	let nameOffset = indexEnd;
	let data = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt16LE(entry.compression, record);
		archive.writeUInt32LE(nameOffset, record + 2);
		archive.writeUInt32LE(data, record + 6);
		archive.writeUInt32LE(entry.payload.length, record + 0xa);
		archive.writeUInt32LE(entry.unpackedSize, record + 0xe);
		entry.payload.copy(archive, data);
		data += entry.payload.length;
		nameOffset += (entries[id]?.name.length ?? 0) + 1;
	}
	names.copy(archive, indexEnd);
	return archive;
}

describe("Scoop GX resource archive", () => {
	it("reads stored and zlib entries", async () => {
		const plain = Buffer.from("plain body");
		const unpacked = Buffer.from("inflated contents");
		const packed = deflateSync(unpacked);
		await expectArchive({
			format: gxFormat,
			archive: buildGx([
				{
					name: "one.dat",
					payload: plain,
					unpackedSize: plain.length,
					compression: 0,
				},
				{
					name: "two.dat",
					payload: packed,
					unpackedSize: unpacked.length,
					compression: 3,
				},
			]),
			sourcePath: "sample.gx",
			entries: [
				{ path: "one.dat", size: plain.length, content: plain },
				{ path: "two.dat", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("rejects a foreign header", async () => {
		const archive = buildGx([
			{
				name: "one.dat",
				payload: Buffer.from("x"),
				unpackedSize: 1,
				compression: 0,
			},
		]);
		archive.write("PARROT1.1", 0, "ascii");
		await expectArchive({
			format: gxFormat,
			archive,
			sourcePath: "sample.gx",
			detected: false,
			entries: [],
		});
	});

	it("rejects a name offset beyond the index size", async () => {
		const archive = buildGx([
			{
				name: "one.dat",
				payload: Buffer.from("x"),
				unpackedSize: 1,
				compression: 0,
			},
		]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + 2);
		await expectArchive({
			format: gxFormat,
			archive,
			sourcePath: "sample.gx",
			detected: false,
			entries: [],
		});
	});

	it("rejects records that do not fit the index size", async () => {
		const archive = buildGx([
			{
				name: "one.dat",
				payload: Buffer.from("x"),
				unpackedSize: 1,
				compression: 0,
			},
		]);
		archive.writeUInt32LE(INDEX_OFFSET, 0xc);
		await expectArchive({
			format: gxFormat,
			archive,
			sourcePath: "sample.gx",
			detected: false,
			entries: [],
		});
	});
});
