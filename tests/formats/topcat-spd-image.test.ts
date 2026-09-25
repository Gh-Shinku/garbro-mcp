import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { spdImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readSpdLayout } from "../../packages/formats/src/topcat/spd-image.js";

/**
 * The head of a picture of the engine: the mark of it, then the places of the file of the words of the
 * walk of it, of the places of the file of the count of the places of the picture taken off them.
 */
function spdFile(
	mark: string,
	width: number,
	height: number,
	bitsPerPixel: number,
	method: number,
	unpackedSize: number,
	body: Buffer,
): Buffer {
	const head: Buffer = Buffer.alloc(0x14, 0x00);
	head.write(mark, 0, "latin1");
	const places =
		(method | (bitsPerPixel << 16)) + (((unpackedSize << 4) & 0xffff) >>> 0);
	head.writeUInt32LE(places >>> 0, 4);
	head.writeUInt32LE((width + (((unpackedSize << 2) & 0x137f) >>> 0)) >>> 0, 8);
	head.writeUInt32LE(
		(height + (((unpackedSize >>> 2) & 0xf731) >>> 0)) >>> 0,
		12,
	);
	head.writeUInt32LE(unpackedSize, 16);
	return Buffer.concat([head, body]);
}

async function bmpOf(data: Buffer): Promise<Buffer> {
	const handle = await spdImageFormat.open(
		new BufferByteSource(data),
		"cg.spd",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/** The places of the colours of a bitmap, of the rows of it from the top of the picture down. */
function pixelsOf(
	bytes: Buffer,
	width: number,
	height: number,
	places = 3,
): number[] {
	const stride = (width * places + 3) & ~3;
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		for (let at = 0; at < width * places; at += 1) {
			out.push(bytes[0x36 + row * stride + at] ?? 0);
		}
	}
	return out;
}

describe("TopCat compressed image", () => {
	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const layout = readSpdLayout(
			spdFile("SPDC", 3, 4, 24, 1, 36, Buffer.alloc(0)),
		);
		expect(layout?.width).toBe(3);
		expect(layout?.height).toBe(4);
		expect(layout?.bitsPerPixel).toBe(24);
		expect(layout?.method).toBe(1);
		expect(layout?.unpackedSize).toBe(36);
		expect(layout?.spdType).toBe("C");
		expect(
			readSpdLayout(spdFile("SPD8", 3, 4, 32, 0x102, 48, Buffer.alloc(0)))
				?.spdType,
		).toBe("8");
		expect(readSpdLayout(Buffer.alloc(0x20, 0x00))).toBeUndefined();
		const flat = spdFile("SPDC", 0, 4, 24, 1, 36, Buffer.alloc(0));
		expect(readSpdLayout(flat)).toBeUndefined();
	});

	it("reads the places of a picture of the walk of the places of the file itself", async () => {
		// The walk of the places of the file of the engine stands of a place of a control byte each: a place
		// standing of one stands of one place of the file, and a place standing of nought of a run of the
		// places of the picture before the place of the walk (of the places of the file behind it).
		const data = spdFile(
			"SPDC",
			1,
			2,
			24,
			1,
			6,
			Buffer.from([0x07, 0x11, 0x22, 0x33, 0x30, 0x00]),
		);
		expect(pixelsOf(await bmpOf(data), 1, 2)).toEqual([
			0x11, 0x22, 0x33, 0x11, 0x22, 0x33,
		]);
	});

	it("reads the places of a picture of the walk of the places of the picture itself", async () => {
		// The places of a picture of the walk of the places of the picture itself stand of the places of the
		// picture before the place of the walk (of the places of the file of the places of the row of it),
		// or of the places of the file of the walk themselves where the place of the file standing of nought
		// of them stands of the places of the file of the picture behind it.
		const data = spdFile(
			"SPDC",
			1,
			2,
			24,
			0x101,
			6,
			Buffer.from([0x11, 0x22, 0x33, 0xf8, 0x66, 0x55, 0x44]),
		);
		// The places of the walk of this picture stand of the places of the file of the picture behind the
		// place of the walk: the bits of the walk stand of the places of the file of the engine itself, of
		// the places of the file the walk of the reference stands of, of the places of the file of a place
		// of the picture standing of five places of the file of the kind of the walk of it. The places of
		// the picture of the walk of this port and of a walk of the same reference written apart from it
		// stand of the same places of the file: `11 22 33 aa 32 c3`.
		expect(pixelsOf(await bmpOf(data), 1, 2)).toEqual([
			0x11, 0x22, 0x33, 0xaa, 0x32, 0xc3,
		]);
	});

	it("turns away a picture of the walks of the engine standing of no port of them", async () => {
		const jpeg = spdFile("SPDC", 2, 2, 24, 0x103, 12, Buffer.alloc(8, 0x00));
		await expect(bmpOf(jpeg)).rejects.toThrow(GarbroError);
		const wrongBits = spdFile(
			"SPDC",
			2,
			2,
			16,
			0x101,
			8,
			Buffer.alloc(8, 0x00),
		);
		await expect(bmpOf(wrongBits)).rejects.toThrow(GarbroError);
		const method = spdFile("SPDC", 2, 2, 24, 0x50, 12, Buffer.alloc(8, 0x00));
		await expect(bmpOf(method)).rejects.toThrow(GarbroError);
	});

	it("tells a picture of the engine by the head of it", async () => {
		expect(
			await spdImageFormat.detect?.(
				new BufferByteSource(spdFile("SPDC", 2, 2, 24, 1, 12, Buffer.alloc(0))),
			),
		).toBe(true);
		expect(
			await spdImageFormat.detect?.(
				new BufferByteSource(spdFile("SPDX", 2, 2, 24, 1, 12, Buffer.alloc(0))),
			),
		).toBe(false);
	});
});
