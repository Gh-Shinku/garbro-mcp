import { vsdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildVsd(payload: Buffer, skip = 0x30): Buffer {
	const archive = Buffer.alloc(8 + skip + payload.length);
	archive.write("VSD1", 0, "ascii");
	archive.writeUInt32LE(skip, 4);
	payload.copy(archive, 8 + skip);
	return archive;
}

describe("AI5WIN VSD video file", () => {
	it("exposes the payload after the declared skip as an MPG stream", async () => {
		await expectArchive({
			format: vsdFormat,
			archive: buildVsd(Buffer.from("video bytes")),
			sourcePath: "opening.vsd",
			entries: [
				{ path: "opening.mpg", size: 11, content: Buffer.from("video bytes") },
			],
			metadata: { streamOffset: 0x38n },
		});
	});
});
