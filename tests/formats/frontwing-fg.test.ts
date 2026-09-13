import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { fgFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, expect, it } from "vitest";

const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x1ac;
const DATA_PREFIX = 4;

interface FgLayer {
	name: string;
	content: Buffer;
	offsetX?: number;
	offsetY?: number;
	width?: number;
	height?: number;
}

function buildFg(layers: readonly FgLayer[]): Buffer {
	const dataOffset = INDEX_OFFSET + layers.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset +
			layers.reduce(
				(sum, layer) => sum + DATA_PREFIX + layer.content.length,
				0,
			),
	);
	archive.write("FWGI", 0, "ascii");
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, layer] of layers.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeInt32LE(1, record);
		archive.writeInt32LE(layer.offsetX ?? 0, record + 8);
		archive.writeInt32LE(layer.offsetY ?? 0, record + 0x0c);
		archive.writeUInt32LE(layer.width ?? 640, record + 0x18);
		archive.writeUInt32LE(layer.height ?? 480, record + 0x1c);
		encodeCp932(layer.name).copy(archive, record + 0x20);
		// The stored offset points at the four-byte prefix in front of the bitmap.
		archive.writeUInt32LE(offset, record + 0x124);
		archive.writeUInt32LE(layer.content.length, record + 0x128);
		layer.content.copy(archive, position + DATA_PREFIX);
		offset += DATA_PREFIX + layer.content.length;
		position += DATA_PREFIX + layer.content.length;
	}
	return archive;
}

describe("FrontWing FG multi-layer image", () => {
	it("walks 0x1ac-byte layer records and strips name directories", async () => {
		const first = Buffer.from("BM layer one");
		const second = Buffer.from("BM layer two!");
		await expectArchive({
			format: fgFormat,
			archive: buildFg([
				{
					name: "graphic\\base.bmp",
					content: first,
					offsetX: 12,
					offsetY: -4,
					width: 800,
					height: 600,
				},
				{ name: "face.bmp", content: second },
			]),
			sourcePath: "sample.fg",
			entries: [
				{ path: "base.bmp", size: first.length, content: first },
				{ path: "face.bmp", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("keeps layer metadata", async () => {
		const content = Buffer.from("BM");
		const archive = await fgFormat.open(
			new BufferByteSource(
				buildFg([
					{
						name: "layer.bmp",
						content,
						offsetX: 3,
						offsetY: 7,
						width: 320,
						height: 240,
					},
				]),
			),
			"sample.fg",
		);
		expect(archive.entries[0]?.metadata).toEqual({
			offsetX: 3,
			offsetY: 7,
			width: 320,
			height: 240,
			bpp: 32,
		});
	});

	it("rejects an archive without layer records", async () => {
		await expectArchive({
			format: fgFormat,
			archive: Buffer.from("FWGIpadding", "latin1"),
			sourcePath: "sample.fg",
			detected: false,
			entries: [],
		});
	});

	it("rejects a layer outside the file", async () => {
		const archive = buildFg([{ name: "a.bmp", content: Buffer.from("BM") }]);
		archive.writeUInt32LE(0x100000, INDEX_OFFSET + 0x124);
		await expectArchive({
			format: fgFormat,
			archive,
			sourcePath: "sample.fg",
			detected: false,
			entries: [],
		});
	});
});
