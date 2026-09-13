import { keyPakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const BLOCK_SIZE = 0x40;
const DATA_OFFSET = 0x100;
const INDEX_SCAN_START = 0x24;

interface Entry {
	name: string;
	content: Buffer;
}

/**
 * The index is located by scanning for the block number that equals `data_offset / block_size`, so the first
 * record's block word is that value and the word before it is the names pointer.
 */
function buildPak(
	entries: readonly Entry[],
	names: boolean,
): { archive: Buffer; namesOffset: number } {
	const recordsStart = INDEX_SCAN_START + 4;
	const recordsSize = entries.length * 8;
	const namesOffset = recordsStart + recordsSize;
	const pool = names
		? Buffer.concat(
				entries.map((entry) =>
					Buffer.concat([Buffer.from(entry.name, "utf8"), Buffer.from([0])]),
				),
			)
		: Buffer.alloc(0);
	const end = DATA_OFFSET + BLOCK_SIZE * entries.length;
	const archive = Buffer.alloc(Math.max(end, namesOffset + pool.length));
	archive.writeUInt32LE(DATA_OFFSET, 0);
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(BLOCK_SIZE, 0x0c);
	archive.writeUInt8(names ? 2 : 0, 0x21);
	archive.writeUInt32LE(namesOffset, INDEX_SCAN_START);
	let block = DATA_OFFSET / BLOCK_SIZE;
	for (const [id, entry] of entries.entries()) {
		const record = recordsStart + id * 8;
		archive.writeUInt32LE(block, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		entry.content.copy(archive, block * BLOCK_SIZE);
		block += 1;
	}
	pool.copy(archive, namesOffset);
	return { archive, namesOffset };
}

describe("Key PAK resource archive", () => {
	it("reads a names pool behind the index", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		const { archive } = buildPak(
			[
				{ name: "one.dat", content: first },
				{ name: "two.dat", content: second },
			],
			true,
		);
		await expectArchive({
			format: keyPakFormat,
			archive,
			sourcePath: "sample.pak",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("numbers entries when the archive stores no names", async () => {
		const content = Buffer.from("plain body");
		const { archive } = buildPak([{ name: "ignored", content }], false);
		await expectArchive({
			format: keyPakFormat,
			archive,
			sourcePath: "sample.pak",
			entries: [{ path: "00000", size: content.length, content }],
		});
	});

	it("rejects a payload start that is not a block multiple", async () => {
		const { archive } = buildPak(
			[{ name: "one.dat", content: Buffer.from("body") }],
			true,
		);
		archive.writeUInt32LE(DATA_OFFSET + 1, 0);
		await expectArchive({
			format: keyPakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});

	it("rejects an index whose first word never matches the block number", async () => {
		const { archive } = buildPak(
			[{ name: "one.dat", content: Buffer.from("body") }],
			true,
		);
		// The word after the names pointer starts the records, so break the match there.
		archive.writeUInt32LE(0, INDEX_SCAN_START + 4);
		await expectArchive({
			format: keyPakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});
});
