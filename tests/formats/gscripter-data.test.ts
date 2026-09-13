import { encodeCp932 } from "@garbro-mcp/core";
import { gscripterDataFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, it } from "vitest";

function buildInfo(
	entries: { name: string; offset: number; size: number }[],
): Buffer {
	const records = entries.map((entry) => {
		const record = Buffer.alloc(0x28);
		encodeCp932(entry.name).copy(record, 0);
		record.writeUInt32LE(entry.offset, 0x20);
		record.writeUInt32LE(entry.size, 0x24);
		return record;
	});
	return Buffer.concat(records);
}

describe("GScripter DATA archive", () => {
	it("reads its index from the appended .info file", async () => {
		const first = Buffer.from("aa");
		const second = Buffer.from("bbb");
		await withCompanionFiles(
			"CG01.dat",
			{
				"CG01.dat": Buffer.concat([first, second]),
				"CG01.dat.info": buildInfo([
					{ name: "cg\\a.bmp", offset: 0, size: 2 },
					{ name: "b.bmp", offset: 2, size: 3 },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: gscripterDataFormat,
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
