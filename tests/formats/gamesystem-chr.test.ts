import { BufferByteSource } from "@garbro-mcp/core";
import { gameSystemChrFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x18;
const OVERLAY_SIZE_SIZE = 4;
const OVERLAY_HEADER_SIZE = 8;

interface ChrOptions {
	width?: number;
	height?: number;
	offsetX?: number;
	offsetY?: number;
	rgbSize?: number;
	overlaySize?: number;
	count?: number;
	declaredSize?: number;
}

/** Builds a character image: header, indexed RGB plane, overlay header and overlay data. */
function buildChr(options?: ChrOptions): Buffer {
	const rgbSize = options?.rgbSize ?? 0x40;
	const overlaySize = options?.overlaySize ?? 0x10;
	const total = rgbSize + OVERLAY_SIZE_SIZE + overlaySize;
	const file = Buffer.alloc(total);
	file.writeUInt32LE(options?.declaredSize ?? total, 0);
	file.writeInt32LE(rgbSize, 4);
	file.writeUInt32LE(options?.width ?? 0x20, 8);
	file.writeUInt32LE(options?.height ?? 0x10, 0xc);
	file.writeInt32LE(options?.offsetX ?? 0, 0x10);
	file.writeInt32LE(options?.offsetY ?? 0, 0x14);
	for (let index = HEADER_SIZE; index < rgbSize; index += 1)
		file[index] = index & 0xff;
	file.writeUInt32LE(overlaySize, rgbSize);
	if (total >= rgbSize + OVERLAY_SIZE_SIZE + OVERLAY_HEADER_SIZE) {
		file.writeInt32LE(0, rgbSize + 4);
		file.writeInt32LE(options?.count ?? 4, rgbSize + 8);
	}
	// The overlay entry covers its own header, so only the bytes behind it get a pattern.
	for (
		let index = rgbSize + OVERLAY_SIZE_SIZE + OVERLAY_HEADER_SIZE;
		index < total;
		index += 1
	)
		file[index] = 0x80 | (index & 0x0f);
	return file;
}

describe("Game System character frames", () => {
	it("splits a character image into an rgb plane and an overlay", async () => {
		const file = buildChr();
		await expectArchive({
			format: gameSystemChrFormat,
			sourcePath: "CHARA.CHR",
			archive: file,
			entries: [
				{ path: "CHARA#00", size: 0x40, content: file.subarray(0, 0x40) },
				{
					path: "CHARA#01",
					size: 0x10,
					content: file.subarray(0x40 + OVERLAY_SIZE_SIZE),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("accepts a lower case extension", async () => {
		expect(
			await gameSystemChrFormat.detect(
				new BufferByteSource(buildChr()),
				"/game/chara.chr",
			),
		).toBe(true);
	});

	it("marks the entries as images", async () => {
		const archive = await gameSystemChrFormat.open(
			new BufferByteSource(buildChr()),
			"chara.chr",
		);
		expect(archive.entries.map((entry) => entry.metadata?.type)).toEqual([
			"image",
			"image",
		]);
	});

	it("rejects a file without the chr extension", async () => {
		expect(
			await gameSystemChrFormat.detect(
				new BufferByteSource(buildChr()),
				"/game/chara.bin",
			),
		).toBe(false);
	});

	it("rejects a size field that disagrees with the file", async () => {
		expect(
			await gameSystemChrFormat.detect(
				new BufferByteSource(buildChr({ declaredSize: 0x100 })),
				"/game/chara.chr",
			),
		).toBe(false);
	});

	it("rejects an rgb size outside the file", async () => {
		const oversized = buildChr();
		oversized.writeInt32LE(0x100000, 4);
		expect(
			await gameSystemChrFormat.detect(
				new BufferByteSource(oversized),
				"/game/chara.chr",
			),
		).toBe(false);
		expect(
			await gameSystemChrFormat.detect(
				new BufferByteSource(buildChr({ rgbSize: 0x10 })),
				"/game/chara.chr",
			),
		).toBe(false);
	});

	it("rejects invalid frame geometry", async () => {
		for (const options of [
			{ width: 0 },
			{ height: 0 },
			{ width: 0x8001 },
			{ height: 0x8001 },
			{ offsetX: -1 },
			{ offsetY: -1 },
			{ offsetX: 0x8000, width: 1 },
			{ offsetY: 0x8000, height: 1 },
		]) {
			expect(
				await gameSystemChrFormat.detect(
					new BufferByteSource(buildChr(options)),
					"/game/chara.chr",
				),
			).toBe(false);
		}
	});

	it("rejects an empty overlay", async () => {
		expect(
			await gameSystemChrFormat.detect(
				new BufferByteSource(buildChr({ overlaySize: 0 })),
				"/game/chara.chr",
			),
		).toBe(false);
	});

	it("rejects an insane frame count", async () => {
		expect(
			await gameSystemChrFormat.detect(
				new BufferByteSource(buildChr({ count: 0 })),
				"/game/chara.chr",
			),
		).toBe(false);
	});

	it("rejects an overlay that leaves the file", async () => {
		const file = buildChr();
		file.writeUInt32LE(0x1000, 0x40);
		expect(
			await gameSystemChrFormat.detect(
				new BufferByteSource(file),
				"/game/chara.chr",
			),
		).toBe(false);
	});

	it("rejects an empty file", async () => {
		expect(
			await gameSystemChrFormat.detect(
				new BufferByteSource(Buffer.alloc(0)),
				"/game/chara.chr",
			),
		).toBe(false);
	});
});
