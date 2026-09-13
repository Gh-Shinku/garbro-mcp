import { smvFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x40;
const HEADER_SIZE = 0x2c;
const PALETTE_SIZE = 0x400;

interface Frame {
	content: Buffer;
}

function buildSmv(frames: readonly Frame[]): Buffer {
	const indexOffset = INDEX_OFFSET + HEADER_SIZE + 4 + PALETTE_SIZE;
	const dataOffset = indexOffset + frames.length * 8;
	const archive = Buffer.alloc(
		dataOffset + frames.reduce((sum, frame) => sum + frame.content.length, 0),
	);
	archive.write("SMV1", 0, "ascii");
	archive.writeUInt32LE(archive.length, 4);
	archive.writeInt32LE(frames.length, 8);
	archive.writeUInt32LE(HEADER_SIZE, INDEX_OFFSET);
	archive.writeInt32LE(8, 0x4e);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, frame] of frames.entries()) {
		const record = indexOffset + id * 8;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(frame.content.length, record + 4);
		frame.content.copy(archive, position);
		offset += frame.content.length;
		position += frame.content.length;
	}
	return archive;
}

describe("Tanaka SMV animation resource", () => {
	it("reads the frame records behind the palette", async () => {
		const first = Buffer.from("frame one");
		const second = Buffer.from("frame two!");
		await expectArchive({
			format: smvFormat,
			archive: buildSmv([{ content: first }, { content: second }]),
			sourcePath: "anim.smv",
			entries: [
				{ path: "anim#00", size: first.length, content: first },
				{ path: "anim#01", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a size field that does not match the file", async () => {
		const archive = buildSmv([{ content: Buffer.from("x") }]);
		archive.writeUInt32LE(archive.length + 4, 4);
		await expectArchive({
			format: smvFormat,
			archive,
			sourcePath: "anim.smv",
			detected: false,
			entries: [],
		});
	});

	it("rejects a depth other than eight", async () => {
		const archive = buildSmv([{ content: Buffer.from("x") }]);
		archive.writeInt32LE(24, 0x4e);
		await expectArchive({
			format: smvFormat,
			archive,
			sourcePath: "anim.smv",
			detected: false,
			entries: [],
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildSmv([{ content: Buffer.from("x") }]);
		archive.write("SMV2", 0, "ascii");
		await expectArchive({
			format: smvFormat,
			archive,
			sourcePath: "anim.smv",
			detected: false,
			entries: [],
		});
	});
});
