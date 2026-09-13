import { deflateSync } from "node:zlib";
import { hzcMultiFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const METADATA_OFFSET = 0xc;
const HEADER_SIZE = 0x20;
const FRAME_COUNT_OFFSET = 0x20;

function buildHzc(frames: readonly Buffer[], headerSize = HEADER_SIZE): Buffer {
	const frameSize = frames[0]?.length ?? 0;
	const archive = Buffer.alloc(METADATA_OFFSET + headerSize);
	archive.write("hzc1", 0, "ascii");
	archive.writeInt32LE(frameSize * frames.length, 4);
	archive.writeInt32LE(headerSize, 8);
	archive.write("NVSG", METADATA_OFFSET, "ascii");
	archive.writeUInt16LE(1, 0x12);
	archive.writeUInt16LE(64, 0x14);
	archive.writeUInt16LE(32, 0x16);
	archive.writeInt16LE(4, 0x18);
	archive.writeInt16LE(8, 0x1a);
	archive.writeInt32LE(frames.length, FRAME_COUNT_OFFSET);
	return Buffer.concat([archive, deflateSync(Buffer.concat(frames))]);
}

describe("Favorite View Point multi-frame image", () => {
	it("splits the compressed stream into equal frames", async () => {
		const first = Buffer.alloc(16, 0x11);
		const second = Buffer.alloc(16, 0x22);
		const third = Buffer.alloc(16, 0x33);
		await expectArchive({
			format: hzcMultiFormat,
			archive: buildHzc([first, second, third]),
			sourcePath: "image.hzc",
			entries: [
				{ path: "image#000", size: 16, content: first },
				{ path: "image#001", size: 16, content: second },
				{ path: "image#002", size: 16, content: third },
			],
			metadata: { entryCount: 3 },
		});
	});

	it("treats a zero frame count as a single frame", async () => {
		const frame = Buffer.alloc(24, 0x44);
		const archive = buildHzc([frame]);
		archive.writeInt32LE(0, FRAME_COUNT_OFFSET);
		await expectArchive({
			format: hzcMultiFormat,
			archive,
			sourcePath: "image.hzc",
			entries: [{ path: "image#000", size: 24, content: frame }],
			metadata: { entryCount: 1 },
		});
	});

	it("rejects a file without the image marker", async () => {
		const archive = buildHzc([Buffer.alloc(16, 0x55)]);
		archive.write("NVSF", METADATA_OFFSET, "ascii");
		await expectArchive({
			format: hzcMultiFormat,
			archive,
			sourcePath: "image.hzc",
			detected: false,
			entries: [],
		});
	});

	it("rejects a frame count larger than the unpacked size", async () => {
		const archive = buildHzc([Buffer.alloc(16, 0x66)]);
		archive.writeInt32LE(64, FRAME_COUNT_OFFSET);
		await expectArchive({
			format: hzcMultiFormat,
			archive,
			sourcePath: "image.hzc",
			detected: false,
			entries: [],
		});
	});
});
