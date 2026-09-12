import { ivoryPxFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildIvoryPx(tracks: Buffer[]): Buffer {
	const chunks = tracks.map((track, index) => {
		const header = Buffer.alloc(0x0c);
		header.write("cTRK", 0, "ascii");
		header.writeUInt32LE(0x0c + track.length, 4);
		header.writeInt32LE(index, 8);
		return Buffer.concat([header, track]);
	});
	const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0) + 8;
	const archive = Buffer.alloc(total);
	archive.write("fPX ", 0, "ascii");
	archive.writeUInt32LE(total, 4);
	let offset = 8;
	for (const chunk of chunks) {
		chunk.copy(archive, offset);
		offset += chunk.length;
	}
	return archive;
}

describe("Ivory PX audio archive", () => {
	it("lists cTRK chunks and uses their track numbers", async () => {
		await expectArchive({
			format: ivoryPxFormat,
			archive: buildIvoryPx([Buffer.from("track-a"), Buffer.from("track-bb")]),
			sourcePath: "bgm.px",
			entries: [
				{
					path: "bgm#0000.trk",
					size: 0x13,
					content: Buffer.from("cTRK\x13\0\0\0\0\0\0\0track-a"),
				},
				{
					path: "bgm#0001.trk",
					size: 0x14,
					content: Buffer.from("cTRK\x14\0\0\0\x01\0\0\0track-bb"),
				},
			],
			metadata: { trackCount: 2 },
		});
	});
});
