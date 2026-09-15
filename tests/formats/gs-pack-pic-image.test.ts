import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { gsPackPicImageFormat } from "../../packages/formats/src/gs-pack/pic-image.js";

interface PicParts {
	width: number;
	height: number;
	bitsPerPixel: number;
	body: Buffer;
	packedSize?: number;
	unpackedSize?: number;
	headerSize?: number;
	extra?: number;
	offsetX?: number;
	offsetY?: number;
}

/** Unfolds to whatever it is given, one literal at a time, with the settings the reference leaves alone. */
function lzssLiterals(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const chunk = data.subarray(start, start + 8);
		chunks.push(Buffer.from([(1 << chunk.length) - 1]), chunk);
	}
	if (0 === chunks.length) chunks.push(Buffer.from([0]));
	return Buffer.concat(chunks);
}

function picFile(parts: PicParts): Buffer {
	const headerSize = parts.headerSize ?? 0x20;
	const stream = lzssLiterals(parts.body);
	const head: Buffer = Buffer.alloc(Math.max(headerSize, 0x20));
	Buffer.from([0x00, 0x00, 0x04, 0x00]).copy(head, 0);
	head.writeUInt32LE(parts.packedSize ?? stream.length, 4);
	head.writeUInt32LE(parts.unpackedSize ?? parts.body.length, 8);
	head.writeUInt32LE(headerSize, 0xc);
	head.writeUInt32LE(0, 0x10);
	head.writeUInt32LE(parts.width, 0x14);
	head.writeUInt32LE(parts.height, 0x18);
	head.writeInt32LE(parts.bitsPerPixel, 0x1c);
	if (headerSize >= 0x2c) {
		head.writeInt32LE(parts.extra ?? 0, 0x20);
		head.writeInt32LE(parts.offsetX ?? 0, 0x24);
		head.writeInt32LE(parts.offsetY ?? 0, 0x28);
	}
	return Buffer.concat([head, stream]);
}

function palette(counter: boolean): Buffer {
	const entries: Buffer = Buffer.alloc(0x400);
	for (let index = 0; index < 0x100; index += 1) {
		entries[index * 4] = index;
		entries[index * 4 + 1] = counter ? 0x10 + index : 0x20;
		entries[index * 4 + 2] = 0x30;
		entries[index * 4 + 3] = 0;
	}
	return entries;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await gsPackPicImageFormat.open(
		new BufferByteSource(data),
		"gs.pic",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("GsPack image format", () => {
	it("finds a picture by its signature", async () => {
		const data = picFile({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			body: Buffer.alloc(12, 0x11),
		});
		expect(
			await gsPackPicImageFormat.detect(new BufferByteSource(data), "gs.pic"),
		).toBe(true);
		const other = Buffer.from(data);
		other[3] = 0x01;
		expect(
			await gsPackPicImageFormat.detect(new BufferByteSource(other), "gs.pic"),
		).toBe(false);
	});

	it("declines a header whose lengths do not fit the file", async () => {
		const parts = {
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			body: Buffer.alloc(12, 0x11),
		};
		// A header that declares it reaches past the end of the file, and a stream that does.
		const past = picFile(parts);
		past.writeUInt32LE(past.length + 1, 0xc);
		expect(
			await gsPackPicImageFormat.detect(new BufferByteSource(past), "gs.pic"),
		).toBe(false);
		const long = picFile({ ...parts, packedSize: 0x1000 });
		expect(
			await gsPackPicImageFormat.detect(new BufferByteSource(long), "gs.pic"),
		).toBe(false);
	});

	it("reports the measurements and the place of the picture", async () => {
		const data = picFile({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			body: Buffer.alloc(16, 0x00),
			headerSize: 0x2c,
			extra: 1,
			offsetX: 3,
			offsetY: -4,
		});
		const handle = await gsPackPicImageFormat.open(
			new BufferByteSource(data),
			"gs.pic",
		);
		expect(handle.entries[0]?.path).toBe("gs.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			offsetX: 3,
			offsetY: -4,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 2,
			height: 2,
		});
	});

	it("unfolds a picture of three bytes a pixel", async () => {
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
		]);
		const out = await extract(
			picFile({ width: 2, height: 2, bitsPerPixel: 24, body: pixels }),
		);
		expect(out.readInt32LE(0x12)).toBe(2);
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// Two three byte pixels a row, padded to four.
		expect(out.subarray(0x36, 0x46).toString("hex")).toBe(
			"01020304050600000708090a0b0c0000",
		);
	});

	it("carries the colour map of a picture of one byte a pixel", async () => {
		const entries = palette(true);
		const pixels = Buffer.from([0x00, 0x01, 0x02, 0x03]);
		const out = await extract(
			picFile({
				width: 2,
				height: 2,
				bitsPerPixel: 8,
				body: Buffer.concat([entries, pixels]),
			}),
		);
		expect(out.readUInt32LE(0x0a)).toBe(0x36 + 0x400);
		expect(out.readUInt32LE(0x2e)).toBe(0x100);
		expect(out.subarray(0x36, 0x36 + 0x400)).toEqual(entries);
		// Two pixels a row, padded to four.
		expect(out.subarray(0x36 + 0x400).toString("hex")).toBe("0001000002030000");
	});

	it("leaves the pixels a short stream does not reach at nothing", async () => {
		const entries = palette(false);
		const out = await extract(
			picFile({
				width: 2,
				height: 2,
				bitsPerPixel: 8,
				body: Buffer.concat([entries, Buffer.from([0x0f])]),
			}),
		);
		expect(out.subarray(0x36 + 0x400).toString("hex")).toBe("0f00000000000000");
	});

	it("widens a picture of five and six bit channels", async () => {
		const pixels = Buffer.from([0x00, 0xf8, 0xe0, 0x07]);
		const out = await extract(
			picFile({ width: 2, height: 2, bitsPerPixel: 16, body: pixels }),
		);
		expect(out.readUInt32LE(0x36)).toBe(0xf800);
		expect(out.readUInt32LE(0x3a)).toBe(0x07e0);
		expect(out.readUInt32LE(0x3e)).toBe(0x001f);
		expect(out.subarray(0x42, 0x46)).toEqual(pixels);
	});

	it("hands out a picture of four bytes a pixel as it stands", async () => {
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
		]);
		const out = await extract(
			picFile({ width: 2, height: 1, bitsPerPixel: 32, body: pixels }),
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.subarray(0x36)).toEqual(pixels);
	});

	it("refuses a depth the reference garbles", async () => {
		const data = picFile({
			width: 2,
			height: 2,
			bitsPerPixel: 4,
			body: Buffer.alloc(4, 0x11),
		});
		const handle = await gsPackPicImageFormat.open(
			new BufferByteSource(data),
			"gs.pic",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(GarbroError);
		await expect(handle.openEntry(entry.id)).rejects.toThrow(
			"Unsupported GsPack picture depth 4",
		);
	});
});
