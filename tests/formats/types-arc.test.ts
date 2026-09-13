import { encodeCp932 } from "@garbro-mcp/core";
import { typesArcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildTypesArc(entries: { name: string; content: Buffer }[]): Buffer {
	const parts: Buffer[] = [];
	for (const [id, entry] of entries.entries()) {
		const name = encodeCp932(entry.name);
		const header = Buffer.alloc(10);
		header.writeUInt32LE(entry.content.length, 0);
		header.writeUInt32LE(id, 4);
		header.writeUInt16LE(name.length + 1, 8);
		parts.push(header, name, Buffer.from([0]), entry.content);
	}
	parts.push(Buffer.alloc(10));
	return Buffer.concat(parts);
}

describe("Types ARC archive", () => {
	it("walks size-prefixed records until the zero terminator", async () => {
		await expectArchive({
			format: typesArcFormat,
			archive: buildTypesArc([
				{ name: "a.wav", content: Buffer.from("aa") },
				{ name: "b.gf", content: Buffer.from("bbb") },
			]),
			sourcePath: "data.arc",
			entries: [
				{ path: "a.wav", size: 2, content: Buffer.from("aa") },
				{ path: "b.gf", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
