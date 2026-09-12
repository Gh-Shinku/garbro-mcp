import { pinesoftVoiceFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildVoice(contents: Buffer[]): Buffer {
	const headerSize = (contents.length + 1) * 4 + 0x28;
	const dataOffset = headerSize;
	const total = dataOffset + contents.reduce((sum, c) => sum + c.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(headerSize, 0);
	archive.writeInt32LE(contents.length, 0x24);
	let offset = dataOffset;
	for (const [id, content] of contents.entries()) {
		archive.writeUInt32LE(offset, 0x28 + id * 4);
		content.copy(archive, offset);
		offset += content.length;
	}
	archive.writeUInt32LE(offset, 0x28 + contents.length * 4);
	return archive;
}

describe("PineSoft voice archive", () => {
	it("derives sizes from the offset table and validates the final offset", async () => {
		await expectArchive({
			format: pinesoftVoiceFormat,
			archive: buildVoice([Buffer.from("one"), Buffer.from("twoo")]),
			sourcePath: "voice.cmb",
			entries: [
				{ path: "voice#00000", size: 3, content: Buffer.from("one") },
				{ path: "voice#00001", size: 4, content: Buffer.from("twoo") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
