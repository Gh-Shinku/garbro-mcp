import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { tigermanPacFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

function buildTigerman(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x14;
	const indexSize = entries.length * 0x18;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(0, 0);
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x18;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset - dataOffset, record + 0x10);
		archive.writeUInt32LE(entry.content.length, record + 0x14);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Tigerman Project PAC archive", () => {
	it("reads a base-relative index that starts at 0x14", async () => {
		await expectArchive({
			format: tigermanPacFormat,
			archive: buildTigerman([
				{ name: "a.dat", content: Buffer.from("aa") },
				{ name: "b.dat", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "a.dat", size: 2, content: Buffer.from("aa") },
				{ path: "b.dat", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("does not claim a shallow header whose complete index is invalid", async () => {
		const invalid = Buffer.alloc(0x40);
		invalid.writeInt32LE(0, 0);
		invalid.writeInt32LE(1, 4);
		await expect(
			tigermanPacFormat.detect(new BufferByteSource(invalid), "Gameexe.dat"),
		).resolves.toBe(false);
	});

	it("validates the complete index during detection", async () => {
		const archive = buildTigerman([
			{ name: "data.bin", content: Buffer.from("plain") },
		]);
		await expect(
			tigermanPacFormat.detect(new BufferByteSource(archive), "data.pac"),
		).resolves.toBe(true);
	});
});
