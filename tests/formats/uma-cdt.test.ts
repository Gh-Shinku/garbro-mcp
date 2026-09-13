import { encodeCp932 } from "@garbro-mcp/core";
import { cdtFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

function buildCdt(
	entries: { name: string; content: Buffer; packed?: boolean }[],
): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const name = Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]);
		const header = Buffer.alloc(12);
		header.writeUInt32LE(entry.content.length, 0);
		const payload = entry.packed
			? literalLzssStream(entry.content)
			: entry.content;
		header.writeUInt32LE(payload.length, 4);
		header.writeInt32LE(entry.packed ? 1 : 0, 8);
		parts.push(name, header, payload);
	}
	return Buffer.concat(parts);
}

describe("Uma CDT archive", () => {
	it("walks sequential name/size records and decompresses packed entries", async () => {
		const script = Buffer.from("script body");
		await expectArchive({
			format: cdtFormat,
			archive: buildCdt([
				{ name: "raw.bin", content: Buffer.from("aa") },
				{ name: "start.scr", content: script, packed: true },
			]),
			sourcePath: "data.cdt",
			entries: [
				{ path: "raw.bin", size: 2, content: Buffer.from("aa") },
				{
					path: "start.scr",
					size: literalLzssStream(script).length,
					content: script,
				},
			],
			metadata: { entryCount: 2 },
		});
	});
});
