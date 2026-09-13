import { gafFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0x0c;
const WIDTH = 4;
const HEIGHT = 2;
const IMAGE_SIZE = WIDTH * HEIGHT;

/** Builds a frame whose two-byte steps add up to the pixel count. */
function frame(steps: readonly number[]): Buffer {
	const body = Buffer.alloc(steps.length * 2);
	for (const [id, count] of steps.entries()) body.writeUInt8(count, id * 2 + 1);
	return body;
}

function buildGaf(frames: readonly Buffer[]): Buffer {
	const archive = Buffer.concat([Buffer.alloc(INDEX_OFFSET), ...frames]);
	archive.writeUInt32LE(WIDTH, 0);
	archive.writeUInt32LE(HEIGHT, 4);
	archive.writeInt32LE(frames.length, COUNT_OFFSET);
	return archive;
}

describe("origin engine GAF bitmap archive", () => {
	it("sizes frames by walking their RLE steps", async () => {
		const first = frame([3, 3, 2]);
		const second = frame([8]);
		const archive = buildGaf([first, second]);
		await expectArchive({
			format: gafFormat,
			archive,
			sourcePath: "gaf",
			entries: [
				{ path: "gaf#0000", size: first.length, content: first },
				{ path: "gaf#0001", size: second.length, content: second },
			],
			metadata: { entryCount: 2, width: WIDTH, height: HEIGHT },
		});
	});

	it("lets the last frame run to the end of the file", async () => {
		const first = frame([IMAGE_SIZE]);
		const second = Buffer.from("trailing frame bytes");
		const archive = buildGaf([first, second]);
		await expectArchive({
			format: gafFormat,
			archive,
			sourcePath: "gaf",
			entries: [
				{ path: "gaf#0000", size: first.length, content: first },
				{ path: "gaf#0001", size: second.length, content: second },
			],
		});
	});

	it("requires the gaf file name", async () => {
		const archive = buildGaf([frame([IMAGE_SIZE])]);
		await expectArchive({
			format: gafFormat,
			archive,
			sourcePath: "graphics",
			detected: false,
			entries: [],
		});
	});

	it("rejects an incomplete frame chain", async () => {
		// Three pixels short of a full image.
		const archive = buildGaf([frame([1]), frame([IMAGE_SIZE])]);
		await expectArchive({
			format: gafFormat,
			archive,
			sourcePath: "gaf",
			detected: false,
			entries: [],
		});
	});

	it("rejects dimensions beyond the limit", async () => {
		const archive = buildGaf([frame([IMAGE_SIZE])]);
		archive.writeUInt32LE(0x4001, 0);
		await expectArchive({
			format: gafFormat,
			archive,
			sourcePath: "gaf",
			detected: false,
			entries: [],
		});
	});
});
