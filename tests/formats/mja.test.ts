import { BufferByteSource } from "@garbro-mcp/core";
import { mjaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, expect, it } from "vitest";

function buildMja(chunks: Buffer[]): Buffer {
	const total = 8 + chunks.reduce((sum, chunk) => sum + 4 + chunk.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("MJA0", 0, "ascii");
	archive.writeInt32LE(chunks.length, 4);
	let offset = 8;
	for (const chunk of chunks) {
		archive.writeUInt32LE(chunk.length, offset);
		chunk.copy(archive, offset + 4);
		offset += 4 + chunk.length;
	}
	return archive;
}

describe("Artemis MJA archive", () => {
	it("walks size-prefixed records and infers known extensions", async () => {
		await expectArchive({
			format: mjaFormat,
			archive: buildMja([
				Buffer.concat([Buffer.from("OggS"), Buffer.from("payload")]),
				Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]),
			]),
			sourcePath: "scene.mja",
			entries: [
				{ path: "scene#0000.ogg", size: 11 },
				{ path: "scene#0001.png", size: 6 },
			],
		});
	});

	it("rejects a zero-sized record instead of looping forever", async () => {
		const archive = Buffer.alloc(12);
		archive.write("MJA0", 0, "ascii");
		archive.writeInt32LE(1, 4);
		await expect(
			mjaFormat.open(new BufferByteSource(archive), "bad.mja"),
		).rejects.toThrow(/zero size/);
	});
});
