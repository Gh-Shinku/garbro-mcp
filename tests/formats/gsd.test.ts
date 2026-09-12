import { gsdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildGsd(contents: Buffer[]): Buffer {
	const indexOffset = 0x34;
	const baseOffset = indexOffset + contents.length * 0x20 + 0x10;
	const dataOffset = baseOffset;
	const total =
		dataOffset + contents.reduce((sum, content) => sum + content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("GSD\0", 0, "binary");
	archive.writeUInt32LE(baseOffset, 8);
	archive.writeInt32LE(contents.length, 0x1c);
	let offset = dataOffset;
	for (const [index, content] of contents.entries()) {
		const record = indexOffset + index * 0x20;
		archive.writeUInt32LE(offset - baseOffset, record);
		archive.writeUInt32LE(content.length, record + 4);
		content.copy(archive, offset);
		offset += content.length;
	}
	return archive;
}

describe("MicroVision GSD archive", () => {
	it("reads a base-relative index and generates WAV names", async () => {
		await expectArchive({
			format: gsdFormat,
			archive: buildGsd([Buffer.from("RIFF1"), Buffer.from("RIFF2")]),
			entries: [
				{ path: "00000.wav", size: 5, content: Buffer.from("RIFF1") },
				{ path: "00001.wav", size: 5, content: Buffer.from("RIFF2") },
			],
			metadata: { entryCount: 2, baseOffset: BigInt(0x34 + 2 * 0x20 + 0x10) },
		});
	});
});
