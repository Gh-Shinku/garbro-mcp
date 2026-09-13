import { encodeCp932, FileByteSource } from "@garbro-mcp/core";
import { pochettePacFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const RECORD_SIZE = 0x10;

interface PacEntry {
	name: string;
	content: Buffer;
}

/** Builds the companion `.idx`: one 0x10-byte record per entry. */
function buildIdx(entries: readonly PacEntry[]): Buffer {
	// The index holds exactly one record per entry, so its size is a multiple of the record size.
	const idx = Buffer.alloc(entries.length * RECORD_SIZE);
	let offset = 0;
	for (const [id, entry] of entries.entries()) {
		const record = id * RECORD_SIZE;
		const name = encodeCp932(entry.name);
		idx.writeUInt8(name.length, record);
		name.copy(idx, record + 1);
		idx.writeUInt32LE(offset, record + 8);
		idx.writeUInt32LE(entry.content.length, record + 12);
		offset += entry.content.length;
	}
	return idx;
}

describe("Pochette PAC archive", () => {
	it("reads the companion .idx index", async () => {
		const entries = [
			{ name: "gdt001", content: Buffer.from("gdt payload") },
			{ name: "wav002", content: Buffer.from("wav data") },
		];
		await withCompanionFiles(
			"GDT01.pac",
			{
				"GDT01.pac": Buffer.concat(entries.map((entry) => entry.content)),
				"GDT01.idx": buildIdx(entries),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: pochettePacFormat,
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

	it("requires the companion index", async () => {
		await withCompanionFiles(
			"GDT01.pac",
			{ "GDT01.pac": Buffer.from("payload") },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await pochettePacFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("rejects an index whose size is not a multiple of the record size", async () => {
		const entries = [{ name: "a", content: Buffer.from("x") }];
		await withCompanionFiles(
			"GDT01.pac",
			{
				"GDT01.pac": Buffer.from("x"),
				"GDT01.idx": Buffer.concat([buildIdx(entries), Buffer.alloc(1)]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await pochettePacFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
