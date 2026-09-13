import { airyuChrFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const IMAGE_SIZE = 0x19000;

function buildChr(count: number, imageSize = IMAGE_SIZE): Buffer {
	const archive = Buffer.alloc(count * imageSize);
	for (let id = 0; id < count; id += 1)
		archive.fill(id + 1, id * imageSize, (id + 1) * imageSize);
	return archive;
}

describe("Airyu CHR resource archive", () => {
	it("splits the file into fixed-size images", async () => {
		const archive = buildChr(2);
		await expectArchive({
			format: airyuChrFormat,
			archive,
			sourcePath: "graphic.chr",
			entries: [
				{
					path: "00000",
					size: IMAGE_SIZE,
					content: archive.subarray(0, IMAGE_SIZE),
				},
				{
					path: "00001",
					size: IMAGE_SIZE,
					content: archive.subarray(IMAGE_SIZE),
				},
			],
			metadata: { entryCount: 2, imageSize: String(IMAGE_SIZE) },
		});
	});

	it("accepts the medium image size", async () => {
		const archive = buildChr(1, 0x4b000);
		await expectArchive({
			format: airyuChrFormat,
			archive,
			sourcePath: "graphic.chr",
			entries: [{ path: "00000", size: 0x4b000, content: archive }],
			metadata: { imageSize: String(0x4b000) },
		});
	});

	it("rejects a size that is not a multiple of a known image size", async () => {
		await expectArchive({
			format: airyuChrFormat,
			archive: Buffer.alloc(0x10000),
			sourcePath: "graphic.chr",
			detected: false,
			entries: [],
		});
	});

	it("requires the chr extension", async () => {
		await expectArchive({
			format: airyuChrFormat,
			archive: buildChr(1),
			sourcePath: "graphic.bin",
			detected: false,
			entries: [],
		});
	});
});
