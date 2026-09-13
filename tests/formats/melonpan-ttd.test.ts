import { encodeCp932 } from "@garbro-mcp/core";
import { ttdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 12;
const NAME_LENGTH = 0x10;
const RECORD_SIZE = 0xc + NAME_LENGTH;

interface Entry {
	name: string;
	stored: Buffer;
	unpackedSize: number;
}

/**
 * The index holds fixed-width records whose names follow their size and offset words, and each entry's
 * offset word points at its payload. The first offset fixes the name width.
 */
function buildTtd(entries: readonly Entry[]): Buffer {
	const dataOffset = INDEX_OFFSET + RECORD_SIZE * entries.length;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.stored.length, 0),
	);
	archive.writeUInt32LE(0x00574357, 0);
	archive.writeInt32LE(entries.length, 4);
	let data = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt32LE(entry.stored.length, record);
		archive.writeUInt32LE(data, record + 4);
		encodeCp932(entry.name).copy(archive, record + 0xc);
		entry.stored.copy(archive, data);
		data += entry.stored.length;
	}
	return archive;
}

describe("Melonpan TTD resource archive", () => {
	it("reads stored payloads and decodes DSFF payloads", async () => {
		const plain = Buffer.from("plain body");
		// A DSFF header, the unpacked size, then an LZSS stream with a raised ring position.
		const stream = Buffer.from([0x01, 0x41, 0xf0, 0xf1]);
		const packed = Buffer.concat([
			Buffer.from("DSFF"),
			Buffer.from([5, 0, 0, 0]),
			stream,
		]);
		await expectArchive({
			format: ttdFormat,
			archive: buildTtd([
				{ name: "plain.dat", stored: plain, unpackedSize: plain.length },
				{ name: "packed.dat", stored: packed, unpackedSize: 5 },
			]),
			sourcePath: "sample.ttd",
			entries: [
				{ path: "plain.dat", size: plain.length, content: plain },
				{ path: "packed.dat", size: 5, content: Buffer.from("AAAAA") },
			],
		});
	});

	it("rejects a signature with a non-zero fourth byte", async () => {
		const archive = buildTtd([
			{ name: "a.dat", stored: Buffer.from("x"), unpackedSize: 1 },
		]);
		archive.writeUInt32LE(0x01574357, 0);
		await expectArchive({
			format: ttdFormat,
			archive,
			sourcePath: "sample.ttd",
			detected: false,
			entries: [],
		});
	});

	it("rejects a name width below the minimum", async () => {
		const archive = buildTtd([
			{ name: "a.dat", stored: Buffer.from("x"), unpackedSize: 1 },
		]);
		// Claim a first offset that leaves fewer than eight name bytes.
		archive.writeInt32LE(INDEX_OFFSET, INDEX_OFFSET + 4);
		await expectArchive({
			format: ttdFormat,
			archive,
			sourcePath: "sample.ttd",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty entry count", async () => {
		const archive = buildTtd([
			{ name: "a.dat", stored: Buffer.from("x"), unpackedSize: 1 },
		]);
		archive.writeInt32LE(0, 4);
		await expectArchive({
			format: ttdFormat,
			archive,
			sourcePath: "sample.ttd",
			detected: false,
			entries: [],
		});
	});
});
