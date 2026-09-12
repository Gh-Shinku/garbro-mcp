import { encodeCp932 } from "@garbro-mcp/core";
import { snnFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, it } from "vitest";

function buildMain(contents: Buffer[]): Buffer {
	return Buffer.concat(contents);
}

function buildInx(
	entries: { name: string; offset: number; size: number }[],
): Buffer {
	const head = Buffer.alloc(4);
	head.writeInt32LE(entries.length, 0);
	const records = entries.map((entry) => {
		const record = Buffer.alloc(0x48);
		encodeCp932(entry.name).copy(record, 0);
		record.writeUInt32LE(entry.offset, 0x40);
		record.writeUInt32LE(entry.size, 0x44);
		return record;
	});
	return Buffer.concat([head, ...records]);
}

describe("BlueGale SNN archive", () => {
	it("reads its index from the sibling .Inx file", async () => {
		const first = Buffer.from("aa");
		const second = Buffer.from("bbb");
		await withCompanionFiles(
			"data.snn",
			{
				"data.snn": buildMain([first, second]),
				"data.Inx": buildInx([
					{ name: "cg\\a.bmp", offset: 0, size: 2 },
					{ name: "b.bmp", offset: 2, size: 3 },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: snnFormat,
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
