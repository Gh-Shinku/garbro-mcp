import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readMgxLayout,
	umesoftMgxImageFormat,
} from "../../packages/formats/src/umesoft/mgx.js";

const GRX_HEADER_SIZE = 0x10;
const INDEX_START = 8;
const GREY_DATA_OFFSET = 0x36 + 0x400;

/** A run of pixels that stand in the stream themselves. */
function raw(pixels: number[], bytesPerPixel = 1): Buffer {
	const count = pixels.length / bytesPerPixel;
	const low = count - 1;
	const head =
		low < 4 ? [0x08 | low] : [0x08 | 0x04 | (low & 3), (low - (low & 3)) >> 2];
	return Buffer.concat([Buffer.from(head), Buffer.from(pixels)]);
}

interface PictureParts {
	width: number;
	height: number;
	bitsPerPixel: number;
	rows: Buffer[];
	packed?: boolean;
}

/** A picture of the U-Me Soft kind, whole and standing on its own. */
function grxFile(parts: PictureParts): Buffer {
	const packed = parts.packed ?? true;
	const head: Buffer = Buffer.alloc(GRX_HEADER_SIZE, 0x00);
	Buffer.from([0x47, 0x52, 0x58, 0x1a]).copy(head, 0);
	head[4] = packed ? 1 : 0;
	head.writeUInt16LE(parts.bitsPerPixel, 6);
	head.writeUInt16LE(parts.width, 8);
	head.writeUInt16LE(parts.height, 10);
	return Buffer.concat([head, Buffer.concat(parts.rows)]);
}

function mgxFile(frames: Buffer[], parts: { count?: number } = {}): Buffer {
	const count = parts.count ?? frames.length;
	const head: Buffer = Buffer.alloc(INDEX_START + count * 4, 0x00);
	Buffer.from([0x4d, 0x47, 0x58, 0x1a]).copy(head, 0);
	head.writeInt32LE(count, 4);
	let offset = head.length;
	for (let index = 0; index < count; index += 1) {
		head.writeUInt32LE(offset, INDEX_START + index * 4);
		offset += frames[index]?.length ?? 0;
	}
	return Buffer.concat([head, ...frames]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

describe("U-Me Soft multi-frame picture", () => {
	const first = grxFile({
		width: 8,
		height: 2,
		bitsPerPixel: 8,
		rows: [raw([1, 2, 3, 4, 5, 6, 7, 8]), raw([9, 10, 11, 12, 13, 14, 15, 16])],
	});
	const second = grxFile({
		width: 4,
		height: 1,
		bitsPerPixel: 8,
		rows: [raw([9, 10, 11, 12])],
	});

	it("finds the picture the file begins with", async () => {
		const data = mgxFile([first, second]);
		expect(await umesoftMgxImageFormat.detect(sourceOf(data), "cg.grx")).toBe(
			true,
		);
		const handle = await umesoftMgxImageFormat.open(
			sourceOf(data),
			"dir/cg.grx",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 8,
			height: 2,
			bitsPerPixel: 8,
		});
	});

	it("reads the pixels of the picture the file begins with", async () => {
		const data = mgxFile([first, second]);
		const handle = await umesoftMgxImageFormat.open(sourceOf(data), "cg.grx");
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const chunks: Buffer[] = [];
		for await (const chunk of await handle.openEntry(entry.id)) {
			chunks.push(Buffer.from(chunk));
		}
		const bitmap = Buffer.concat(chunks);
		expect(
			bitmap.subarray(GREY_DATA_OFFSET, GREY_DATA_OFFSET + 16).toString("hex"),
		).toBe("0102030405060708090a0b0c0d0e0f10");
	});

	it("turns away a file whose first picture does not hold", async () => {
		const data = mgxFile([first, second]);
		const outside = Buffer.from(data);
		outside.writeUInt32LE(0x1000, 8);
		expect(readMgxLayout(outside)).toBeUndefined();
		expect(
			await umesoftMgxImageFormat.detect(sourceOf(outside), "cg.grx"),
		).toBe(false);
		const noPicture = mgxFile([Buffer.alloc(0x20, 0x41)]);
		expect(
			await umesoftMgxImageFormat.detect(sourceOf(noPicture), "cg.grx"),
		).toBe(false);
	});
});
