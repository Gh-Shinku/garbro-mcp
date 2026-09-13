import { an10Format, an20Format, anmFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

interface Frame {
	width: number;
	height: number;
	depth: number;
	fill: number;
}

function frameBuffer(frame: Frame, headerSize: number): Buffer {
	const imageSize = frame.depth * frame.width * frame.height;
	const header = Buffer.alloc(headerSize);
	header.writeUInt32LE(frame.width, 8);
	header.writeUInt32LE(frame.height, 0x0c);
	if (headerSize > 0x10) header.writeUInt32LE(frame.depth, 0x10);
	return Buffer.concat([header, Buffer.alloc(imageSize, frame.fill)]);
}

/** Versions 00 and 10 reach their frame list through a count at 0x14 and a four-byte table behind it. */
function buildAn0x(
	signature: string,
	frames: readonly Frame[],
	headerSize: number,
): Buffer {
	const firstCount = 1;
	const tableEnd = 0x18 + firstCount * 4;
	const parts = frames.map((frame) => frameBuffer(frame, headerSize));
	const body = Buffer.concat(parts);
	const archive = Buffer.alloc(tableEnd + 2 + body.length);
	archive.write(signature, 0, "ascii");
	archive.writeInt16LE(firstCount, 0x14);
	archive.writeInt16LE(frames.length, tableEnd);
	body.copy(archive, tableEnd + 2);
	return archive;
}

/** Version 20 walks the shared preamble, then a count, then a sixteen-byte gap before the frames. */
function buildAn20(frames: readonly Frame[]): Buffer {
	const tableEnd = 10;
	const framesStart = tableEnd + 2 + 0x10;
	const parts = frames.map((frame) => frameBuffer(frame, 0x14));
	const body = Buffer.concat(parts);
	const archive = Buffer.alloc(framesStart + body.length);
	archive.write("AN20", 0, "ascii");
	archive.writeUInt16LE(0, 4);
	archive.writeUInt16LE(0, 8);
	archive.writeInt16LE(frames.length, tableEnd);
	body.copy(archive, framesStart);
	return archive;
}

describe("KaGuYa ANM animation resources", () => {
	it("reads the version 00 layout with thirty-two bits per pixel", async () => {
		const frames: Frame[] = [
			{ width: 2, height: 2, depth: 4, fill: 0x11 },
			{ width: 1, height: 3, depth: 4, fill: 0x22 },
		];
		const archive = buildAn0x("AN00", frames, 0x10);
		await expectArchive({
			format: anmFormat,
			archive,
			sourcePath: "anim.anm",
			entries: [
				{
					path: "anim#00",
					size: frameBuffer(frames[0] as Frame, 0x10).length,
					content: frameBuffer(frames[0] as Frame, 0x10),
				},
				{
					path: "anim#01",
					size: frameBuffer(frames[1] as Frame, 0x10).length,
					content: frameBuffer(frames[1] as Frame, 0x10),
				},
			],
		});
	});

	it("reads the version 10 layout with a channel word", async () => {
		const frames: Frame[] = [{ width: 2, height: 2, depth: 3, fill: 0x33 }];
		const archive = buildAn0x("AN10", frames, 0x14);
		await expectArchive({
			format: an10Format,
			archive,
			sourcePath: "anim.anm",
			entries: [
				{
					path: "anim#00",
					size: frameBuffer(frames[0] as Frame, 0x14).length,
					content: frameBuffer(frames[0] as Frame, 0x14),
				},
			],
		});
	});

	it("reads the version 20 layout through the shared preamble", async () => {
		const frames: Frame[] = [
			{ width: 3, height: 1, depth: 2, fill: 0x44 },
			{ width: 1, height: 1, depth: 2, fill: 0x55 },
		];
		const archive = buildAn20(frames);
		await expectArchive({
			format: an20Format,
			archive,
			sourcePath: "anim.anm",
			entries: [
				{
					path: "anim#00",
					size: frameBuffer(frames[0] as Frame, 0x14).length,
					content: frameBuffer(frames[0] as Frame, 0x14),
				},
				{
					path: "anim#01",
					size: frameBuffer(frames[1] as Frame, 0x14).length,
					content: frameBuffer(frames[1] as Frame, 0x14),
				},
			],
		});
	});

	it("rejects a foreign signature", async () => {
		const frames: Frame[] = [{ width: 1, height: 1, depth: 4, fill: 0 }];
		const archive = buildAn0x("AN00", frames, 0x10);
		archive.write("AN01", 0, "ascii");
		await expectArchive({
			format: anmFormat,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});

	it("rejects a frame whose span leaves the file", async () => {
		const frames: Frame[] = [{ width: 2, height: 2, depth: 4, fill: 0 }];
		const archive = buildAn0x("AN00", frames, 0x10);
		archive.writeUInt32LE(0x100, 0x18 + 4 + 2 + 8);
		await expectArchive({
			format: anmFormat,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});
});
