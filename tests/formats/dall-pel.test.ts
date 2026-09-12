import { encodeCp932 } from "@garbro-mcp/core";
import { dallPelFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function u32(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(value, 0);
	return buffer;
}

function buildPel(entries: { name: string; content: Buffer }[]): Buffer {
	const parts = [Buffer.from([entries.length & 0xff, entries.length >> 8])];
	for (const entry of entries) {
		parts.push(
			Buffer.concat([
				encodeCp932(entry.name),
				Buffer.from([0]),
				u32(entry.content.length),
				entry.content,
			]),
		);
	}
	return Buffer.concat(parts);
}

describe("Dall PEL archive", () => {
	it("reads name, size, and payload sequentially", async () => {
		await expectArchive({
			format: dallPelFormat,
			archive: buildPel([
				{ name: "one.bin", content: Buffer.from("aa") },
				{ name: "two.bin", content: Buffer.from("bbb") },
			]),
			sourcePath: "data.pel",
			entries: [
				{ path: "one.bin", size: 2, content: Buffer.from("aa") },
				{ path: "two.bin", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
