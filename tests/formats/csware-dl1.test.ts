import { encodeCp932 } from "@garbro-mcp/core";
import { dl1Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const DATA_OFFSET = 0x10;
const NAME_SIZE = 0xc;
const RECORD_SIZE = NAME_SIZE + 4;

interface Entry {
	name: string;
	stored: Buffer;
	unpackedSize: number;
}

/**
 * Payloads follow the header in index order, so their offsets are the running sum of the stored sizes,
 * and the index sits behind them.
 */
function buildDl1(entries: readonly Entry[]): Buffer {
	const payloadSize = entries.reduce(
		(sum, entry) => sum + entry.stored.length,
		0,
	);
	const indexOffset = DATA_OFFSET + payloadSize;
	const archive = Buffer.alloc(indexOffset + RECORD_SIZE * entries.length);
	archive.write("DL1.0", 0, "ascii");
	archive.writeUInt8(0x1a, 5);
	archive.writeInt16LE(entries.length, 8);
	archive.writeUInt32LE(indexOffset, 0xa);
	let data = DATA_OFFSET;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.stored.length, record + NAME_SIZE);
		entry.stored.copy(archive, data);
		data += entry.stored.length;
	}
	return archive;
}

describe("C's ware DL1 resource archive", () => {
	it("reads sequential payloads and decodes LZ payloads", async () => {
		const plain = Buffer.from("plain body");
		// LZ marker, three bytes of padding, the unpacked size, then an LZSS stream.
		const stream = Buffer.from([0x01, 0x41, 0xee, 0xf1]);
		const packed = Buffer.concat([
			Buffer.from("LZ"),
			Buffer.alloc(4),
			Buffer.from([5, 0, 0, 0]),
			stream,
		]);
		await expectArchive({
			format: dl1Format,
			archive: buildDl1([
				{ name: "one.dat", stored: plain, unpackedSize: plain.length },
				{ name: "two.dat", stored: packed, unpackedSize: 5 },
			]),
			sourcePath: "sample.dl1",
			entries: [
				{ path: "one.dat", size: plain.length, content: plain },
				{ path: "two.dat", size: 5, content: Buffer.from("AAAAA") },
			],
		});
	});

	it("rejects a foreign header", async () => {
		const archive = buildDl1([
			{ name: "one.dat", stored: Buffer.from("x"), unpackedSize: 1 },
		]);
		archive.write("DL1.1", 0, "ascii");
		await expectArchive({
			format: dl1Format,
			archive,
			sourcePath: "sample.dl1",
			detected: false,
			entries: [],
		});
	});

	it("rejects an index offset beyond the file", async () => {
		const archive = buildDl1([
			{ name: "one.dat", stored: Buffer.from("x"), unpackedSize: 1 },
		]);
		archive.writeUInt32LE(archive.length + 4, 0xa);
		await expectArchive({
			format: dl1Format,
			archive,
			sourcePath: "sample.dl1",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty entry count", async () => {
		const archive = buildDl1([
			{ name: "one.dat", stored: Buffer.from("x"), unpackedSize: 1 },
		]);
		archive.writeInt16LE(0, 8);
		await expectArchive({
			format: dl1Format,
			archive,
			sourcePath: "sample.dl1",
			detected: false,
			entries: [],
		});
	});
});
