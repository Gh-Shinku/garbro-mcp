import { csPackFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 12;
const RECORD_SIZE = 24;
const NAME_LENGTH = 0x1e;
const ALPHABET = "_0123456789abcdefghijklmnopqrstuvwxyz_";

/**
 * Packs a name the way Cat System stores it: a 30-character field with the base name first and the
 * extension at index 0x10, split into base-40 digits six per word.
 */
function packName(name: string, extension: string): Buffer {
	const field = Buffer.alloc(NAME_LENGTH);
	for (const [index, character] of [...name].entries())
		field[index] = ALPHABET.indexOf(character);
	for (const [index, character] of [...extension].entries())
		field[0x10 + index] = ALPHABET.indexOf(character);
	const packed = Buffer.alloc((NAME_LENGTH / 6) * 4);
	for (let word = 0; word < NAME_LENGTH / 6; word += 1) {
		let value = 0;
		for (let digit = 0; digit < 6; digit += 1) {
			value = value * 40 + (field[word * 6 + digit] ?? 0);
		}
		packed.writeUInt32LE(value >>> 0, word * 4);
	}
	return packed;
}

interface CsEntry {
	name: string;
	extension: string;
	content: Buffer;
}

function buildCsPack(entries: readonly CsEntry[]): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("CsPack2", 0, "ascii");
	archive.writeUInt32LE(dataOffset, 8);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		packName(entry.name, entry.extension).copy(archive, record);
		const next = offset + entry.content.length;
		// The trailing word chains to the next offset together with the leading two.
		archive.writeUInt32LE(0, record + 4);
		archive.writeUInt32LE(
			(archive.readUInt32LE(record) ^ next) >>> 0,
			record + RECORD_SIZE - 4,
		);
		entry.content.copy(archive, offset);
		offset = next;
	}
	return archive;
}

describe("Cat System CsPack2 resource archive", () => {
	it("decodes base-40 names and chained sizes", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second!");
		await expectArchive({
			format: csPackFormat,
			archive: buildCsPack([
				{ name: "abc", extension: "dat", content: first },
				{ name: "second", extension: "bmp", content: second },
			]),
			sourcePath: "sample.pack",
			entries: [
				{ path: "abc.dat", size: first.length, content: first },
				{ path: "second.bmp", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("accepts names without an extension", async () => {
		const content = Buffer.from("payload");
		await expectArchive({
			format: csPackFormat,
			archive: buildCsPack([{ name: "plain", extension: "", content }]),
			sourcePath: "sample.pack",
			entries: [{ path: "plain", size: content.length, content }],
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildCsPack([
			{ name: "a", extension: "dat", content: Buffer.from("x") },
		]);
		archive.write("CsPack3", 0, "ascii");
		await expectArchive({
			format: csPackFormat,
			archive,
			sourcePath: "sample.pack",
			detected: false,
			entries: [],
		});
	});

	it("rejects a broken size chain", async () => {
		const archive = buildCsPack([
			{ name: "a", extension: "dat", content: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0xffffffff, INDEX_OFFSET + RECORD_SIZE - 4);
		await expectArchive({
			format: csPackFormat,
			archive,
			sourcePath: "sample.pack",
			detected: false,
			entries: [],
		});
	});
});
