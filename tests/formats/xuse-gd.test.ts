import { gdFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, it } from "vitest";

function buildDll(records: { offset: number; size: number }[]): Buffer {
	const header = Buffer.alloc(4);
	header.writeInt32LE(0, 0);
	const table = records.map((record) => {
		const record_ = Buffer.alloc(8);
		record_.writeUInt32LE(record.offset, 0);
		record_.writeUInt32LE(record.size, 4);
		return record_;
	});
	return Buffer.concat([header, ...table]);
}

describe("Xuse GD archive", () => {
	it("reads its index from the sibling .dll file", async () => {
		const first = Buffer.from("aa");
		const second = Buffer.from("bbb");
		const main = Buffer.alloc(4 + first.length + second.length);
		main.writeInt32LE(2, 0);
		first.copy(main, 4);
		second.copy(main, 6);
		await withCompanionFiles(
			"data.gd",
			{
				"data.gd": main,
				"data.dll": buildDll([
					{ offset: 4, size: 2 },
					{ offset: 6, size: 3 },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: gdFormat,
					mainPath,
					entries: [
						{ path: "data#00000", size: 2, content: first },
						{ path: "data#00001", size: 3, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});
});
