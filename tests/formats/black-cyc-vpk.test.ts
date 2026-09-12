import { encodeCp932 } from "@garbro-mcp/core";
import { vpkFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, it } from "vitest";

function buildVtb(
	entries: { name: string; offset: number }[],
	end: number,
): Buffer {
	const records = entries.map((entry) => {
		const record = Buffer.alloc(0x0c);
		encodeCp932(entry.name).copy(record, 0);
		record.writeUInt32LE(entry.offset, 8);
		return record;
	});
	const tail = Buffer.alloc(0x0c);
	tail.writeUInt32LE(end, 8);
	return Buffer.concat([...records, tail]);
}

describe("Black Cyc VPK audio archive", () => {
	it("reads its index from the sibling .vtb file", async () => {
		const first = Buffer.from("aa");
		const second = Buffer.from("bbb");
		await withCompanionFiles(
			"data.vpk",
			{
				"data.vpk": Buffer.concat([first, second]),
				"data.vtb": buildVtb(
					[
						{ name: "voice1", offset: 0 },
						{ name: "voice2", offset: 2 },
					],
					5,
				),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: vpkFormat,
					mainPath,
					entries: [
						{ path: "voice1.vaw", size: 2, content: first },
						{ path: "voice2.vaw", size: 3, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});
});
