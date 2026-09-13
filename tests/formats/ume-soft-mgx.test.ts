import { mgxFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 8;

/** The header is the signature and a frame count, then one offset per frame and the frame data. */
function buildMgx(frames: readonly Buffer[]): Buffer {
	const indexSize = frames.length * 4;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + frames.reduce((sum, frame) => sum + frame.length, 0),
	);
	archive.write("MGX", 0, "ascii");
	archive.writeUInt8(0x1a, 3);
	archive.writeInt32LE(frames.length, 4);
	let position = dataOffset;
	for (const [id, frame] of frames.entries()) {
		archive.writeUInt32LE(position, INDEX_OFFSET + id * 4);
		frame.copy(archive, position);
		position += frame.length;
	}
	return archive;
}

describe("U-Me Soft MGX multi-frame image", () => {
	it("derives frame names and sizes", async () => {
		const first = Buffer.from("first frame");
		const second = Buffer.from("second frame body");
		await expectArchive({
			format: mgxFormat,
			archive: buildMgx([first, second]),
			sourcePath: "anim.grx",
			entries: [
				{ path: "anim#0000.GRX", size: first.length, content: first },
				{ path: "anim#0001.GRX", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildMgx([Buffer.from("frame")]);
		archive.write("MGS", 0, "ascii");
		await expectArchive({
			format: mgxFormat,
			archive,
			sourcePath: "anim.grx",
			detected: false,
			entries: [],
		});
	});

	it("rejects an offset beyond the file", async () => {
		const archive = buildMgx([Buffer.from("frame")]);
		archive.writeUInt32LE(archive.length + 4, INDEX_OFFSET);
		await expectArchive({
			format: mgxFormat,
			archive,
			sourcePath: "anim.grx",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty frame count", async () => {
		const archive = buildMgx([Buffer.from("frame")]);
		archive.writeInt32LE(0, 4);
		await expectArchive({
			format: mgxFormat,
			archive,
			sourcePath: "anim.grx",
			detected: false,
			entries: [],
		});
	});
});
