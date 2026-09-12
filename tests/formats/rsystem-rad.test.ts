import { radFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildRad(frames: Buffer[]): Buffer {
	const indexOffset = 4;
	const indexSize = frames.length * 4;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + frames.reduce((sum, frame) => sum + frame.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(frames.length, 0);
	let offset = dataOffset;
	for (const [id, frame] of frames.entries()) {
		archive.writeUInt32LE(offset, indexOffset + id * 4);
		frame.copy(archive, offset);
		offset += frame.length;
	}
	return archive;
}

describe("RSystem RAD multi-frame image", () => {
	it("derives frame sizes from the offset table", async () => {
		await expectArchive({
			format: radFormat,
			archive: buildRad([Buffer.from("aa"), Buffer.from("bbb")]),
			sourcePath: "cg.rad",
			entries: [
				{ path: "cg#000", size: 2, content: Buffer.from("aa") },
				{ path: "cg#001", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { frameCount: 2 },
		});
	});
});
