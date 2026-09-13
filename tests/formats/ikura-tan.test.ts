import { tanFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const HEADER_SIZE = 2;
const FIRST_RECORD_SIZE = 4;
const PALETTE_SIZE = 0x400;
const FRAME_RECORD_SIZE = 4;

interface Frame {
	content: Buffer;
}

/** Builds the metadata block, palette, second count, and frame offset table. */
function buildTan(frames: readonly Frame[]): Buffer {
	const firstCount = frames.length + 1;
	const metadataOffset = HEADER_SIZE + firstCount * FIRST_RECORD_SIZE;
	const frameCountOffset = metadataOffset + 4 + PALETTE_SIZE;
	const frameIndexOffset = frameCountOffset + 2;
	const baseOffset = frameIndexOffset + frames.length * FRAME_RECORD_SIZE;
	const archive = Buffer.alloc(
		baseOffset + frames.reduce((sum, frame) => sum + frame.content.length, 0),
	);
	archive.writeInt16LE(firstCount, 0);
	// Metadata: width, height, then the eight-bit depth implied by the format.
	archive.writeUInt16LE(320, metadataOffset);
	archive.writeUInt16LE(240, metadataOffset + 2);
	archive.writeInt16LE(frames.length, frameCountOffset);
	let offset = baseOffset;
	let position = baseOffset;
	for (const [id, frame] of frames.entries()) {
		archive.writeUInt32LE(
			offset - baseOffset,
			frameIndexOffset + id * FRAME_RECORD_SIZE,
		);
		frame.content.copy(archive, position);
		offset += frame.content.length;
		position += frame.content.length;
	}
	return archive;
}

describe("D.O. animation resource", () => {
	it("reads frames from the second index", async () => {
		const first = Buffer.from("frame one");
		const second = Buffer.from("frame two!");
		const archive = buildTan([{ content: first }, { content: second }]);
		const firstOffset = archive.length - first.length - second.length;
		await expectArchive({
			format: tanFormat,
			archive,
			sourcePath: "anim.tan",
			entries: [
				{
					path: "anim#00",
					size: first.length,
					content: archive.subarray(firstOffset, firstOffset + first.length),
				},
				{
					path: "anim#01",
					size: second.length,
					content: archive.subarray(firstOffset + first.length),
				},
			],
			metadata: { entryCount: 2, width: 320, height: 240 },
		});
	});

	it("requires the tan extension", async () => {
		await expectArchive({
			format: tanFormat,
			archive: buildTan([{ content: Buffer.from("x") }]),
			sourcePath: "anim.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a zero frame count", async () => {
		const archive = buildTan([{ content: Buffer.from("x") }]);
		const frameCountOffset =
			HEADER_SIZE + 2 * FIRST_RECORD_SIZE + 4 + PALETTE_SIZE;
		archive.writeInt16LE(0, frameCountOffset);
		await expectArchive({
			format: tanFormat,
			archive,
			sourcePath: "anim.tan",
			detected: false,
			entries: [],
		});
	});
});
