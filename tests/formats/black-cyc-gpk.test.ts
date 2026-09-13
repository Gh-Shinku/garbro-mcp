import { encodeCp932, FileByteSource } from "@garbro-mcp/core";
import { gpkFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

interface GpkEntry {
	name: string;
	content: Buffer;
}

/**
 * Builds the companion `.gtb` index: a record count, a table of name-field offsets, a table of data
 * offsets, and the name blob.
 */
function buildGtb(entries: readonly GpkEntry[]): Buffer {
	const count = entries.length;
	const offsetsIndex = 4 + count * 4;
	const nameBase = offsetsIndex + count * 4;
	const encoded = entries.map((entry) =>
		Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
	);
	const names = Buffer.concat(encoded);
	const gtb = Buffer.alloc(nameBase + names.length);
	gtb.writeInt32LE(count, 0);
	let nameOffset = 0;
	let dataOffset = 0;
	for (const [id, entry] of entries.entries()) {
		gtb.writeInt32LE(nameOffset, 4 + id * 4);
		gtb.writeUInt32LE(dataOffset, offsetsIndex + id * 4);
		nameOffset += encoded[id]?.length ?? 0;
		dataOffset += entry.content.length;
	}
	names.copy(gtb, nameBase);
	return gtb;
}

describe("Black Cyc GPK images archive", () => {
	it("reads names and offsets from the sibling .gtb index", async () => {
		const first = Buffer.from("dwq one!");
		const second = Buffer.from("dwq two");
		await withCompanionFiles(
			"images.gpk",
			{
				"images.gpk": Buffer.concat([first, second]),
				"images.gtb": buildGtb([
					{ name: "title", content: first },
					{ name: "face/eye", content: second },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: gpkFormat,
					mainPath,
					entries: [
						{ path: "title.dwq", size: first.length, content: first },
						{ path: "face/eye.dwq", size: second.length, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("requires the companion index", async () => {
		await withCompanionFiles(
			"images.gpk",
			{ "images.gpk": Buffer.from("dwq") },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await gpkFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
