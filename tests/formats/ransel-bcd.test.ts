import { bcdFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, it } from "vitest";

const MAIN = Buffer.from("BinaryCombineData\0extra payload bytes");

const INDEX = [
	"[BinaryCombineData]",
	"data.bcd",
	"ignored",
	"[a.bin]",
	"19",
	"2",
	"ignored",
	"[dir/b.bin]",
	"21",
	"5",
	"ignored",
	"",
].join("\r\n");

describe("ransel BCD archive", () => {
	it("reads offsets from the sibling .bcl listing", async () => {
		await withCompanionFiles(
			"data.bcd",
			{ "data.bcd": MAIN, "data.bcl": INDEX },
			async (mainPath) => {
				await expectCompanionArchive({
					format: bcdFormat,
					mainPath,
					entries: [
						{ path: "a.bin", size: 2, content: MAIN.subarray(19, 21) },
						{ path: "dir/b.bin", size: 5, content: MAIN.subarray(21, 26) },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});
});
