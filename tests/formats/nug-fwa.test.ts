import { encodeCp932 } from "@garbro-mcp/core";
import { fwaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

function buildFwa(name: string, payload: Buffer): Buffer {
	const indexOffset = 0x18;
	const dataOffset = indexOffset + 0x40;
	const archive = Buffer.alloc(dataOffset + payload.length);
	archive.write("1AWF", 0, "ascii");
	archive.writeInt32LE(1, 0x0c);
	archive.writeUInt32LE(0x14, 0x10);
	archive.writeUInt32LE(0x40, indexOffset);
	archive.writeUInt32LE(dataOffset, indexOffset + 4);
	archive.writeUInt32LE(payload.length, indexOffset + 8);
	encodeCp932(name).copy(archive, indexOffset + 0x10);
	payload.copy(archive, dataOffset);
	return archive;
}

describe("NUG FWA resource archive", () => {
	it("expands an SCWF LZSS payload", async () => {
		const content = Buffer.from("packed");
		const header = Buffer.alloc(0x20);
		header.write("SCWF", 0, "ascii");
		await expectArchive({
			format: fwaFormat,
			archive: buildFwa(
				"asset.bin",
				Buffer.concat([header, literalLzssStream(content)]),
			),
			entries: [
				{
					path: "asset.bin",
					size: header.length + literalLzssStream(content).length,
					content,
				},
			],
			metadata: { entryCount: 1 },
		});
	});
});
