import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { yuRisYcgImageFormat } from "../../packages/formats/src/yu-ris/ycg-image.js";

const HEADER_SIZE = 0x38;

interface YcgParts {
	width: number;
	height: number;
	bitsPerPixel?: number;
	method?: number;
	first: Buffer;
	second: Buffer;
	/** What the header promises each stream unfolds to, and where the second one stands. */
	unpackedSize1?: number;
	compressedSize1?: number;
	unpackedSize2?: number;
	/** Filler between the two streams, which the length of the first has to step over. */
	gap?: Buffer;
	/** A signature other than the one the format registers. */
	signature?: Buffer;
}

function ycgFile(parts: YcgParts): Buffer {
	const first = deflateSync(parts.first);
	const second = deflateSync(parts.second);
	const gap = parts.gap ?? Buffer.alloc(0);
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	(parts.signature ?? Buffer.from("YCG\0", "latin1")).copy(head, 0);
	head.writeUInt32LE(parts.width, 4);
	head.writeUInt32LE(parts.height, 8);
	head.writeInt32LE(parts.bitsPerPixel ?? 32, 12);
	head.writeInt32LE(parts.method ?? 1, 0x10);
	head.writeInt32LE(parts.unpackedSize1 ?? parts.first.length, 0x20);
	head.writeInt32LE(parts.compressedSize1 ?? first.length, 0x24);
	head.writeInt32LE(parts.unpackedSize2 ?? parts.second.length, 0x30);
	head.writeInt32LE(second.length, 0x34);
	return Buffer.concat([head, first, gap, second]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await yuRisYcgImageFormat.open(
		new BufferByteSource(data),
		"cg.ycg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("YU-RIS compressed image format", () => {
	it("finds a picture by its signature", async () => {
		const data = ycgFile({
			width: 1,
			height: 1,
			first: Buffer.alloc(4, 0x11),
			second: Buffer.alloc(0),
		});
		expect(
			await yuRisYcgImageFormat.detect(new BufferByteSource(data), "cg.ycg"),
		).toBe(true);
		const odd = ycgFile({
			width: 1,
			height: 1,
			first: Buffer.alloc(4, 0x11),
			second: Buffer.alloc(0),
			signature: Buffer.from("YCH\0", "latin1"),
		});
		expect(
			await yuRisYcgImageFormat.detect(new BufferByteSource(odd), "cg.ycg"),
		).toBe(false);
		expect(
			await yuRisYcgImageFormat.detect(
				new BufferByteSource(Buffer.alloc(8, 0x00)),
				"cg.ycg",
			),
		).toBe(false);
	});

	it("reports the measurements and the method of the header", async () => {
		const data = ycgFile({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
			first: Buffer.alloc(48, 0x00),
			second: Buffer.alloc(0),
		});
		const handle = await yuRisYcgImageFormat.open(
			new BufferByteSource(data),
			"dir/cg.ycg",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
			compressionMethod: 1,
		});
	});

	it("unfolds the two streams into one picture", async () => {
		const first = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
		const second = Buffer.from([
			0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18,
		]);
		const out = await extract(ycgFile({ width: 2, height: 2, first, second }));
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.readInt32LE(0x12)).toBe(2);
		// The rows of the reference's pictures stand the right way up.
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.subarray(0x36).toString("hex")).toBe(
			"01020304050607081112131415161718",
		);
	});

	it("leaves the picture at nothing behind the two streams", async () => {
		// The two streams together promise twelve of the sixteen bytes of the picture, so the last four stay at
		// nothing.
		const first = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
		const second = Buffer.from([0x11, 0x12, 0x13, 0x14]);
		const out = await extract(ycgFile({ width: 2, height: 2, first, second }));
		expect(out.subarray(0x36).toString("hex")).toBe(
			"01020304050607081112131400000000",
		);
	});

	it("steps over the filler the length of the first stream describes", async () => {
		const first = Buffer.from([0x01, 0x02, 0x03, 0x04]);
		const second = Buffer.from([0x11, 0x12, 0x13, 0x14]);
		const stream = deflateSync(first);
		const data = ycgFile({
			width: 2,
			height: 2,
			first,
			second,
			compressedSize1: stream.length + 5,
			gap: Buffer.alloc(5, 0x7f),
		});
		const out = await extract(data);
		// The picture is what the two streams say it is; the filler between them is never read.
		expect(out.subarray(0x36).toString("hex")).toBe(
			"01020304111213140000000000000000",
		);
	});

	it("takes no more of a stream than the length it promises", async () => {
		// The first stream holds eight bytes but the header promises four, so the rest of it is left unread and
		// the picture behind those four bytes stays at nothing.
		const first = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
		const out = await extract(
			ycgFile({
				width: 2,
				height: 2,
				first,
				second: Buffer.alloc(0),
				unpackedSize1: 4,
			}),
		);
		expect(out.subarray(0x36).toString("hex")).toBe(
			"01020304000000000000000000000000",
		);
	});

	it("refuses a stream the picture has no room for", async () => {
		const data = ycgFile({
			width: 2,
			height: 2,
			first: Buffer.alloc(8, 0x01),
			second: Buffer.alloc(8, 0x02),
			unpackedSize1: 12,
		});
		const handle = await yuRisYcgImageFormat.open(
			new BufferByteSource(data),
			"cg.ycg",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(
			"YuRis picture holds more streams than it has room for",
		);
	});

	it("refuses a stream that is cut short of what it promises", async () => {
		const parts = {
			width: 4,
			height: 4,
			first: Buffer.alloc(8, 0x01),
			second: Buffer.alloc(8, 0x02),
		};
		const short = ycgFile({ ...parts, unpackedSize1: 9 });
		await expect(extract(short)).rejects.toThrow(
			"YuRis picture is cut short of its first stream",
		);
		const shorter = ycgFile({ ...parts, unpackedSize2: 9 });
		await expect(extract(shorter)).rejects.toThrow(
			"YuRis picture is cut short of its second stream",
		);
	});

	it("refuses a stream that is no stream", async () => {
		const data = ycgFile({
			width: 1,
			height: 1,
			first: Buffer.alloc(4, 0x01),
			second: Buffer.alloc(0),
		});
		// Rub out the zlib header of the first stream.
		data[HEADER_SIZE] = 0x00;
		data[HEADER_SIZE + 1] = 0x00;
		await expect(extract(data)).rejects.toThrow(
			"YuRis picture holds no whole stream",
		);
	});

	it("tells a method it does not implement from one it does not know", async () => {
		const parts = {
			width: 1,
			height: 1,
			first: Buffer.alloc(4, 0x01),
			second: Buffer.alloc(0),
		};
		const yssnp = ycgFile({ ...parts, method: 2 });
		await expect(extract(yssnp)).rejects.toThrow(GarbroError);
		await expect(extract(yssnp)).rejects.toThrow(
			"YSSnp compression is not implemented",
		);
		await expect(extract(ycgFile({ ...parts, method: 3 }))).rejects.toThrow(
			"Unknown YuRis picture compression method",
		);
	});
});
