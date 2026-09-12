import { kaasPbFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildPb(contents: Buffer[]): Buffer {
	const indexOffset = 0x10;
	const dataOffset = indexOffset + contents.length * 8;
	const total =
		dataOffset + contents.reduce((sum, item) => sum + item.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(contents.length, 0);
	let offset = dataOffset;
	for (const [index, content] of contents.entries()) {
		const record = indexOffset + index * 8;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(content.length, record + 4);
		content.copy(archive, offset);
		offset += content.length;
	}
	return archive;
}

describe("KAAS PB archive", () => {
	it("reads a 0x10-based 8-byte index", async () => {
		await expectArchive({
			format: kaasPbFormat,
			archive: buildPb([Buffer.from("voice-a"), Buffer.from("voice-bb")]),
			sourcePath: "se.pb",
			entries: [
				{ path: "0000", size: 7, content: Buffer.from("voice-a") },
				{ path: "0001", size: 8, content: Buffer.from("voice-bb") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("appends a .pb extension for voice.pb containers", async () => {
		await expectArchive({
			format: kaasPbFormat,
			archive: buildPb([Buffer.from("x")]),
			sourcePath: "voice.pb",
			entries: [{ path: "0000.pb", size: 1, content: Buffer.from("x") }],
		});
	});
});
