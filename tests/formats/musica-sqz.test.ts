import { sqzFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const COUNT_OFFSET = 0x10;
const INDEX_OFFSET = 0x14;

interface Frame {
	content: Buffer;
}

/** The stored count is half the number of frames. */
function buildSqz(frames: readonly Frame[]): Buffer {
	const count = frames.length;
	const dataOffset = INDEX_OFFSET + count * 8;
	const archive = Buffer.alloc(
		dataOffset + frames.reduce((sum, frame) => sum + frame.content.length, 0),
	);
	archive.write("SQZ1", 0, "ascii");
	archive.writeUInt32LE(640, 8);
	archive.writeUInt32LE(480, 0x0c);
	archive.writeInt32LE(count / 2, COUNT_OFFSET);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, frame] of frames.entries()) {
		const record = INDEX_OFFSET + id * 8;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(frame.content.length, record + 4);
		frame.content.copy(archive, position);
		offset += frame.content.length;
		position += frame.content.length;
	}
	return archive;
}

describe("Musica SQZ animated frames", () => {
	it("reads the frame table", async () => {
		const first = Buffer.from("frame one");
		const second = Buffer.from("frame two!");
		await expectArchive({
			format: sqzFormat,
			archive: buildSqz([{ content: first }, { content: second }]),
			sourcePath: "anim.sqz",
			entries: [
				{ path: "anim#0000", size: first.length, content: first },
				{ path: "anim#0001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildSqz([
			{ content: Buffer.from("x") },
			{ content: Buffer.from("y") },
		]);
		archive.write("SQZ2", 0, "ascii");
		await expectArchive({
			format: sqzFormat,
			archive,
			sourcePath: "anim.sqz",
			detected: false,
			entries: [],
		});
	});

	it("rejects a frame outside the file", async () => {
		const archive = buildSqz([
			{ content: Buffer.from("x") },
			{ content: Buffer.from("y") },
		]);
		archive.writeUInt32LE(0x100000, INDEX_OFFSET);
		await expectArchive({
			format: sqzFormat,
			archive,
			sourcePath: "anim.sqz",
			detected: false,
			entries: [],
		});
	});
});
