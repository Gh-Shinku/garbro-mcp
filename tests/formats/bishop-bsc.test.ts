import { bishopBscFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildBsc(frames: Buffer[]): Buffer {
	const header = Buffer.alloc(0x20);
	header.write("BSS-Composition\0", 0, "binary");
	header[0x11] = frames.length;
	const chunks = frames.map((frame) => {
		const chunk = Buffer.alloc(0x40);
		chunk.writeUInt32LE(frame.length, 0x36);
		return Buffer.concat([chunk, frame]);
	});
	return Buffer.concat([header, ...chunks]);
}

describe("Bishop BSC composite image", () => {
	it("lists 0x40-byte-headed frames", async () => {
		await expectArchive({
			format: bishopBscFormat,
			archive: buildBsc([Buffer.from("frame-a"), Buffer.from("frame-bb")]),
			sourcePath: "cg.bsc",
			entries: [
				{ path: "cg#000.bsg", size: 0x47, content: undefined },
				{ path: "cg#001.bsg", size: 0x48, content: undefined },
			],
			metadata: { frameCount: 2 },
		});
	});
});
