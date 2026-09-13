import { encodeCp932 } from "@garbro-mcp/core";
import { a98Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

interface Entry {
	name: string;
	extension: string;
	content: Buffer;
}

function writeName(record: Buffer, position: number, entry: Entry): void {
	encodeCp932(entry.name).copy(record, position);
	encodeCp932(entry.extension).copy(record, position + 8);
}

/**
 * The plain layout announces one more entry than it holds: each record's size is the gap to the following
 * record's offset, so the extra slot carries the end of the data.
 */
function buildPlain(entries: readonly Entry[]): Buffer {
	const count = entries.length + 1;
	const indexSize = count * 0x10;
	const archive = Buffer.alloc(
		2 +
			indexSize +
			entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt16LE(count, 0);
	let position = 2 + indexSize;
	const offsets: number[] = [];
	for (const entry of entries) {
		offsets.push(position);
		position += entry.content.length;
	}
	offsets.push(position);
	for (const [id, entry] of entries.entries()) {
		const record = 2 + id * 0x10;
		writeName(archive, record, entry);
		archive.writeUInt32LE(offsets[id] ?? 0, record + 12);
	}
	archive.writeUInt32LE(
		offsets[entries.length] ?? 0,
		2 + entries.length * 0x10 + 12,
	);
	let write = 2 + indexSize;
	for (const entry of entries) {
		entry.content.copy(archive, write);
		write += entry.content.length;
	}
	return archive;
}

/** The voice layout lists offsets first, then names and stored sizes, and may stop early at the file end. */
function buildVoice(
	entries: readonly Entry[],
	includeTerminator: boolean,
): Buffer {
	const count = entries.length + (includeTerminator ? 1 : 0);
	const offsetsSize = count * 8;
	const namesOffset = 4 + offsetsSize;
	const namesSize = entries.length * 0x10;
	const dataOffset = namesOffset + namesSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt16LE(0x4000, 0);
	archive.writeInt16LE(count, 2);
	let position = dataOffset;
	const offsets: number[] = [];
	for (const entry of entries) {
		offsets.push(position);
		position += entry.content.length;
	}
	for (const [id, offset] of offsets.entries()) {
		archive.writeUInt32LE(offset, 4 + id * 8 + 4);
	}
	if (includeTerminator)
		archive.writeUInt32LE(archive.length, 4 + entries.length * 8 + 4);
	for (const [id, entry] of entries.entries()) {
		const record = namesOffset + id * 0x10;
		writeName(archive, record, entry);
		archive.writeUInt32LE(entry.content.length, record + 0x0c);
	}
	let write = dataOffset;
	for (const entry of entries) {
		entry.content.copy(archive, write);
		write += entry.content.length;
	}
	return archive;
}

describe("A98SYS Engine PAK resource archive", () => {
	it("reads the plain layout with derived sizes", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: a98Format,
			archive: buildPlain([
				{ name: "one", extension: "dat", content: first },
				{ name: "two", extension: "dat", content: second },
			]),
			sourcePath: "sample.pak",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("reads the voice layout with stored sizes", async () => {
		const content = Buffer.from("voice body");
		await expectArchive({
			format: a98Format,
			archive: buildVoice(
				[{ name: "voice", extension: "wav", content }],
				false,
			),
			sourcePath: "sample.pak",
			entries: [{ path: "voice.wav", size: content.length, content }],
		});
	});

	it("stops the voice offset list at the file end", async () => {
		const content = Buffer.from("voice body");
		await expectArchive({
			format: a98Format,
			archive: buildVoice([{ name: "voice", extension: "wav", content }], true),
			sourcePath: "sample.pak",
			entries: [{ path: "voice.wav", size: content.length, content }],
		});
	});

	it("rejects a count of one or less", async () => {
		const archive = buildPlain([
			{ name: "one", extension: "dat", content: Buffer.from("body") },
		]);
		archive.writeInt16LE(1, 0);
		await expectArchive({
			format: a98Format,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});

	it("requires the pak extension", async () => {
		const archive = buildPlain([
			{ name: "one", extension: "dat", content: Buffer.from("body") },
		]);
		await expectArchive({
			format: a98Format,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
