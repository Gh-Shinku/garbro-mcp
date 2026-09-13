import { animFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const TABLE_OFFSET = 0x18;
const FRAME_HEADER_SIZE = 6;

interface AnimFrame {
	content: Buffer;
}

function buildAnim(
	frames: readonly AnimFrame[],
	audio?: { content: Buffer },
): Buffer {
	const count = frames.length;
	const tableOffset = TABLE_OFFSET + count * FRAME_HEADER_SIZE;
	const dataOffset = tableOffset + count * 8;
	const archive = Buffer.alloc(
		dataOffset +
			frames.reduce((sum, frame) => sum + frame.content.length, 0) +
			(audio?.content.length ?? 0),
	);
	archive.writeInt32LE(count, 0);
	archive.writeInt32LE(0x21, 4);
	archive.writeInt32LE(640, 8);
	archive.writeInt32LE(480, 12);
	let offset = dataOffset;
	for (const [id, frame] of frames.entries()) {
		archive.writeUInt32LE(offset, tableOffset + id * 4);
		archive.writeUInt32LE(
			frame.content.length,
			tableOffset + count * 4 + id * 4,
		);
		frame.content.copy(archive, offset);
		offset += frame.content.length;
	}
	if (audio) {
		archive.writeUInt32LE(audio.content.length, 0x10);
		archive.writeUInt32LE(offset, 0x14);
		audio.content.copy(archive, offset);
	}
	return archive;
}

describe("Marble engine video", () => {
	it("reads frame tables and an audio track", async () => {
		const first = Buffer.from("BM frame one");
		const second = Buffer.from("BM frame two!");
		const audio = Buffer.from("WAVE audio");
		await expectArchive({
			format: animFormat,
			archive: buildAnim([{ content: first }, { content: second }], {
				content: audio,
			}),
			sourcePath: "movie",
			entries: [
				{ path: "movie#00000.jpg", size: first.length, content: first },
				{ path: "movie#00001.jpg", size: second.length, content: second },
				{ path: "movie#audio.way", size: audio.length, content: audio },
			],
			metadata: { entryCount: 3, width: 640, height: 480 },
		});
	});

	it("reads a video without audio", async () => {
		const frame = Buffer.from("BM only frame");
		await expectArchive({
			format: animFormat,
			archive: buildAnim([{ content: frame }]),
			sourcePath: "movie",
			entries: [
				{ path: "movie#00000.jpg", size: frame.length, content: frame },
			],
			metadata: { entryCount: 1 },
		});
	});

	it("rejects a wrong frame duration", async () => {
		const archive = buildAnim([{ content: Buffer.from("BM") }]);
		archive.writeInt32LE(0x20, 4);
		await expectArchive({
			format: animFormat,
			archive,
			sourcePath: "movie",
			detected: false,
			entries: [],
		});
	});

	it("rejects out-of-range dimensions", async () => {
		const archive = buildAnim([{ content: Buffer.from("BM") }]);
		archive.writeInt32LE(0x2000, 8);
		await expectArchive({
			format: animFormat,
			archive,
			sourcePath: "movie",
			detected: false,
			entries: [],
		});
	});
});
