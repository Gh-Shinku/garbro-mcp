import { mirisDatFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { deflateSync } from "node:zlib";
import { describe, it } from "vitest";

describe("Studio Miris DAT archive", () => {
	it("reads a zlib-compressed text index from the sibling l.dat file", async () => {
		const first = Buffer.from("aa");
		const second = Buffer.from("bbb");
		const index = `${["a.bin,2,0", "dir/b.bin,3,2"].join("#")}#`;
		await withCompanionFiles(
			"data.dat",
			{
				"data.dat": Buffer.concat([first, second]),
				"datal.dat": deflateSync(Buffer.from(index, "latin1")),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: mirisDatFormat,
					mainPath,
					entries: [
						{ path: "a.bin", size: 2, content: first },
						{ path: "dir/b.bin", size: 3, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});
});
