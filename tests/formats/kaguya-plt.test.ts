import { kaguyaPltFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const FIRST_FRAME_OFFSET = 0x16;
const FRAME_HEADER_SIZE = 0x14;

interface Frame {
	width: number;
	height: number;
	depth: number;
	/** Pixels are filled with this byte so frames can be told apart. */
	fill: number;
}

/** Frames carry a 0x14-byte header giving depth, width and height, then their pixels. */
function buildPlt(frames: readonly Frame[]): {
	archive: Buffer;
	contents: Buffer[];
	firstFrameOffset: number;
} {
	const contents: Buffer[] = [];
	for (const frame of frames) {
		const imageSize = frame.depth * frame.width * frame.height;
		const header = Buffer.alloc(FRAME_HEADER_SIZE);
		header.writeUInt32LE(frame.width, 8);
		header.writeUInt32LE(frame.height, 0x0c);
		header.writeUInt32LE(frame.depth, 0x10);
		contents.push(Buffer.concat([header, Buffer.alloc(imageSize, frame.fill)]));
	}
	const body = Buffer.concat(contents);
	const archive = Buffer.alloc(FIRST_FRAME_OFFSET + body.length);
	archive.write("PL00", 0, "ascii");
	archive.writeInt16LE(frames.length, 4);
	body.copy(archive, FIRST_FRAME_OFFSET);
	return { archive, contents, firstFrameOffset: FIRST_FRAME_OFFSET };
}

describe("KaGuYa PLT animation resource", () => {
	it("derives frame sizes from the depth, width and height", async () => {
		const { archive, contents } = buildPlt([
			{ width: 4, height: 2, depth: 1, fill: 0x11 },
			{ width: 2, height: 2, depth: 4, fill: 0x22 },
		]);
		await expectArchive({
			format: kaguyaPltFormat,
			archive,
			sourcePath: "anim.plt",
			entries: [
				{
					path: "anim#00",
					size: contents[0]?.length ?? 0,
					content: contents[0] ?? Buffer.alloc(0),
				},
				{
					path: "anim#01",
					size: contents[1]?.length ?? 0,
					content: contents[1] ?? Buffer.alloc(0),
				},
			],
		});
	});

	it("rejects a foreign signature", async () => {
		const { archive } = buildPlt([{ width: 1, height: 1, depth: 1, fill: 0 }]);
		archive.write("PL10", 0, "ascii");
		await expectArchive({
			format: kaguyaPltFormat,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty frame count", async () => {
		const { archive } = buildPlt([{ width: 1, height: 1, depth: 1, fill: 0 }]);
		archive.writeInt16LE(0, 4);
		await expectArchive({
			format: kaguyaPltFormat,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});

	it("rejects a frame that runs past the file", async () => {
		const { archive, firstFrameOffset } = buildPlt([
			{ width: 4, height: 4, depth: 4, fill: 0 },
		]);
		// Widening the first frame's declared width makes its derived span leave the file.
		archive.writeUInt32LE(0x100, firstFrameOffset + 8);
		await expectArchive({
			format: kaguyaPltFormat,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});
});
