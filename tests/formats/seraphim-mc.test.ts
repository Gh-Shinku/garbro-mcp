import { seraphimMcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildSeraphimMc(frames: Buffer[]): Buffer {
	const records = frames.map((frame) => {
		const header = Buffer.alloc(4);
		header.writeUInt32LE(frame.length, 0);
		return Buffer.concat([header, frame]);
	});
	const total = records.reduce((sum, record) => sum + record.length, 0) + 0x14;
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(0, 0);
	archive.write("MC", 4, "ascii");
	archive.writeInt32LE(frames.length, 8);
	archive.writeUInt32LE(total - 0x14, 0x10);
	let offset = 0x14;
	for (const record of records) {
		record.copy(archive, offset);
		offset += record.length;
	}
	return archive;
}

describe("Seraphim MC animation", () => {
	it("walks size-prefixed frames", async () => {
		await expectArchive({
			format: seraphimMcFormat,
			archive: buildSeraphimMc([Buffer.from("frame1"), Buffer.from("f2")]),
			sourcePath: "scene.mc",
			entries: [
				{ path: "scene#0000.cb", size: 6, content: Buffer.from("frame1") },
				{ path: "scene#0001.cb", size: 2, content: Buffer.from("f2") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
