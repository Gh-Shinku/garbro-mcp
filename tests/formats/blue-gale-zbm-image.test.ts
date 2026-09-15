import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	blueGaleZbmImageFormat,
	readZbmImageLayout,
} from "../../packages/formats/src/blue-gale/zbm-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

const STREAM_OFFSET = 0x0e;
const MINIMUM_SIZE = 0x36;
const ENCRYPT_LIMIT = 100;

/** Packs MSB-first bits the way the reference's stream consumes them. */
class MsbBitWriter {
	private readonly bytes: number[] = [];
	private bits = 0;
	private count = 0;

	putBit(bit: number): void {
		this.bits = (this.bits << 1) | (bit & 1);
		this.count += 1;
		if (this.count === 8) {
			this.bytes.push(this.bits & 0xff);
			this.bits = 0;
			this.count = 0;
		}
	}

	put(value: number, length: number): void {
		for (let index = length - 1; index >= 0; index -= 1) {
			this.putBit((value >> index) & 1);
		}
	}

	finish(): Buffer {
		if (this.count > 0) {
			this.bytes.push((this.bits << (8 - this.count)) & 0xff);
		}
		return Buffer.from(this.bytes);
	}
}

/** A payload written out as runs of bytes that stand in the stream. The first bit is discarded. */
function encodeLiterals(content: Buffer): Buffer {
	const writer = new MsbBitWriter();
	writer.putBit(0);
	for (let offset = 0; offset < content.length; offset += 0x7f) {
		const run = content.subarray(offset, offset + 0x7f);
		writer.put(run.length, 8);
		for (const byte of run) writer.put(byte, 8);
	}
	return writer.finish();
}

/** The obfuscation of the format: the first hundred bytes laid over with `0xFF`. */
function obfuscate(bitmap: Buffer): Buffer {
	const out = Buffer.from(bitmap);
	const limit = Math.min(ENCRYPT_LIMIT, out.length);
	for (let index = 0; index < limit; index += 1) {
		out[index] = (out[index] ?? 0) ^ 0xff;
	}
	return out;
}

interface FileParts {
	version?: number;
	dataOffset?: number;
	/** The bitmap the picture unfolds to, before any obfuscation. */
	bitmap?: Buffer;
	/** Whether the picture is obfuscated, which the reference takes off both times it reads it. */
	encrypted?: boolean;
	/** A size other than the one the bitmap really is. */
	unpackedSize?: number;
	signature?: string;
}

/** A whole file: the header and the packed picture behind it. */
function zbmFile(parts: FileParts = {}): Buffer {
	const bitmap =
		parts.bitmap ?? writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]), false);
	const stored = parts.encrypted ? obfuscate(bitmap) : bitmap;
	const head: Buffer = Buffer.alloc(STREAM_OFFSET, 0x00);
	head.write(parts.signature ?? "amp_", 0, "latin1");
	head.writeInt16LE(parts.version ?? 1, 4);
	head.writeInt32LE(parts.unpackedSize ?? bitmap.length, 6);
	head.writeInt32LE(parts.dataOffset ?? STREAM_OFFSET, 0x0a);
	return Buffer.concat([head, encodeLiterals(stored)]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.zbm"): Promise<Buffer> {
	const handle = await blueGaleZbmImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap of three bytes to the pixel. */
function pixelBytes(bitmap: Buffer, width: number, height: number): string {
	const stride = (width * 3 + 3) & ~3;
	const parts: string[] = [];
	for (let row = 0; row < height; row += 1) {
		parts.push(
			bitmap
				.subarray(54 + row * stride, 54 + row * stride + width * 3)
				.toString("hex"),
		);
	}
	return parts.join("");
}

describe("BlueGale compressed picture format", () => {
	it("finds a picture by its four bytes and the version behind them", async () => {
		const data = zbmFile();
		expect(await blueGaleZbmImageFormat.detect(sourceOf(data), "cg.zbm")).toBe(
			true,
		);
		// The reference reads the height of the bitmap as a long word without a sign, so the height a picture
		// whose rows stand the other way up holds — one taken below nothing — comes out as the largest word.
		expect(readZbmImageLayout(data)).toMatchObject({
			width: 2,
			height: 0xffffffff,
			bitsPerPixel: 24,
		});
		// The version has to stand at one, and the four bytes have to be the ones the reference declares.
		expect(readZbmImageLayout(zbmFile({ version: 2 }))).toBeUndefined();
		expect(readZbmImageLayout(zbmFile({ signature: "ampV" }))).toBeUndefined();
		expect(
			readZbmImageLayout(Buffer.alloc(STREAM_OFFSET - 1, 0x00)),
		).toBeUndefined();
	});

	it("turns away a size or a place that does not hold a picture", async () => {
		// The size has to stand above the length of a bitmap and the place may not stand inside the header.
		expect(
			readZbmImageLayout(zbmFile({ unpackedSize: MINIMUM_SIZE - 1 })),
		).toBeUndefined();
		expect(
			readZbmImageLayout(zbmFile({ dataOffset: STREAM_OFFSET - 1 })),
		).toBeUndefined();
		expect(readZbmImageLayout(zbmFile({ dataOffset: 0x100 }))).toBeUndefined();
		// A stream that does not unfold to a bitmap is turned away as well.
		const notBitmap = Buffer.alloc(0x40, 0x41);
		expect(readZbmImageLayout(zbmFile({ bitmap: notBitmap }))).toBeUndefined();
	});

	it("reads the measurements of the bitmap behind the stream", async () => {
		const bitmap = writeBmp24(3, 2, Buffer.alloc(18, 0x22), true);
		const handle = await blueGaleZbmImageFormat.open(
			sourceOf(zbmFile({ bitmap })),
			"dir/cg.zbm",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "zbm",
			width: 3,
			height: 2,
		});
	});

	it("unfolds the bitmap behind the stream and writes it out", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const bitmap = writeBmp24(2, 2, pixels, false);
		const out = await extract(zbmFile({ bitmap }));
		expect(pixelBytes(out, 2, 2)).toBe(pixels.toString("hex"));
	});

	it("takes the obfuscation off the picture", async () => {
		const pixels = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
		const bitmap = writeBmp24(2, 1, pixels, false);
		const plain = await extract(zbmFile({ bitmap }));
		const hidden = await extract(zbmFile({ bitmap, encrypted: true }));
		expect(pixelBytes(hidden, 2, 1)).toBe(pixels.toString("hex"));
		expect(hidden.toString("hex")).toBe(plain.toString("hex"));
	});

	it("leaves the picture standing at nothing where the stream runs out", async () => {
		// The size asks for more than the stream holds, so the rest of the bitmap is written as it stands.
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6]);
		const bitmap = writeBmp24(2, 1, pixels, false);
		const data = zbmFile({ bitmap, unpackedSize: bitmap.length + 0x20 });
		const out = await extract(data);
		expect(pixelBytes(out, 2, 1)).toBe(pixels.toString("hex"));
	});

	it("refuses a picture it cannot hold", async () => {
		const bitmap = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]), false);
		const data = zbmFile({ bitmap, unpackedSize: 0x20000000 });
		expect(await blueGaleZbmImageFormat.detect(sourceOf(data), "cg.zbm")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("refuses a stream that unfolds to something that is not a bitmap where it is extracted", async () => {
		// Detection turns such a file away, and reading it is refused rather than passed on.
		const notBitmap = Buffer.alloc(0x40, 0x41);
		const data = zbmFile({ bitmap: notBitmap, unpackedSize: MINIMUM_SIZE });
		expect(await blueGaleZbmImageFormat.detect(sourceOf(data), "cg.zbm")).toBe(
			false,
		);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow("Not a BlueGale picture");
	});

	it("reads the measurements of a picture of one row itself", () => {
		const bitmap = writeBmp24(1, 1, Buffer.from([9, 8, 7]), true);
		const layout = readZbmImageLayout(zbmFile({ bitmap }));
		expect(layout?.width).toBe(1);
		expect(layout?.height).toBe(1);
		expect(layout?.unpackedSize).toBe(bitmap.length);
	});
});
