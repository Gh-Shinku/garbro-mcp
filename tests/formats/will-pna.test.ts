import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { pngFile } from "../helpers/png.js";
import { willPnaFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

const INDEX_START = 0x14;
const RECORD_SIZE = 0x28;

interface Frame {
	x?: number;
	y?: number;
	width?: number;
	height?: number;
	content?: Buffer;
}

/** Builds a `PNAP` header, its frame table and the frame payloads. */
function buildPna(frames: readonly Frame[]): Buffer {
	const header = Buffer.alloc(INDEX_START);
	header.write("PNAP", 0, "ascii");
	header.writeInt32LE(frames.length, 0x10);
	const index = Buffer.alloc(frames.length * RECORD_SIZE);
	const payloads: Buffer[] = [];
	for (const [id, frame] of frames.entries()) {
		const record = id * RECORD_SIZE;
		index.writeInt32LE(frame.x ?? 0, record + 0x08);
		index.writeInt32LE(frame.y ?? 0, record + 0x0c);
		index.writeUInt32LE(frame.width ?? 0, record + 0x10);
		index.writeUInt32LE(frame.height ?? 0, record + 0x14);
		const content = frame.content;
		if (content) {
			index.writeUInt32LE(content.length, record + 0x24);
			payloads.push(content);
		}
	}
	return Buffer.concat([header, index, ...payloads]);
}

/** The places of the file of a frame of a picture of its own, of the counts of the picture of it. */
async function placesOfFrame(
	archive: Buffer,
	path: string,
): Promise<{
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: number[];
}> {
	const handle = await willPnaFormat.open(
		new BufferByteSource(archive),
		"PNA.PNA",
	);
	const entry = handle.entries.find((item) => item.path === path);
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("no picture");
	return {
		width: image.width,
		height: image.height,
		bitsPerPixel: image.bitsPerPixel,
		pixels: [...image.pixels],
	};
}

describe("Pulltop PNA multi-frame archives", () => {
	it("lists frames with their image metadata", async () => {
		const content = Buffer.from("frame pixels");
		const archive = buildPna([{ x: 3, y: 7, width: 32, height: 16, content }]);
		const source = new BufferByteSource(archive);
		expect(await willPnaFormat.detect(source, "PNA.PNA")).toBe(true);
		const handle = await willPnaFormat.open(source, "PNA.PNA");
		expect(handle.entries).toEqual([
			{
				id: "0",
				path: "PNA#000",
				size: BigInt(content.length),
				packedSize: BigInt(content.length),
				compressed: false,
				encrypted: false,
				offset: BigInt(INDEX_START + RECORD_SIZE),
				metadata: {
					type: "image",
					x: 3,
					y: 7,
					width: 32,
					height: 16,
					bpp: 32,
				},
			},
		]);
		expect(handle.metadata).toEqual({ entryCount: 1 });
	});

	it("skips empty frames without advancing the payload cursor or renumbering", async () => {
		const first = Buffer.from("first");
		const second = Buffer.from("second payload");
		const archive = buildPna([
			{ width: 1, height: 1 },
			{ width: 2, height: 2, content: first },
			{ width: 3, height: 3, content: second },
		]);
		const handle = await willPnaFormat.open(
			new BufferByteSource(archive),
			"PNA.PNA",
		);
		expect(
			handle.entries.map((entry) => ({ path: entry.path, size: entry.size })),
		).toEqual([
			{ path: "PNA#001", size: BigInt(first.length) },
			{ path: "PNA#002", size: BigInt(second.length) },
		]);
	});

	it("reads the picture of a frame, of the covering place of it taken off", async () => {
		// A picture of four places of a colour, of the places of its colour taken over the covering place of
		// the pixel: the reference stands of them the other way about, of a covering place of the whole or of
		// nought standing of no count of its own.
		const picture = pngFile({
			width: 3,
			height: 1,
			colourType: 6,
			rows: [[64, 128, 0, 128, 10, 20, 30, 255, 40, 50, 60, 0]],
		});
		const archive = buildPna([{ width: 3, height: 1, content: picture }]);
		expect(await placesOfFrame(archive, "PNA#000")).toEqual({
			width: 3,
			height: 1,
			bitsPerPixel: 32,
			pixels: [
				// 64 * 255 / 128 stands of 127, and the whole of them of 255.
				0, 255, 127, 128, 30, 20, 10, 255, 60, 50, 40, 0,
			],
		});
	});

	it("reads the picture of a frame of three places of a colour, of the whole of the places of it", async () => {
		const picture = pngFile({
			width: 2,
			height: 1,
			colourType: 2,
			rows: [[10, 20, 30, 40, 50, 60]],
		});
		const archive = buildPna([{ width: 2, height: 1, content: picture }]);
		expect(await placesOfFrame(archive, "PNA#000")).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
			pixels: [30, 20, 10, 255, 60, 50, 40, 255],
		});
	});

	it("turns away a frame that stands of no picture this project reads", async () => {
		const archive = buildPna([
			{ width: 1, height: 1, content: Buffer.from("no picture at all") },
		]);
		const handle = await willPnaFormat.open(
			new BufferByteSource(archive),
			"PNA.PNA",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(
			/no picture this project reads/,
		);
	});

	it("rejects an unsane frame count", async () => {
		const archive = buildPna([{ x: 1, content: Buffer.from("x") }]);
		archive.writeInt32LE(0x40000, 0x10);
		const source = new BufferByteSource(archive);
		expect(await willPnaFormat.detect(source, "PNA.PNA")).toBe(false);
	});

	it("rejects a frame that falls outside the archive", async () => {
		const archive = buildPna([
			{ width: 1, height: 1, content: Buffer.from("x") },
		]);
		archive.writeUInt32LE(0x1000, INDEX_START + 0x24);
		const source = new BufferByteSource(archive);
		expect(await willPnaFormat.detect(source, "PNA.PNA")).toBe(false);
	});

	it("rejects a truncated frame table", async () => {
		const archive = buildPna([{ content: Buffer.from("x") }]).subarray(
			0,
			INDEX_START + RECORD_SIZE - 1,
		);
		const source = new BufferByteSource(archive);
		expect(await willPnaFormat.detect(source, "PNA.PNA")).toBe(false);
	});
});
