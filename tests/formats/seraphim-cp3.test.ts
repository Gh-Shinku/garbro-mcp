import { cp3Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const FIRST_FRAME_OFFSET = 0x2c;
const FRAME_HEADER_SIZE = 0x10;

interface Frame {
	width: number;
	height: number;
	pixels: Buffer;
}

function buildCp3(frames: readonly Frame[]): Buffer {
	const parts: Buffer[] = [Buffer.alloc(FIRST_FRAME_OFFSET)];
	for (const frame of frames) {
		const header = Buffer.alloc(FRAME_HEADER_SIZE);
		header.writeUInt32LE(frame.width, 8);
		header.writeUInt32LE(frame.height, 12);
		parts.push(
			Buffer.concat([
				header,
				frame.pixels,
				Buffer.alloc(frame.width * frame.height * 4 - frame.pixels.length),
			]),
		);
	}
	const archive = Buffer.concat(parts);
	archive.write("CP3X", 0, "ascii");
	archive.writeInt32LE(frames.length, 8);
	return archive;
}

function frame(size: number): Frame {
	return { width: 2, height: 1, pixels: Buffer.alloc(size, 0x11) };
}

describe("Seraphim CP3 multi-frame image", () => {
	it("walks frames sized from their own dimensions", async () => {
		const first = frame(8);
		const second = frame(8);
		const archive = buildCp3([first, second]);
		await expectArchive({
			format: cp3Format,
			archive,
			sourcePath: "graphic.cp3",
			entries: [
				{
					path: "graphic#0000",
					size: FRAME_HEADER_SIZE + 8,
					content: archive.subarray(
						FIRST_FRAME_OFFSET,
						FIRST_FRAME_OFFSET + FRAME_HEADER_SIZE + 8,
					),
				},
				{
					path: "graphic#0001",
					size: FRAME_HEADER_SIZE + 8,
					content: archive.subarray(
						FIRST_FRAME_OFFSET + FRAME_HEADER_SIZE + 8,
						FIRST_FRAME_OFFSET + (FRAME_HEADER_SIZE + 8) * 2,
					),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("skips empty frames while advancing the walk", async () => {
		const empty = { width: 0, height: 4, pixels: Buffer.alloc(0) };
		const filled = frame(8);
		const archive = buildCp3([empty, filled]);
		await expectArchive({
			format: cp3Format,
			archive,
			sourcePath: "graphic.cp3",
			entries: [
				{
					path: "graphic#0001",
					size: FRAME_HEADER_SIZE + 8,
					content: archive.subarray(FIRST_FRAME_OFFSET + FRAME_HEADER_SIZE),
				},
			],
			metadata: { entryCount: 1 },
		});
	});

	it("rejects frames that exceed the file", async () => {
		const archive = buildCp3([frame(8)]);
		archive.writeUInt32LE(0x1000, FIRST_FRAME_OFFSET + 8);
		await expectArchive({
			format: cp3Format,
			archive,
			sourcePath: "graphic.cp3",
			detected: false,
			entries: [],
		});
	});
});
