import { encodeCp932 } from "@garbro-mcp/core";
import { aosDatFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, it } from "vitest";

function buildIndex(
	entries: { name: string; offset: number; size: number }[],
): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const tail = Buffer.alloc(8);
		tail.writeUInt32LE(entry.offset, 0);
		tail.writeUInt32LE(entry.size, 4);
		parts.push(
			Buffer.concat([encodeCp932(entry.name), Buffer.from([0]), tail]),
		);
	}
	return Buffer.concat(parts);
}

describe("AOS DAT archive", () => {
	it("reads its index from the sibling index.idx file", async () => {
		const first = Buffer.from("aa");
		const second = Buffer.from("bbb");
		await withCompanionFiles(
			"data.dat",
			{
				"data.dat": Buffer.concat([first, second]),
				"index.idx": buildIndex([
					{ name: "cg\\a.bmp", offset: 0, size: 2 },
					{ name: "b.bmp", offset: 2, size: 3 },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: aosDatFormat,
					mainPath,
					entries: [
						{ path: "cg/a.bmp", size: 2, content: first },
						{ path: "b.bmp", size: 3, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});
});
