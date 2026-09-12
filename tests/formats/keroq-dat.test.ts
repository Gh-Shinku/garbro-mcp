import { encodeCp932 } from "@garbro-mcp/core";
import { keroqDatFormat } from "@garbro-mcp/formats";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, it } from "vitest";

function buildMain(contents: Buffer[]): { archive: Buffer; offsets: number[] } {
	const header = Buffer.alloc(8);
	header.writeUInt8(0x89, 0);
	header.write("PAC", 1, "ascii");
	header.writeInt32LE(contents.length, 4);
	const offsets: number[] = [];
	let offset = header.length;
	for (const content of contents) {
		offsets.push(offset);
		offset += content.length;
	}
	return { archive: Buffer.concat([header, ...contents]), offsets };
}

function buildHeaderFile(
	entries: { name: string; size: number; offset: number }[],
): Buffer {
	const header = Buffer.alloc(8);
	header.writeUInt8(0x89, 0);
	header.write("HDR", 1, "ascii");
	header.writeInt32LE(entries.length, 4);
	const records = entries.map((entry) => {
		const tail = Buffer.alloc(8);
		tail.writeUInt32LE(entry.size, 0);
		tail.writeUInt32LE(entry.offset, 4);
		return Buffer.concat([encodeCp932(entry.name), Buffer.from([0]), tail]);
	});
	return Buffer.concat([header, ...records]);
}

describe("KeroQ DAT archive", () => {
	it("reads the previous-numbered companion header file", async () => {
		const first = Buffer.from("aa");
		const second = Buffer.from("b");
		const main = buildMain([first, second]);
		await withCompanionFiles(
			"001.dat",
			{
				"001.dat": main.archive,
				"000.dat": buildHeaderFile([
					{ name: "a.g", size: 2, offset: main.offsets[0] ?? 0 },
					{ name: "b.g", size: 1, offset: main.offsets[1] ?? 0 },
				]),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: keroqDatFormat,
					mainPath,
					entries: [
						{ path: "a.g", size: 2, content: first },
						{ path: "b.g", size: 1, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});
});
