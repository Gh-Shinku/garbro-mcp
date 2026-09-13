import { encodeCp932 } from "@garbro-mcp/core";
import { gameDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const NAME_OFFSET = 0x10;

interface GameDatEntry {
	name: string;
	content: Buffer;
}

/** Builds a GAMEDAT archive with the version marker selecting the name field width. */
function buildGameDat(
	entries: readonly GameDatEntry[],
	version: "K" | "2" = "K",
): Buffer {
	const nameLength = version === "K" ? 16 : 32;
	const count = entries.length;
	const baseOffset = NAME_OFFSET + count * nameLength + count * 8;
	const archive = Buffer.alloc(
		baseOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("GAMEDAT PAC", 0, "ascii");
	archive.write(version, 0x0b, "ascii");
	archive.writeInt32LE(count, 0x0c);
	let offset = 0;
	let position = baseOffset;
	for (const [id, entry] of entries.entries()) {
		encodeCp932(entry.name).copy(archive, NAME_OFFSET + id * nameLength);
		const index = NAME_OFFSET + count * nameLength + id * 8;
		archive.writeUInt32LE(offset, index);
		archive.writeUInt32LE(entry.content.length, index + 4);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

/** Applies the rolling XOR GARbro uses for `textdata.bin` payloads. */
function encryptTextData(content: Buffer): Buffer {
	const data = Buffer.from(content);
	let key = 0xc5;
	for (let position = 0; position < data.length; position += 1) {
		data[position] = (data[position] ?? 0) ^ key;
		key = (key + 0x5c) & 0xff;
	}
	return data;
}

describe("Pajamas Adventure System GAMEDAT archive", () => {
	it("reads a version 1 index", async () => {
		const first = Buffer.from("first resource");
		const second = Buffer.from("second");
		await expectArchive({
			format: gameDatFormat,
			archive: buildGameDat([
				{ name: "data/one.bin", content: first },
				{ name: "two.bin", content: second },
			]),
			sourcePath: "game.dat",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads a version 2 index with wider names", async () => {
		const content = Buffer.from("wider name field");
		await expectArchive({
			format: gameDatFormat,
			archive: buildGameDat([{ name: "a.bin", content }], "2"),
			sourcePath: "game.pak",
			entries: [{ path: "a.bin", size: content.length, content }],
		});
	});

	it("decrypts textdata.bin payloads", async () => {
		// The stored marker decrypts to the "PJADV" magic GARbro's key produces.
		const plain = Buffer.concat([
			Buffer.from("PJADV", "ascii"),
			Buffer.from("script body"),
		]);
		await expectArchive({
			format: gameDatFormat,
			archive: buildGameDat([
				{ name: "textdata.bin", content: encryptTextData(plain) },
			]),
			sourcePath: "game.dat",
			entries: [{ path: "textdata.bin", size: plain.length, content: plain }],
		});
	});

	it("leaves other payloads with that name pattern untouched", async () => {
		const content = Buffer.from("plain data file content");
		await expectArchive({
			format: gameDatFormat,
			archive: buildGameDat([{ name: "textdata.bin", content }]),
			sourcePath: "game.dat",
			entries: [{ path: "textdata.bin", size: content.length, content }],
		});
	});

	it("rejects an unknown version marker", async () => {
		const archive = buildGameDat([
			{ name: "a.bin", content: Buffer.from("x") },
		]);
		archive.write("X", 0x0b, "ascii");
		await expectArchive({
			format: gameDatFormat,
			archive,
			sourcePath: "game.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects entries placed outside the file", async () => {
		const archive = buildGameDat([
			{ name: "a.bin", content: Buffer.from("x") },
		]);
		archive.writeUInt32LE(0x100000, NAME_OFFSET + 16);
		await expectArchive({
			format: gameDatFormat,
			archive,
			sourcePath: "game.dat",
			detected: false,
			entries: [],
		});
	});
});
