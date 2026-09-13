import { encodeCp932, FileByteSource } from "@garbro-mcp/core";
import { yuFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const NAME_SIZE = 0x41;
const KEY = 0x55;

interface YuEntry {
	name: string;
	content: Buffer;
	type?: number;
}

/** Builds the companion index: a name field XORed with 0x55, the offset, and the content type. */
function buildIndex(entries: readonly YuEntry[], dataOffset: number): Buffer {
	const parts: Buffer[] = [];
	let offset = dataOffset;
	for (const entry of entries) {
		const field = Buffer.alloc(NAME_SIZE);
		const name = encodeCp932(entry.name);
		for (const [index, value] of name.entries()) field[index] = value ^ KEY;
		const tail = Buffer.alloc(5);
		tail.writeUInt32LE(offset, 0);
		tail.writeUInt8(entry.type ?? 0, 4);
		parts.push(field, tail);
		offset += entry.content.length;
	}
	return Buffer.concat(parts);
}

describe("Tactics YU resource archive", () => {
	it("derives sizes from the companion index", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second");
		await withCompanionFiles(
			"game.arc",
			{
				"game.arc": Buffer.concat([first, second]),
				"game.arc.dll": buildIndex(
					[
						{ name: "data/one.bin", content: first },
						{ name: "two.bin", content: second },
					],
					0,
				),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: yuFormat,
					mainPath,
					entries: [
						{ path: "data/one.bin", size: first.length, content: first },
						{ path: "two.bin", size: second.length, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("decrypts type 3 payloads", async () => {
		const plain = Buffer.from("encrypted body");
		const stored = Buffer.from(plain);
		for (let position = 0; position < stored.length; position += 1)
			stored[position] = (stored[position] ?? 0) ^ KEY;
		await withCompanionFiles(
			"game.arc",
			{
				"game.arc": stored,
				"game.arc.dll": buildIndex(
					[{ name: "a.bin", content: stored, type: 3 }],
					0,
				),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: yuFormat,
					mainPath,
					entries: [{ path: "a.bin", size: plain.length, content: plain }],
				});
			},
		);
	});

	it("requires the companion index", async () => {
		await withCompanionFiles(
			"game.arc",
			{ "game.arc": Buffer.from("payload") },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await yuFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
