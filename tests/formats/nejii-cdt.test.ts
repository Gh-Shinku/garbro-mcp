import { encodeCp932 } from "@garbro-mcp/core";
import { nejiiCdtFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const NAME_SIZE = 0x10;
const RECORD_SIZE = NAME_SIZE + 0x10;
const TRAILER_SIZE = 12;

interface Entry {
	name: string;
	stored: Buffer;
	unpackedSize: number;
	packed: boolean;
}

/** The index sits behind the payloads and the twelve-byte trailer closes the file. */
function buildCdt(entries: readonly Entry[]): Buffer {
	const dataOffset = 0x10;
	const payloadSize = entries.reduce(
		(sum, entry) => sum + entry.stored.length,
		0,
	);
	const indexOffset = dataOffset + payloadSize;
	const archive = Buffer.alloc(
		indexOffset + RECORD_SIZE * entries.length + TRAILER_SIZE,
	);
	archive.writeUInt32LE(indexOffset, archive.length - 4);
	archive.writeInt32LE(entries.length, archive.length - 8);
	archive.write("RK1\0", archive.length - 12, "latin1");
	let data = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.stored.length, record + NAME_SIZE);
		archive.writeUInt32LE(entry.unpackedSize, record + NAME_SIZE + 4);
		archive.writeInt32LE(entry.packed ? 1 : 0, record + NAME_SIZE + 8);
		archive.writeUInt32LE(data, record + NAME_SIZE + 12);
		entry.stored.copy(archive, data);
		data += entry.stored.length;
	}
	return archive;
}

describe("NEJII engine CDT archive", () => {
	it("reads the trailer, plain payloads and LZSS payloads", async () => {
		const plain = Buffer.from("plain body");
		// With the default LZSS settings this literal-and-match stream decodes to five 'A' characters.
		const stream = Buffer.from([0x01, 0x41, 0xee, 0xf1]);
		await expectArchive({
			format: nejiiCdtFormat,
			archive: buildCdt([
				{
					name: "one.dat",
					stored: plain,
					unpackedSize: plain.length,
					packed: false,
				},
				{ name: "two.dat", stored: stream, unpackedSize: 5, packed: true },
			]),
			sourcePath: "sample.cdt",
			entries: [
				{ path: "one.dat", size: plain.length, content: plain },
				{ path: "two.dat", size: 5, content: Buffer.from("AAAAA") },
			],
		});
	});

	it("rejects a foreign trailer", async () => {
		const archive = buildCdt([
			{
				name: "one.dat",
				stored: Buffer.from("x"),
				unpackedSize: 1,
				packed: false,
			},
		]);
		archive.write("RK2\0", archive.length - 12, "latin1");
		await expectArchive({
			format: nejiiCdtFormat,
			archive,
			sourcePath: "sample.cdt",
			detected: false,
			entries: [],
		});
	});

	it("rejects an index offset beyond the file", async () => {
		const archive = buildCdt([
			{
				name: "one.dat",
				stored: Buffer.from("x"),
				unpackedSize: 1,
				packed: false,
			},
		]);
		archive.writeUInt32LE(archive.length + 4, archive.length - 4);
		await expectArchive({
			format: nejiiCdtFormat,
			archive,
			sourcePath: "sample.cdt",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty entry count", async () => {
		const archive = buildCdt([
			{
				name: "one.dat",
				stored: Buffer.from("x"),
				unpackedSize: 1,
				packed: false,
			},
		]);
		archive.writeInt32LE(0, archive.length - 8);
		await expectArchive({
			format: nejiiCdtFormat,
			archive,
			sourcePath: "sample.cdt",
			detected: false,
			entries: [],
		});
	});
});
