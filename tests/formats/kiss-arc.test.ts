import { encodeCp932 } from "@garbro-mcp/core";
import { kissArcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildKissArc(entries: { name: string; content: Buffer }[]): Buffer {
	const head = Buffer.alloc(4);
	head.writeInt32LE(entries.length, 0);
	const records: Buffer[] = [];
	let offset = 4;
	for (const entry of entries) {
		const name = encodeCp932(entry.name);
		offset += name.length + 1 + 8;
	}
	const recordBuffers: Buffer[] = [];
	let dataOffset = offset;
	for (const entry of entries) {
		const name = encodeCp932(entry.name);
		const nameField = Buffer.concat([name, Buffer.from([0])]);
		const offsetField = Buffer.alloc(8);
		offsetField.writeBigInt64LE(BigInt(dataOffset), 0);
		recordBuffers.push(Buffer.concat([nameField, offsetField]));
		dataOffset += entry.content.length;
	}
	records.push(...recordBuffers);
	return Buffer.concat([
		head,
		...records,
		...entries.map((entry) => entry.content),
	]);
}

describe("Kiss ARC archive", () => {
	it("derives sizes from 64-bit offsets", async () => {
		await expectArchive({
			format: kissArcFormat,
			archive: buildKissArc([
				{ name: "one.bin", content: Buffer.from("aaa") },
				{ name: "dir\\two.bin", content: Buffer.from("bb") },
			]),
			sourcePath: "data.arc",
			entries: [
				{ path: "one.bin", size: 3, content: Buffer.from("aaa") },
				{ path: "dir/two.bin", size: 2, content: Buffer.from("bb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
