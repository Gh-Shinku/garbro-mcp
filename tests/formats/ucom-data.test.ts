import { encodeCp932, FileByteSource } from "@garbro-mcp/core";
import { ucomDataFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const INDEX_RECORD_SIZE = 0x18;
const XOR_KEY = 0x45;

interface UcomEntry {
	name: string;
	content: Buffer;
}

/** XORs four of every five bytes, mirroring GARbro's payload transform. */
function xorPayload(content: Buffer): Buffer {
	const payload = Buffer.from(content);
	for (let position = 0; position < payload.length; position += 1) {
		if (position % 5 === 0) continue;
		payload[position] = (payload[position] ?? 0) ^ XOR_KEY;
	}
	return payload;
}

function buildIndex(entries: readonly UcomEntry[]): Buffer {
	const index = Buffer.alloc(4 + entries.length * INDEX_RECORD_SIZE);
	index.write("IF", 0, "ascii");
	index.writeInt16LE(entries.length, 2);
	// Payloads follow the two-byte "PF" marker of the data file.
	let offset = 2;
	for (const [id, entry] of entries.entries()) {
		const record = 4 + id * INDEX_RECORD_SIZE;
		encodeCp932(entry.name).copy(index, record);
		index.writeUInt32LE(offset, record + 0x10);
		index.writeUInt32LE(entry.content.length, record + 0x14);
		offset += entry.content.length;
	}
	return index;
}

describe("Ucom scripts archive", () => {
	it("reads the data01 index and applies the strided XOR", async () => {
		const entries = [
			{ name: "scene01.scr", content: Buffer.from("first script body") },
			{ name: "scene02.scr", content: Buffer.from("second") },
		];
		await withCompanionFiles(
			"data02",
			{
				data02: Buffer.concat([
					Buffer.from("PF", "ascii"),
					...entries.map((entry) => xorPayload(entry.content)),
				]),
				data01: buildIndex(entries),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: ucomDataFormat,
					mainPath,
					entries: entries.map((entry) => ({
						path: entry.name,
						size: entry.content.length,
						content: entry.content,
					})),
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("requires the data02 file name", async () => {
		await withCompanionFiles(
			"data03",
			{
				data03: Buffer.from("PF", "ascii"),
				data01: buildIndex([]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await ucomDataFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
