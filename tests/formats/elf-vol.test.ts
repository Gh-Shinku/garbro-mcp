import { volFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const FIRST_OFFSET = 0x10;

/**
 * The header holds the first payload's offset, the table that follows lists the later ones, and a word equal to
 * the file length terminates both the table and the last entry.
 */
function buildVol(
	offsets: readonly number[],
	payloads: readonly Buffer[],
): Buffer {
	const tableWords = [FIRST_OFFSET, ...offsets];
	const tableSize = tableWords.length * 4;
	const dataStart = Math.max(FIRST_OFFSET, tableSize);
	const archive = Buffer.alloc(
		dataStart + payloads.reduce((sum, item) => sum + item.length, 0),
	);
	archive.writeUInt32LE(FIRST_OFFSET, 0);
	for (const [id, word] of tableWords.entries())
		archive.writeUInt32LE(word, id * 4);
	let position = dataStart;
	for (const payload of payloads) {
		payload.copy(archive, position);
		position += payload.length;
	}
	return archive;
}

describe("Ancient elf VOL resource archive", () => {
	it("derives sizes from consecutive offsets", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		const third = Buffer.from("third body");
		// Offsets are absolute, so the first payload sits at 0x10 and the rest follow it.
		const archive = Buffer.alloc(
			0x10 + first.length + second.length + third.length,
		);
		archive.writeUInt32LE(0x10, 0);
		archive.writeUInt32LE(0x10 + first.length, 4);
		archive.writeUInt32LE(0x10 + first.length + second.length, 8);
		archive.writeUInt32LE(archive.length, 12);
		first.copy(archive, 0x10);
		second.copy(archive, 0x10 + first.length);
		third.copy(archive, 0x10 + first.length + second.length);
		await expectArchive({
			format: volFormat,
			archive,
			sourcePath: "sample.vol",
			entries: [
				{ path: "sample#0000", size: first.length, content: first },
				{ path: "sample#0001", size: second.length, content: second },
				{ path: "sample#0002", size: third.length, content: third },
			],
		});
	});

	it("stops the table at a word equal to the file length", async () => {
		const first = Buffer.from("only body");
		const built = buildVol([0x10 + first.length], [first]);
		built.writeUInt32LE(built.length, 4);
		await expectArchive({
			format: volFormat,
			archive: built,
			sourcePath: "sample.vol",
			entries: [{ path: "sample#0000", size: first.length, content: first }],
		});
	});

	it("skips a zero-length span and numbers the rest by pair index", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		const built = buildVol([0x10, 0x10 + first.length], [first, second]);
		// Make the first pair empty by repeating the first payload's offset.
		built.writeUInt32LE(0x10, 4);
		built.writeUInt32LE(0x10 + first.length, 8);
		built.writeUInt32LE(built.length, 12);
		await expectArchive({
			format: volFormat,
			archive: built,
			sourcePath: "sample.vol",
			entries: [
				{ path: "sample#0001", size: first.length, content: first },
				{ path: "sample#0002", size: second.length, content: second },
			],
		});
	});

	it("rejects an unaligned first offset", async () => {
		const content = Buffer.from("body");
		const archive = buildVol([0x18], [content]);
		archive.writeUInt32LE(0x11, 0);
		await expectArchive({
			format: volFormat,
			archive,
			sourcePath: "sample.vol",
			detected: false,
			entries: [],
		});
	});

	it("requires the vol extension", async () => {
		const content = Buffer.from("body");
		await expectArchive({
			format: volFormat,
			archive: buildVol([0x10 + content.length], [content]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
