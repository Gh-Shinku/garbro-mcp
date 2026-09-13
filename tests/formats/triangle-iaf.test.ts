import { iafFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildIaf(frames: Buffer[]): Buffer {
	const chunks = frames.map((frame) => {
		const chunk = Buffer.alloc(0x19 + frame.length);
		chunk.writeUInt32LE(frame.length, 1);
		frame.copy(chunk, 0x19);
		return chunk;
	});
	return Buffer.concat(chunks);
}

describe("route2 IAF multi-frame image", () => {
	it("walks size-prefixed frames starting at offset 1", async () => {
		await expectArchive({
			format: iafFormat,
			archive: buildIaf([Buffer.from("aa"), Buffer.from("bbb")]),
			sourcePath: "cg.iaf",
			entries: [
				{ path: "cg#000.IAF", size: 0x19 + 2, content: undefined },
				{ path: "cg#001.IAF", size: 0x19 + 3, content: undefined },
			],
			metadata: { frameCount: 2 },
		});
	});
});
