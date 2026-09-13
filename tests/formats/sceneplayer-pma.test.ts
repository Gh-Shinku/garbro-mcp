import { pmaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";
import { deflateSync } from "node:zlib";

const PMA_KEY = 0x21;

/** Builds a bitmap frame: the `BM` marker, the frame size, and the pixel data. */
function frame(pixels: Buffer): Buffer {
	const size = 2 + 4 + pixels.length;
	const record = Buffer.alloc(size);
	record.writeUInt16LE(0x4d42, 0);
	record.writeUInt32LE(size, 2);
	pixels.copy(record, 6);
	return record;
}

/** Wraps decoded container bytes the way ScenePlayer stores them. */
function buildPmaContainer(frames: readonly Buffer[]): Buffer {
	const decoded = Buffer.alloc(
		4 + frames.reduce((sum, item) => sum + 1 + item.length, 0),
	);
	decoded.writeInt32LE(frames.length, 0);
	let position = 4;
	for (const item of frames) {
		// One skipped byte precedes every frame.
		position += 1;
		item.copy(decoded, position);
		position += item.length;
	}
	const stored = Buffer.from(deflateSync(decoded));
	for (let index = 0; index < stored.length; index += 1)
		stored[index] = (stored[index] ?? 0) ^ PMA_KEY;
	return stored;
}

describe("ScenePlayer PMA animation resource", () => {
	it("reads bitmap frames from the decoded container", async () => {
		const first = frame(Buffer.from("pixels one"));
		const second = frame(Buffer.from("pixels two"));
		await expectArchive({
			format: pmaFormat,
			archive: buildPmaContainer([first, second]),
			sourcePath: "movie.pma",
			entries: [
				{ path: "movie#0000.bmp", size: first.length, content: first },
				{ path: "movie#0001.bmp", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a frame without a bitmap marker", async () => {
		const broken = frame(Buffer.from("pixels"));
		broken.writeUInt16LE(0x4d43, 0);
		await expectArchive({
			format: pmaFormat,
			archive: buildPmaContainer([broken]),
			sourcePath: "movie.pma",
			detected: false,
			entries: [],
		});
	});

	it("requires the pma extension", async () => {
		await expectArchive({
			format: pmaFormat,
			archive: buildPmaContainer([frame(Buffer.from("pixels"))]),
			sourcePath: "movie.bin",
			detected: false,
			entries: [],
		});
	});
});
