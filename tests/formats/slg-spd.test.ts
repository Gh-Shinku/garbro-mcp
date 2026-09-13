import { encodeCp932, FileByteSource } from "@garbro-mcp/core";
import { spdFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x10;

interface SpdEntry {
	name: string;
	content: Buffer;
}

/**
 * Builds the `.SPL` companion: an `SFP` signature, the alignment factor, and records whose first
 * field is the name-blob offset that also marks the end of the record list.
 */
function buildSpl(entries: readonly SpdEntry[], align = 1): Buffer {
	const namesOffset = INDEX_OFFSET + entries.length * RECORD_SIZE;
	const names = Buffer.concat(
		entries.map((entry) =>
			Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
		),
	);
	const spl = Buffer.alloc(namesOffset + names.length);
	spl.write("SFP\0", 0, "latin1");
	spl.writeUInt32LE(align, 0x0c);
	spl.writeUInt32LE(namesOffset, INDEX_OFFSET);
	let nameOffset = 0;
	let offset = 0;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		spl.writeUInt32LE(namesOffset + nameOffset, record);
		spl.writeUInt32LE(entry.content.length, record + 4);
		spl.writeUInt32LE(offset / align, record + 8);
		nameOffset += encodeCp932(entry.name).length + 1;
		offset += entry.content.length;
	}
	names.copy(spl, namesOffset);
	return spl;
}

describe("SLG system SPD audio archive", () => {
	it("reads the companion .SPL index", async () => {
		const entries = [
			{ name: "bgm01", content: Buffer.from("first audio") },
			{ name: "se02", content: Buffer.from("second!") },
		];
		await withCompanionFiles(
			"sound.spd",
			{
				"sound.spd": Buffer.concat(entries.map((entry) => entry.content)),
				"sound.SPL": buildSpl(entries),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: spdFormat,
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

	it("applies the alignment factor to data offsets", async () => {
		const content = Buffer.from("aligned");
		const align = 4;
		const payload = Buffer.concat([
			content,
			Buffer.alloc(align - (content.length % align) || align),
		]);
		await withCompanionFiles(
			"sound.spd",
			{
				"sound.spd": payload,
				"sound.SPL": buildSpl([{ name: "a", content }], align),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: spdFormat,
					mainPath,
					entries: [{ path: "a", size: content.length, content }],
				});
			},
		);
	});

	it("requires the companion index", async () => {
		await withCompanionFiles(
			"sound.spd",
			{ "sound.spd": Buffer.from("payload") },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await spdFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
