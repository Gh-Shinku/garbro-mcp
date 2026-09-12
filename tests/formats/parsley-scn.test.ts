import { encodeCp932 } from "@garbro-mcp/core";
import { parsleyScnFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildScn(entries: { name: string; content: Buffer }[]): Buffer {
	const baseOffset = 0x1400;
	const index = Buffer.alloc(baseOffset);
	const names = entries.map((entry) => encodeCp932(entry.name));
	let position = 0;
	let dataOffset = baseOffset;
	for (const [index2, entry] of entries.entries()) {
		const name = names[index2] ?? Buffer.alloc(0);
		name.copy(index, position);
		index.writeUInt32LE(dataOffset - baseOffset, position + 0x20);
		index.writeUInt32LE(entry.content.length, position + 0x24);
		dataOffset += entry.content.length;
		position += 0x28;
	}
	return Buffer.concat([index, ...entries.map((entry) => entry.content)]);
}

describe("Software House Parsley SCN archive", () => {
	it("reads the fixed 0x1400 index area", async () => {
		await expectArchive({
			format: parsleyScnFormat,
			archive: buildScn([
				{ name: "start", content: Buffer.from("script") },
				{ name: "sub\\x", content: Buffer.from("x") },
			]),
			sourcePath: "scn.dat",
			entries: [
				{ path: "start", size: 6, content: Buffer.from("script") },
				{ path: "sub/x", size: 1, content: Buffer.from("x") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
