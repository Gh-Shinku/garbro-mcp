import { encodeCp932 } from "@garbro-mcp/core";
import { bndFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, it } from "vitest";

function buildIdx(
	entries: { name: string; size: number; offset: number }[],
): Buffer {
	const records = entries.map((entry) => {
		const record = Buffer.alloc(0x18);
		encodeCp932(entry.name).copy(record, 0);
		record.writeUInt32LE(entry.size, 0x10);
		record.writeUInt32LE(entry.offset, 0x14);
		return record;
	});
	return Buffer.concat(records);
}

describe("Tetratech BND archive", () => {
	it("reads its index from the sibling .idx file", async () => {
		const first = Buffer.from("aa");
		const second = Buffer.from("b");
		await withCompanionFiles(
			"data.BND",
			{
				"data.BND": Buffer.concat([first, second]),
				"data.idx": buildIdx([
					{ name: "a.bmp", size: 2, offset: 0 },
					{ name: "b.wav", size: 1, offset: 2 },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: bndFormat,
					mainPath,
					entries: [
						{ path: "a.bmp", size: 2, content: first },
						{ path: "b.wav", size: 1, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});
});
