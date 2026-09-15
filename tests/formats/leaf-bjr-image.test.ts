import { Buffer } from "node:buffer";
import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { leafBjrImageFormat } from "../../packages/formats/src/leaf/bjr-image.js";
import {
	writeBmp8,
	writeBmp24,
	writeBmp32,
} from "../../packages/formats/src/shared/bmp.js";

const DATA_OFFSET_FIELD = 0x0a;
const DEPTH_FIELD = 0x1c;
const WIDTH_FIELD = 0x12;

/**
 * Turns a bitmap into the stream the format holds: every byte of the picture turned by the key of the name,
 * and every row written where the reader counts it from rather than where it belongs.
 */
function obfuscate(picture: Buffer, name: string): Buffer {
	const out: Buffer = Buffer.from(picture);
	const width = out.readUInt32LE(WIDTH_FIELD);
	const rows = out.readInt32LE(0x16);
	const bitsPerPixel = out.readUInt16LE(DEPTH_FIELD);
	const height = Math.abs(rows);
	const stride = (width * (bitsPerPixel >> 3) + 3) & ~3;
	const imageOffset = out.readUInt32LE(DATA_OFFSET_FIELD);
	const plain = Buffer.from(
		out.subarray(imageOffset, imageOffset + stride * height),
	);
	const stored = out.subarray(imageOffset, imageOffset + stride * height);
	let lineKey = 0;
	let evenKey = 0xff;
	let oddKey = 0;
	for (const byte of encodeCp932(name)) {
		lineKey ^= byte;
		evenKey = (evenKey + byte) & 0xff;
		oddKey = (oddKey - byte) & 0xff;
	}
	for (let y = 0; y < height; y += 1) {
		lineKey += 7;
		const row = (lineKey % height) * stride;
		for (let x = 0; x < stride; x += 1) {
			const value = plain[y * stride + x] ?? 0;
			stored[row + x] =
				(x & 1) === 0 ? (evenKey - value) & 0xff : (value - oddKey) & 0xff;
		}
	}
	return out;
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.bjr"): Promise<Buffer> {
	const handle = await leafBjrImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Leaf obfuscated bitmap", () => {
	const pixels: Buffer = Buffer.alloc(4 * 4 * 3, 0);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 7) & 0xff;
	const picture = writeBmp24(4, 4, pixels, false);

	it("finds a bitmap of its own name", async () => {
		expect(
			await leafBjrImageFormat.detect(
				sourceOf(obfuscate(picture, "cg.bjr")),
				"cg.bjr",
			),
		).toBe(true);
		// The reference reads this format from the name alone.
		expect(await leafBjrImageFormat.detect(sourceOf(picture), "cg.bmp")).toBe(
			false,
		);
	});

	it("declines a file that does not open with the word of a bitmap", async () => {
		const data = obfuscate(picture, "cg.bjr");
		data.write("XX", 0, "latin1");
		expect(await leafBjrImageFormat.detect(sourceOf(data), "cg.bjr")).toBe(
			false,
		);
	});

	it("reports the header of the bitmap behind it", async () => {
		const handle = await leafBjrImageFormat.open(
			sourceOf(obfuscate(picture, "cg.bjr")),
			"dir/cg.bjr",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 4,
			height: 4,
			bitsPerPixel: 24,
			flipped: false,
			imageOffset: 54,
			imageLength: picture.length,
		});
	});

	it("turns a picture of twenty four bits back the way it was", async () => {
		const out = await extract(obfuscate(picture, "cg.bjr"));
		expect(out).toEqual(picture);
	});

	it("turns a picture back with a name outside ascii", async () => {
		const name = "\u3042.bjr";
		const data = obfuscate(picture, name);
		expect(await extract(data, name)).toEqual(picture);
	});

	it("keeps the way up the header gives the rows", async () => {
		const bottomUp = writeBmp24(4, 4, pixels, true);
		const out = await extract(obfuscate(bottomUp, "cg.bjr"));
		expect(out).toEqual(bottomUp);
		expect(out.readInt32LE(22)).toBe(4);
	});

	it("turns a picture of thirty two bits back the way it was", async () => {
		const wide = writeBmp32(2, 3, Buffer.alloc(24, 0x5a), false);
		const out = await extract(obfuscate(wide, "cg.bjr"));
		expect(out).toEqual(wide);
	});

	it("hands any other depth the ramp of greys", async () => {
		const grey = writeBmp8(4, 2, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), false);
		const out = await extract(obfuscate(grey, "cg.bjr"));
		expect(out).toEqual(grey);
	});

	it("refuses a bitmap cut short of its pixels", async () => {
		const data = obfuscate(picture, "cg.bjr").subarray(0, 54 + 24);
		await expect(extract(data)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});
});
