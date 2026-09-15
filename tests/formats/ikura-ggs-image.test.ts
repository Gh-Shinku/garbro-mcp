import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	ikuraGgsImageFormat,
	readGgsLayout,
	unpackGgs,
} from "../../packages/formats/src/ikura/ggs-image.js";

const HEADER_SIZE = 8;
const DATA_OFFSET = 0x36;

/** A step that fills pixels with one byte. */
function fill(count: number, value: number): Buffer {
	return Buffer.from([0x00, count, value]);
}

/** A step that copies pixels from a place behind, no further than a byte away. */
function copy8(count: number, offset: number): Buffer {
	return Buffer.from([0x01, count, offset]);
}

/** A step that copies pixels from a place behind, two bytes long. */
function copy16(count: number, offset: number): Buffer {
	return Buffer.from([0x02, count, offset & 0xff, (offset >> 8) & 0xff]);
}

/** A step over some bytes. */
function step8(count: number): Buffer {
	return Buffer.from([0x03, count]);
}

/** A step over some bytes, the count two bytes long. */
function step16(count: number): Buffer {
	return Buffer.from([0x04, count & 0xff, (count >> 8) & 0xff]);
}

/** A step of bytes that stand in the stream themselves. */
function literal(bytes: number[]): Buffer {
	if (bytes.length < 1 || bytes.length > 250) {
		throw new Error(
			"a literal step holds between one and two hundred and fifty bytes",
		);
	}
	return Buffer.from([0x05 + bytes.length, ...bytes]);
}

/** The eight byte header and the three walks of the colour channels behind it. */
function ggsFile(
	width: number,
	height: number,
	planes: Buffer[],
	offsetX = 0,
	offsetY = 0,
): Buffer {
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	head.writeInt16LE(offsetX, 0);
	head.writeInt16LE(offsetY, 2);
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	return Buffer.concat([head, ...planes]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.ggs"): Promise<Buffer> {
	const handle = await ikuraGgsImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of the bitmap, three bytes to the pixel, in the order the walk wrote them. */
function pixelBytes(bitmap: Buffer, width: number, height: number): string {
	const stride = (width * 3 + 3) & ~3;
	const parts: string[] = [];
	for (let row = 0; row < height; row += 1) {
		parts.push(
			bitmap
				.subarray(
					DATA_OFFSET + row * stride,
					DATA_OFFSET + row * stride + width * 3,
				)
				.toString("hex"),
		);
	}
	return parts.join("");
}

describe("D.O. picture format of the GGS kind", () => {
	it("finds a picture only where it is named for one", async () => {
		const data = ggsFile(1, 1, [literal([1]), fill(1, 0x22), fill(1, 0x33)]);
		expect(await ikuraGgsImageFormat.detect(sourceOf(data), "cg.ggs")).toBe(
			true,
		);
		expect(await ikuraGgsImageFormat.detect(sourceOf(data), "dir/cg.GGS")).toBe(
			true,
		);
		// The reference reads the format only out of files named `.ggs`, since it declares no signature.
		expect(await ikuraGgsImageFormat.detect(sourceOf(data), "cg.ggp")).toBe(
			false,
		);
		expect(await ikuraGgsImageFormat.detect(sourceOf(data), "cg.bin")).toBe(
			false,
		);
		// The measurements have to stand above nothing and no further than `0x4000`, and the place as well.
		expect(
			readGgsLayout(ggsFile(0, 1, [data.subarray(HEADER_SIZE)])),
		).toBeUndefined();
		expect(
			readGgsLayout(ggsFile(1, 0, [data.subarray(HEADER_SIZE)])),
		).toBeUndefined();
		expect(readGgsLayout(ggsFile(0x4001, 1, []))).toBeUndefined();
		expect(readGgsLayout(ggsFile(1, 0x4001, []))).toBeUndefined();
		expect(readGgsLayout(ggsFile(1, 1, [], -1, 0))).toBeUndefined();
		expect(readGgsLayout(ggsFile(1, 1, [], 0, -2))).toBeUndefined();
		expect(readGgsLayout(Buffer.alloc(HEADER_SIZE - 1, 0x00))).toBeUndefined();
	});

	it("reports the measurements and the place the picture stands at as it stands", async () => {
		const handle = await ikuraGgsImageFormat.open(
			sourceOf(ggsFile(2, 2, [fill(4, 1), fill(4, 2), fill(4, 3)], 3, 4)),
			"dir/cg.ggs",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			// Where the sibling format of this engine turns the place about, this one reports it as it stands.
			offsetX: 3,
			offsetY: 4,
		});
	});

	it("walks the three colour channels one at a time", async () => {
		const bitmap = await extract(
			ggsFile(2, 1, [literal([1, 2]), literal([3, 4]), literal([5, 6])]),
		);
		expect(bitmap.readUInt16LE(0x1c)).toBe(24);
		expect(pixelBytes(bitmap, 2, 1)).toBe("010305020406");
	});

	it("fills a run of pixels with the byte behind the count", async () => {
		const bitmap = await extract(
			ggsFile(2, 1, [fill(2, 0x11), fill(2, 0x22), fill(2, 0x33)]),
		);
		expect(pixelBytes(bitmap, 2, 1)).toBe("112233112233");
	});

	it("copies a run of pixels from the byte behind it", async () => {
		// The blue channel of the first pixel, then the same byte copied twice: the place behind is counted in
		// the stream of pixels, so three bytes back is the blue channel of the pixel before.
		const bitmap = await extract(
			ggsFile(3, 1, [
				Buffer.concat([literal([1]), copy8(2, 3)]),
				fill(3, 0),
				fill(3, 0),
			]),
		);
		expect(pixelBytes(bitmap, 3, 1)).toBe("010000010000010000");
	});

	it("copies a run of pixels from a place two bytes long", async () => {
		// A picture ninety pixels wide: the blue channel of eighty eight pixels stands in the stream, and the
		// last two are copied from a place two hundred and fifty eight bytes behind, which reaches the second
		// pixel of the picture, so the two bytes copied are the third and the fourth of the walk.
		const ramp: number[] = [];
		for (let index = 0; index < 88; index += 1) {
			ramp.push(index + 1);
		}
		const bitmap = await extract(
			ggsFile(90, 1, [
				Buffer.concat([literal(ramp), copy16(2, 0x102)]),
				fill(90, 0x77),
				fill(90, 0x00),
			]),
		);
		const pixels = pixelBytes(bitmap, 90, 1);
		// The blue channel of the eighty ninth and ninetieth pixels, which the copy wrote.
		expect(pixels.slice(88 * 6, 88 * 6 + 6)).toBe("037700");
		expect(pixels.slice(89 * 6, 89 * 6 + 6)).toBe("047700");
	});

	it("steps over bytes, the count one byte or two long", async () => {
		// A step stands in bytes rather than in pixels, which is why one byte skips the blue channel of a pixel
		// and lands the next byte written on the green channel of it.
		const stepped = await extract(
			ggsFile(3, 1, [
				Buffer.concat([literal([1]), step8(3), literal([2])]),
				fill(3, 0x00),
				fill(3, 0x00),
			]),
		);
		expect(pixelBytes(stepped, 3, 1)).toBe("010000000000020000");
		// The odd step belongs to the walk of the red channel, which goes last, so the byte it lands on the blue
		// channel of the second pixel stands in the picture rather than being written over by a channel behind it.
		const odd = await extract(
			ggsFile(3, 1, [
				fill(3, 1),
				fill(3, 2),
				Buffer.concat([literal([1]), step8(1), literal([2])]),
			]),
		);
		expect(pixelBytes(odd, 3, 1)).toBe("010201010200020200");
		const wide = await extract(
			ggsFile(2, 1, [
				Buffer.concat([literal([1]), step16(0x200)]),
				fill(2, 0x00),
				fill(2, 0x00),
			]),
		);
		// The walk of the blue channel leaves the picture behind and the channels behind it walk it as they are.
		expect(pixelBytes(wide, 2, 1)).toBe("010000000000");
	});

	it("reads a copy from no place at all as the byte about to be written", async () => {
		const bitmap = await extract(
			ggsFile(2, 1, [
				Buffer.concat([literal([1]), copy8(1, 0)]),
				fill(2, 0x00),
				fill(2, 0x00),
			]),
		);
		// The byte copied stands at nothing, since a place of nothing reads the byte it is about to write.
		expect(pixelBytes(bitmap, 2, 1)).toBe("010000000000");
	});

	it("refuses a copy from before the start of the picture", async () => {
		const data = ggsFile(2, 1, [copy8(1, 5), fill(2, 0), fill(2, 0)]);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"D.O. picture copies from before its start",
		);
		// A place two bytes long reaches just as far past the start of the picture.
		await expect(
			extract(
				ggsFile(2, 1, [copy16(1, 0x100), fill(1, 0), fill(2, 0), fill(2, 0)]),
			),
		).rejects.toThrow("D.O. picture copies from before its start");
	});

	it("refuses a run that writes past the end of the picture", async () => {
		const data = ggsFile(1, 1, [fill(5, 0x11), fill(1, 0), fill(1, 0)]);
		await expect(extract(data)).rejects.toThrow(
			"D.O. picture writes past its own end",
		);
	});

	it("refuses a picture the stream runs out inside", async () => {
		// The red channel asks for a second pixel the stream has nothing behind it for.
		const data = ggsFile(2, 1, [fill(2, 1), fill(2, 2), literal([3])]);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"D.O. picture is cut short of its stream",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const data = ggsFile(16000, 16000, []);
		expect(await ikuraGgsImageFormat.detect(sourceOf(data), "cg.ggs")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("walks the channels of a picture of one pixel itself", () => {
		const data = ggsFile(1, 1, [literal([9]), literal([8]), literal([7])]);
		const layout = readGgsLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackGgs(data, layout).toString("hex")).toBe("090807");
	});
});
