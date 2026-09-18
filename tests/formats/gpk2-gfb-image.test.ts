import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	gpk2GfbImageFormat,
	readGfbLayout,
	readGfbPalette,
	unpackGfb,
} from "../../packages/formats/src/gpk2/gfb-image.js";

interface GfbOptions {
	bpp?: number;
	pixels: Buffer;
	packedSize?: number;
	stride?: number;
	palette?: Buffer;
	dataOffset?: number;
}

/** A file: the head, an optional palette and the pixels. */
function gfbFile(width: number, height: number, options: GfbOptions): Buffer {
	const bpp = options.bpp ?? 24;
	const palette = options.palette ?? Buffer.alloc(0);
	const rowBytes = width * (bpp >> 3);
	const stride = options.stride ?? rowBytes;
	const dataOffset =
		options.dataOffset ?? 0x40 + (palette.length > 0 ? palette.length : 0);
	const head = Buffer.alloc(0x40);
	SIGNATURE.copy(head, 0);
	head.writeInt32LE(options.packedSize ?? 0, 0x0c);
	head.writeInt32LE(stride * height, 0x10);
	head.writeInt32LE(dataOffset, 0x14);
	head.writeUInt32LE(width, 0x1c);
	head.writeUInt32LE(height, 0x20);
	head.writeUInt16LE(bpp, 0x26);
	return Buffer.concat([head, palette, options.pixels]);
}

const SIGNATURE = Buffer.from("GFB ", "latin1");

/** An LZSS stream of literals alone: a control byte of eight set bits before every eight bytes. */
function literalLzss(pixels: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let start = 0; start < pixels.length; start += 8) {
		const group = pixels.subarray(start, start + 8);
		parts.push(Buffer.from([0xff]), group);
	}
	return Buffer.concat(parts);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await gpk2GfbImageFormat.open(
		new BufferByteSource(data),
		"pic.gfb",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("GPK2 image", () => {
	it("reads the head as the reference does", () => {
		const data = gfbFile(2, 1, { pixels: Buffer.alloc(6) });
		expect(readGfbLayout(data)).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			packedSize: 0,
			unpackedSize: 6,
			dataOffset: 0x40,
			stride: 6,
			paletteLength: 0,
		});
	});

	it("gates on the signature and the head", () => {
		const good = gfbFile(2, 1, { pixels: Buffer.alloc(6) });
		expect(readGfbLayout(good)).toBeDefined();
		const other = Buffer.from(good);
		other.write("GFC ", 0, "latin1");
		expect(readGfbLayout(other)).toBeUndefined();
		// Four bits a pixel is not one of the depths the reader has a layout for.
		const odd = Buffer.from(good);
		odd.writeUInt16LE(4, 0x26);
		expect(readGfbLayout(odd)).toBeUndefined();
		// The rows of the reader's buffer have to hold the picture.
		const small = Buffer.from(good);
		small.writeInt32LE(4, 0x10);
		expect(readGfbLayout(small)).toBeUndefined();
		// And the stream has to stand inside the file.
		const far = Buffer.from(good);
		far.writeInt32LE(0x1000, 0x14);
		expect(readGfbLayout(far)).toBeUndefined();
	});

	it("reads the palette of a picture whose stream does not follow the head", () => {
		const palette = Buffer.alloc(0x300);
		for (let i = 0; i < 0x100; i += 1) {
			palette[i * 3] = i & 0xff;
			palette[i * 3 + 1] = (i + 1) & 0xff;
			palette[i * 3 + 2] = (i + 2) & 0xff;
		}
		const data = gfbFile(2, 1, {
			bpp: 8,
			pixels: Buffer.from([0x05, 0x06]),
			palette,
		});
		const layout = readGfbLayout(data);
		if (!layout) throw new Error("no layout");
		expect(layout.paletteLength).toBe(0x300);
		const expanded = readGfbPalette(data, layout.paletteLength);
		expect(expanded.subarray(0, 8).toString("hex")).toBe("0001020001020300");
	});

	it("unfolds a stream of the engine's LZSS", () => {
		const pixels = Buffer.from("0102030405060708090a0b0c0d0e0f10", "hex");
		const packed = literalLzss(pixels);
		const data = gfbFile(2, 2, {
			bpp: 32,
			pixels: packed,
			packedSize: packed.length,
		});
		const layout = readGfbLayout(data);
		if (!layout) throw new Error("no layout");
		expect(layout.stride).toBe(8);
		expect(unpackGfb(data, layout).toString("hex")).toBe(
			pixels.toString("hex"),
		);
	});

	it("writes a twenty four bit picture out again", async () => {
		const data = gfbFile(2, 1, {
			pixels: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(1);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("1122334455660000");
	});

	it("writes a thirty two bit picture out again", async () => {
		const data = gfbFile(2, 1, {
			bpp: 32,
			pixels: Buffer.from([0x11, 0x22, 0x33, 0xff, 0x44, 0x55, 0x66, 0x80]),
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.subarray(0x36).toString("hex")).toBe("112233ff44556680");
	});

	it("writes a sixteen bit picture out again with six green bits", async () => {
		const data = gfbFile(2, 1, {
			bpp: 16,
			pixels: Buffer.from([0x00, 0xf8, 0xe0, 0x07]),
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(16);
		expect(out.readUInt32LE(0x36)).toBe(0xf800);
		expect(out.readUInt32LE(0x3a)).toBe(0x07e0);
		expect(out.readUInt32LE(0x3e)).toBe(0x001f);
		expect(out.subarray(0x42, 0x46).toString("hex")).toBe("00f8e007");
	});

	it("writes an eight bit picture out with its palette or as a grey one", async () => {
		const palette = Buffer.alloc(0x300);
		for (let i = 0; i < 0x100; i += 1) {
			palette[i * 3] = i & 0xff;
			palette[i * 3 + 1] = (i + 1) & 0xff;
			palette[i * 3 + 2] = (i + 2) & 0xff;
		}
		const withPalette = await extract(
			gfbFile(2, 1, { bpp: 8, pixels: Buffer.from([0x05, 0x06]), palette }),
		);
		expect(withPalette.readUInt16LE(0x1c)).toBe(8);
		expect(withPalette.readUInt32LE(0x2e)).toBe(256);
		expect(withPalette.subarray(0x36, 0x3e).toString("hex")).toBe(
			"0001020001020300",
		);
		expect(withPalette.subarray(0x436, 0x43a).toString("hex")).toBe("05060000");
		// Without a palette of its own the picture is handed out as a grey one.
		const grey = await extract(
			gfbFile(2, 1, { bpp: 8, pixels: Buffer.from([0x80, 0x40]) }),
		);
		expect(
			grey.subarray(0x36 + 0x80 * 4, 0x36 + 0x80 * 4 + 4).toString("hex"),
		).toBe("80808000");
		expect(grey.subarray(0x436, 0x43a).toString("hex")).toBe("80400000");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = gfbFile(2, 1, { pixels: Buffer.alloc(6) });
		data.write("GFC ", 0, "latin1");
		await expect(
			gpk2GfbImageFormat.open(new BufferByteSource(data), "pic.gfb"),
		).rejects.toThrow(GarbroError);
		await expect(
			gpk2GfbImageFormat.open(new BufferByteSource(data), "pic.gfb"),
		).rejects.toThrow("Not a GPK2 picture");
	});
});
