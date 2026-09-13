import { BufferByteSource } from "@garbro-mcp/core";
import { ebgSystemBinFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const SOURCE_PATH = "/games/0000.bin";
const BITMAP_SIZE = 0x96000;

function buildBin(count: number): Buffer {
	const archive = Buffer.alloc(BITMAP_SIZE * count);
	for (let id = 0; id < count; id += 1)
		archive.fill((id + 1) & 0xff, id * BITMAP_SIZE, (id + 1) * BITMAP_SIZE);
	return archive;
}

describe("EBG_SYSTEM bitmap archive", () => {
	it("splits the file into fixed-size bitmaps", async () => {
		const archive = buildBin(2);
		const first = archive.subarray(0, BITMAP_SIZE);
		const second = archive.subarray(BITMAP_SIZE);
		await expectArchive({
			format: ebgSystemBinFormat,
			archive,
			sourcePath: SOURCE_PATH,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "0000.bmp", size: BITMAP_SIZE, content: first },
				{ path: "0001.bmp", size: BITMAP_SIZE, content: second },
			],
		});
	});

	it("types entries as images", async () => {
		const archive = buildBin(1);
		const listing = await ebgSystemBinFormat.open(
			new BufferByteSource(archive),
			SOURCE_PATH,
		);
		try {
			expect(listing.entries.map((entry) => entry.metadata)).toEqual([
				{ type: "image" },
			]);
		} finally {
			await listing.close();
		}
	});

	it("requires the engine file name", async () => {
		const archive = buildBin(1);
		const source = new BufferByteSource(archive);
		expect(await ebgSystemBinFormat.detect(source, "/games/0001.bin")).toBe(
			false,
		);
		expect(await ebgSystemBinFormat.detect(source, SOURCE_PATH)).toBe(true);
	});

	it("rejects a length that is not a whole number of bitmaps", async () => {
		const archive = buildBin(1);
		const source = new BufferByteSource(archive.subarray(0, BITMAP_SIZE - 4));
		expect(await ebgSystemBinFormat.detect(source, SOURCE_PATH)).toBe(false);
	});

	it("rejects an empty file", async () => {
		const source = new BufferByteSource(Buffer.alloc(0));
		expect(await ebgSystemBinFormat.detect(source, SOURCE_PATH)).toBe(false);
	});
});
