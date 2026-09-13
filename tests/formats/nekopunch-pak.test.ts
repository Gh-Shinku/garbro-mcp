import { encodeCp932 } from "@garbro-mcp/core";
import { nekopunchPakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const SIGNATURE = Buffer.from("PACK", "ascii");
const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x4c;

interface Entry {
	name: string;
	stored: Buffer;
	unpackedSize: number;
}

function buildPak(entries: readonly Entry[], packed: boolean): Buffer {
	const indexSize = RECORD_SIZE * entries.length;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.stored.length, 0),
	);
	SIGNATURE.copy(archive, 0);
	archive.writeInt32LE(entries.length, 4);
	archive.writeInt32LE(packed ? 1 : 0, 8);
	let position = INDEX_OFFSET;
	let data = dataOffset;
	for (const entry of entries) {
		encodeCp932(entry.name).copy(archive, position);
		archive.writeUInt32LE(entry.unpackedSize, position + 0x40);
		archive.writeUInt32LE(entry.stored.length, position + 0x44);
		archive.writeUInt32LE(data, position + 0x48);
		entry.stored.copy(archive, data);
		position += RECORD_SIZE;
		data += entry.stored.length;
	}
	return archive;
}

describe("Studio Nekopunch PAK archive", () => {
	it("reads stored payloads verbatim", async () => {
		const content = Buffer.from("plain body");
		await expectArchive({
			format: nekopunchPakFormat,
			archive: buildPak(
				[{ name: "one.dat", stored: content, unpackedSize: content.length }],
				false,
			),
			sourcePath: "sample.pak",
			entries: [{ path: "one.dat", size: content.length, content }],
		});
	});

	it("decodes every payload as LZSS when the flag is set", async () => {
		// With the default LZSS settings this literal-and-match stream decodes to five 'A' characters.
		const stream = Buffer.from([0x01, 0x41, 0xee, 0xf1]);
		await expectArchive({
			format: nekopunchPakFormat,
			archive: buildPak(
				[
					{ name: "packed.dat", stored: stream, unpackedSize: 5 },
					{ name: "second.dat", stored: stream, unpackedSize: 5 },
				],
				true,
			),
			sourcePath: "sample.pak",
			entries: [
				{ path: "packed.dat", size: 5, content: Buffer.from("AAAAA") },
				{ path: "second.dat", size: 5, content: Buffer.from("AAAAA") },
			],
		});
	});

	it("requires the pak extension", async () => {
		const content = Buffer.from("plain body");
		await expectArchive({
			format: nekopunchPakFormat,
			archive: buildPak(
				[{ name: "one.dat", stored: content, unpackedSize: content.length }],
				false,
			),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a blank name", async () => {
		const content = Buffer.from("plain body");
		const archive = buildPak(
			[{ name: "one.dat", stored: content, unpackedSize: content.length }],
			false,
		);
		archive.fill(0, INDEX_OFFSET, INDEX_OFFSET + 0x40);
		await expectArchive({
			format: nekopunchPakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});
});
