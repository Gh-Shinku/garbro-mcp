import { patisserieRawFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const FIRST_FRAME_OFFSET = 8;
const FRAME_HEADER_SIZE = 0x14;

function buildRaw(
	frames: readonly { width: number; height: number }[],
): Buffer {
	const parts = frames.map((frame) => {
		const header = Buffer.alloc(FRAME_HEADER_SIZE);
		header.writeUInt32LE(frame.width, 0x0c);
		header.writeUInt32LE(frame.height, 0x10);
		return Buffer.concat([
			header,
			Buffer.alloc(frame.width * frame.height * 4, 0x22),
		]);
	});
	const body = Buffer.concat(parts);
	const archive = Buffer.concat([Buffer.alloc(FIRST_FRAME_OFFSET), body]);
	archive.write("RAW\x04", 0, "latin1");
	archive.writeUInt32LE(body.length, 4);
	return archive;
}

describe("Patisserie RAW animation", () => {
	it("walks frames sized from their dimensions", async () => {
		const archive = buildRaw([
			{ width: 2, height: 1 },
			{ width: 1, height: 2 },
		]);
		const firstSize = FRAME_HEADER_SIZE + 8;
		await expectArchive({
			format: patisserieRawFormat,
			archive,
			sourcePath: "anim.raw",
			entries: [
				{
					path: "0000",
					size: firstSize,
					content: archive.subarray(
						FIRST_FRAME_OFFSET,
						FIRST_FRAME_OFFSET + firstSize,
					),
				},
				{
					path: "0001",
					size: firstSize,
					content: archive.subarray(FIRST_FRAME_OFFSET + firstSize),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects an end offset beyond the file", async () => {
		const archive = buildRaw([{ width: 1, height: 1 }]);
		archive.writeUInt32LE(0x100000, 4);
		await expectArchive({
			format: patisserieRawFormat,
			archive,
			sourcePath: "anim.raw",
			detected: false,
			entries: [],
		});
	});
});
