import { c24Format, c25Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 8;

interface Frame {
	content: Buffer;
	/** Overrides the recorded offset, for example to skip a frame. */
	offset?: number;
}

function buildFrames(frames: readonly Frame[], signature: string): Buffer {
	const count = frames.length;
	const dataOffset = INDEX_OFFSET + count * 4;
	const archive = Buffer.alloc(
		dataOffset + frames.reduce((sum, frame) => sum + frame.content.length, 0),
	);
	archive.write(signature, 0, "ascii");
	archive.writeInt32LE(count, 4);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, frame] of frames.entries()) {
		archive.writeUInt32LE(frame.offset ?? offset, INDEX_OFFSET + id * 4);
		frame.content.copy(archive, position);
		offset += frame.content.length;
		position += frame.content.length;
	}
	return archive;
}

describe("Foster C24/C25 multi-image", () => {
	it("reads frame offsets and derives sizes", async () => {
		const first = Buffer.from("frame one");
		const second = Buffer.from("frame two!");
		await expectArchive({
			format: c24Format,
			archive: buildFrames([{ content: first }, { content: second }], "C24\0"),
			sourcePath: "graphic.c24",
			entries: [
				{ path: "graphic@0000", size: first.length, content: first },
				{ path: "graphic@0001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("skips out-of-range offsets and keeps original names", async () => {
		const first = Buffer.from("only frame");
		const archive = buildFrames(
			[{ content: first }, { content: Buffer.from("ignored"), offset: 0 }],
			"C25\0",
		);
		await expectArchive({
			format: c25Format,
			archive,
			sourcePath: "graphic.c25",
			entries: [
				{
					path: "graphic@0000",
					size: first.length + "ignored".length,
					content: archive.subarray(INDEX_OFFSET + 8),
				},
			],
			metadata: { entryCount: 1 },
		});
	});

	it("rejects a mismatched signature", async () => {
		const archive = buildFrames([{ content: Buffer.from("x") }], "C24\0");
		await expectArchive({
			format: c25Format,
			archive,
			sourcePath: "graphic.c25",
			detected: false,
			entries: [],
		});
	});
});
