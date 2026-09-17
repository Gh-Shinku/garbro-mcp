import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readGemLayout,
	unpackGem,
	wingGemImageFormat,
} from "../../packages/formats/src/wing/gem-image.js";

/** Packs a stream of literals, which is all the reference's own LZSS reader has to unfold. */
function lzssLiterals(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const group = data.subarray(start, start + 8);
		chunks.push(Buffer.from([0xff]), group);
	}
	return Buffer.concat(chunks);
}

interface GemOptions {
	method?: number;
	alpha?: number;
	width?: number;
	height?: number;
}

function gemFile(pixels: Buffer, options: GemOptions = {}): Buffer {
	const head = Buffer.alloc(0x10);
	head[0] = 0x0a;
	head[1] = 0x00;
	head.writeInt16LE(options.alpha ?? 50, 2);
	head.writeInt16LE(options.method ?? 0xe6, 4);
	head.writeInt16LE(32, 6);
	head.writeUInt16LE(options.height ?? 2, 8);
	head.writeUInt16LE(options.width ?? 2, 10);
	return Buffer.concat([head, lzssLiterals(pixels)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await wingGemImageFormat.open(
		new BufferByteSource(data),
		"pic.gem",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

const PLAIN_PIXELS = Buffer.from([
	1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
]);

describe("Wing image", () => {
	it("reads the head as the reference does", () => {
		const layout = readGemLayout(gemFile(PLAIN_PIXELS));
		expect(layout).toEqual({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			method: 0xe6,
			alpha: 50,
		});
	});

	it("gates on the signature, the method and the depth", async () => {
		const data = gemFile(PLAIN_PIXELS);
		expect(
			await wingGemImageFormat.detect(new BufferByteSource(data), "pic.gem"),
		).toBe(true);
		// The third byte of the signature carries the alpha value, so only twenty or fifty is a signature.
		const odd = gemFile(PLAIN_PIXELS, { alpha: 30 });
		expect(readGemLayout(odd)).toBeUndefined();
		// Only the two methods of the walk are read.
		const wrongMethod = gemFile(PLAIN_PIXELS, { method: 0x65 });
		expect(readGemLayout(wrongMethod)).toBeUndefined();
		// And only thirty two bits a pixel.
		const shallow = Buffer.from(data);
		shallow.writeInt16LE(24, 6);
		expect(readGemLayout(shallow)).toBeUndefined();
	});

	it("reports the measurements and whether the alpha channel is there", async () => {
		const handle = await wingGemImageFormat.open(
			new BufferByteSource(gemFile(PLAIN_PIXELS, { alpha: 20 })),
			"dir/pic.gem",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "lzss",
			hasAlpha: false,
		});
	});

	it("leaves the pixels of the plain method as they stand", async () => {
		const data = gemFile(PLAIN_PIXELS, { alpha: 20 });
		const layout = readGemLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackGem(data, layout).equals(PLAIN_PIXELS)).toBe(true);
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.subarray(54, 70).equals(PLAIN_PIXELS)).toBe(true);
	});

	it("walks the pixels of the differential method", async () => {
		const stored = Buffer.from([
			10, 20, 30, 0, 40, 50, 60, 0, 70, 80, 90, 0, 0, 0, 0, 0,
		]);
		const data = gemFile(stored, { method: 0x64 });
		const out = await extract(data);
		// Every pixel behind the first of a row and the first row is the sum of itself, the pixel to its left,
		// the pixel above it and the pixel above left taken away; the alpha channel is turned over as well.
		expect(out.subarray(54, 70).toString("hex")).toBe(
			"0a141eff28323cff46505aff646e78ff",
		);
	});

	it("leaves the alpha channel of the plain signature as it stands", async () => {
		const data = gemFile(PLAIN_PIXELS, { alpha: 20 });
		const layout = readGemLayout(data);
		if (!layout) throw new Error("no layout");
		// The fourth byte of every pixel is not turned over when the signature does not carry the alpha value.
		expect(unpackGem(data, layout)[3]).toBe(4);
	});

	it("leaves the rest of the picture at nothing where the stream stops", () => {
		const data = gemFile(PLAIN_PIXELS.subarray(0, 4), { alpha: 20 });
		const layout = readGemLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackGem(data, layout).toString("hex")).toBe(
			"01020304000000000000000000000000",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = gemFile(PLAIN_PIXELS, { method: 0x65 });
		await expect(
			wingGemImageFormat.open(new BufferByteSource(data), "pic.gem"),
		).rejects.toThrow(GarbroError);
		await expect(
			wingGemImageFormat.open(new BufferByteSource(data), "pic.gem"),
		).rejects.toThrow("Not a Wing picture");
	});
});
