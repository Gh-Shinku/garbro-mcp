import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { BufferByteSource } from "@garbro-mcp/core";
import { crc32 } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";
import { vnEngineZawImageFormat } from "../../packages/formats/src/vn-engine/zaw-image.js";

const HEADER_SIZE = 0x40;

interface ZawOptions {
	width: number;
	height: number;
	/** The byte naming the depth, not the depth itself. */
	depth: number;
	pixels: Buffer;
	offsetX?: number;
	offsetY?: number;
	/** Leaves the checksum the header carries wrong. */
	breakChecksum?: boolean;
}

function zawFile(options: ZawOptions): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0);
	header.write("ZAW", 0, "latin1");
	header[0x0c] = options.depth;
	header.writeUInt32LE(options.width, 0x10);
	header.writeUInt32LE(options.height, 0x14);
	header.writeInt32LE(options.offsetX ?? 0, 0x18);
	header.writeInt32LE(options.offsetY ?? 0, 0x1c);
	const sum = crc32(header) >>> 0;
	header.writeUInt32LE(options.breakChecksum ? (sum + 1) >>> 0 : sum, 4);
	return Buffer.concat([header, deflateSync(options.pixels)]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.zaw"): Promise<Buffer> {
	const handle = await vnEngineZawImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("GEM/vnengine image", () => {
	it("finds a header whose checksum holds up", async () => {
		const data = zawFile({
			width: 2,
			height: 2,
			depth: 1,
			pixels: Buffer.alloc(12, 0x11),
		});
		expect(await vnEngineZawImageFormat.detect(sourceOf(data), "cg.zaw")).toBe(
			true,
		);
		expect(
			await vnEngineZawImageFormat.detect(
				sourceOf(
					zawFile({
						width: 2,
						height: 2,
						depth: 1,
						pixels: Buffer.alloc(12, 0x11),
						breakChecksum: true,
					}),
				),
				"cg.zaw",
			),
		).toBe(false);
	});

	it("reads the depth the byte names, twenty four bits among them", async () => {
		const layoutOf = async (depth: number, length: number) => {
			const handle = await vnEngineZawImageFormat.open(
				sourceOf(
					zawFile({ width: 2, height: 2, depth, pixels: Buffer.alloc(length) }),
				),
				"cg.zaw",
			);
			return handle.entries[0]?.metadata;
		};
		expect(await layoutOf(3, 16)).toMatchObject({ bitsPerPixel: 32 });
		expect(await layoutOf(2, 8)).toMatchObject({ bitsPerPixel: 16 });
		expect(await layoutOf(1, 12)).toMatchObject({ bitsPerPixel: 24 });
		expect(await layoutOf(0, 4)).toMatchObject({ bitsPerPixel: 8 });
	});

	it("reports the corner and the measurements of the picture", async () => {
		const handle = await vnEngineZawImageFormat.open(
			sourceOf(
				zawFile({
					width: 3,
					height: 5,
					depth: 1,
					pixels: Buffer.alloc(45, 0x11),
					offsetX: -2,
					offsetY: 7,
				}),
			),
			"dir/cg.zaw",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 3,
			height: 5,
			offsetX: -2,
			offsetY: 7,
			bitsPerPixel: 24,
		});
	});

	it("writes a picture of twenty four bits with red and blue the right way round", async () => {
		// The format keeps red, green and blue where a bitmap keeps blue, green and red.
		const out = await extract(
			zawFile({
				width: 2,
				height: 1,
				depth: 1,
				pixels: Buffer.from([1, 2, 3, 4, 5, 6]),
			}),
		);
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.subarray(54, 62)).toEqual(Buffer.from([3, 2, 1, 6, 5, 4, 0, 0]));
	});

	it("hands a picture of eight bits the ramp of greys", async () => {
		const out = await extract(
			zawFile({
				width: 2,
				height: 1,
				depth: 0,
				pixels: Buffer.from([0x11, 0x22]),
			}),
		);
		expect(out.readUInt16LE(28)).toBe(8);
		expect(out.subarray(54 + 0x400, 54 + 0x400 + 2)).toEqual(
			Buffer.from([0x11, 0x22]),
		);
	});

	it("makes a picture of sixteen bits grey with what stands behind it", async () => {
		const out = await extract(
			zawFile({
				width: 2,
				height: 1,
				depth: 2,
				pixels: Buffer.from([0x10, 0x40, 0x20, 0x80]),
			}),
		);
		expect(out.readUInt16LE(28)).toBe(32);
		expect(out.subarray(54, 62)).toEqual(
			Buffer.from([0x10, 0x10, 0x10, 0x7f, 0x20, 0x20, 0x20, 0xff]),
		);
	});

	it("writes a picture of thirty two bits with its alpha stretched", async () => {
		const out = await extract(
			zawFile({
				width: 1,
				height: 2,
				depth: 3,
				pixels: Buffer.from([1, 2, 3, 0x40, 4, 5, 6, 0xff]),
			}),
		);
		expect(out.readUInt16LE(28)).toBe(32);
		expect(out.subarray(54, 62)).toEqual(
			Buffer.from([3, 2, 1, 0x7f, 6, 5, 4, 0xff]),
		);
	});

	it("refuses a picture whose stream does not unfold", async () => {
		const data = zawFile({
			width: 2,
			height: 1,
			depth: 1,
			pixels: Buffer.from([1, 2, 3, 4, 5, 6]),
		});
		data.write("XX", 0x40, "latin1");
		await expect(extract(data)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("leaves the rest of the picture as it was when the stream gives less", async () => {
		const out = await extract(
			zawFile({
				width: 2,
				height: 2,
				depth: 1,
				pixels: Buffer.from([1, 2, 3, 4, 5, 6]),
			}),
		);
		expect(out.subarray(54, 66)).toEqual(
			Buffer.from([3, 2, 1, 6, 5, 4, 0, 0, 0, 0, 0, 0]),
		);
	});
});
