import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	readWebpLayout,
	webpImageFormat,
} from "../../packages/formats/src/webp/webp-image.js";

function chunk(mark: string, body: Buffer, size = body.length): Buffer {
	const head = Buffer.alloc(8);
	head.write(mark, 0, "latin1");
	head.writeInt32LE(size, 4);
	const pad = Buffer.alloc(body.length % 2);
	return Buffer.concat([head, body, pad]);
}

function riff(chunks: Buffer[]): Buffer {
	const body = Buffer.concat([Buffer.from("WEBP", "latin1"), ...chunks]);
	const head = Buffer.alloc(8);
	head.write("RIFF", 0, "latin1");
	head.writeUInt32LE(body.length, 4);
	return Buffer.concat([head, body]);
}

/** The places of the picture of the words of the head of the picture of the walk of the places of the picture
 * of the kind of the places of the picture of the picture of the engine. */
function features(flags: number, width: number, height: number): Buffer {
	// The words of the head of a picture of the kind of the places of the picture stand of the places of the
	// picture of four places, the places of the picture of the walk of the places of the picture standing
	// behind them of the places of the picture of three places each.
	const out = Buffer.alloc(10);
	out.writeUInt32LE(flags, 0);
	out.writeUIntLE(width - 1, 4, 3);
	out.writeUIntLE(height - 1, 7, 3);
	return out;
}

/** The places of the picture of the words of the head of a picture of the kind of the walk of the places of
 * the picture of their own. */
function losslessHead(
	width: number,
	height: number,
	version = 0,
	alpha = false,
): Buffer {
	// The reference stands the places of the picture of the walk of the places of a picture of their own of a
	// picture of the words of the head of the picture of the walk of the places of the picture of the kind of
	// the walk of them, the places of the picture of the walk of the places of the picture standing of the
	// places of the picture of the picture of their own — so the places of the picture of the words of the
	// head of the picture stand of the places of the picture of a word of the walk of the places of the
	// picture of the places of the picture of the walk of them of a picture of their own.
	const head = Buffer.alloc(10);
	head[0] = 0x2f;
	const places =
		(width - 1) |
		((height - 1) << 14) |
		((version & 7) << 29) |
		(alpha ? 1 << 28 : 0);
	head.writeUInt32LE(places >>> 0, 1);
	return head;
}

function lossyHead(width: number, height: number, keyframe = true): Buffer {
	const head = Buffer.alloc(10);
	head[0] = keyframe ? 0x00 : 0x01;
	head[3] = 0x9d;
	head[4] = 0x01;
	head[5] = 0x2a;
	head.writeUInt16LE(width, 6);
	head.writeUInt16LE(height, 8);
	return head;
}

describe("Google WebP image format", () => {
	it("walks the words of the head of a picture of the places of the picture of their own", () => {
		const file = riff([
			chunk(
				"VP8L",
				Buffer.concat([losslessHead(0x1234, 0x567), Buffer.alloc(4)]),
			),
		]);
		const layout = readWebpLayout(file, file.length);
		expect(layout?.width).toBe(0x1234);
		expect(layout?.height).toBe(0x567);
		expect(layout?.isLossless).toBe(true);
		expect(layout?.hasAlpha).toBe(false);
		expect(layout?.dataOffset).toBe(20);
		expect(layout?.dataSize).toBe(14);
	});

	it("reads the places of the picture of the walk of the places of a picture of their own of the places of the picture of the word of the picture of the places of their own", () => {
		const file = riff([
			chunk(
				"VP8L",
				Buffer.concat([losslessHead(4, 3, 0, true), Buffer.alloc(2)]),
			),
		]);
		const layout = readWebpLayout(file, file.length);
		expect(layout?.width).toBe(4);
		expect(layout?.height).toBe(3);
		expect(layout?.hasAlpha).toBe(true);
	});

	it("stands the places of the picture of the walk of the places of a picture of their own beside the places of the picture of the words of the head of the picture", () => {
		const file = riff([
			chunk("VP8 ", Buffer.concat([lossyHead(0x140, 0x0c8), Buffer.alloc(4)])),
		]);
		const layout = readWebpLayout(file, file.length);
		expect(layout?.width).toBe(0x140);
		expect(layout?.height).toBe(0xc8);
		expect(layout?.isLossless).toBe(false);
		// The places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of their own stand of the places of the picture of the picture of the kind of the walk of
		// them of the places of the picture of the walk of them.
		expect(layout?.dataOffset).toBe(20);
	});

	it("reads the places of the picture of the words of the head of the picture of the walk of the places of the picture of the kind of the places of the picture of the picture of their own", () => {
		const file = riff([
			chunk("VP8X", features(0x10, 0x200, 0x100)),
			chunk("VP8L", Buffer.concat([losslessHead(3, 3), Buffer.alloc(2)])),
		]);
		const layout = readWebpLayout(file, file.length);
		expect(layout?.flags).toBe(0x10);
		expect(layout?.width).toBe(0x200);
		expect(layout?.height).toBe(0x100);
		// The reference stands no places of the picture of the walk of the places of the picture of the
		// picture of the places of the picture of the walk of them of the words of the head of the picture,
		// so a picture of the kind of the places of the picture of the walk of them stands it of the places of
		// the picture of the walk of the places of the picture of the places of its own.
		expect(layout?.hasAlpha).toBe(false);
		expect(layout?.isLossless).toBe(true);
	});

	it("reads the places of the picture of the words of the head of the picture of the walk of the places of the picture of the kind of the places of the picture of the places of the picture of their own", () => {
		const file = riff([
			chunk("VP8X", features(0x00, 8, 4)),
			chunk("ALPH", Buffer.alloc(6, 0x11)),
			chunk("VP8 ", Buffer.concat([lossyHead(8, 4), Buffer.alloc(2)])),
		]);
		const layout = readWebpLayout(file, file.length);
		expect(layout?.width).toBe(8);
		expect(layout?.height).toBe(4);
		expect(layout?.alphaSize).toBe(6);
		expect(layout?.alphaOffset).toBe(38);
		// The places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of them stand of the places of the picture of the walk of the places of the
		// picture of the walk of the places of the picture of the words of the head of the picture.
		expect(layout?.isLossless).toBe(false);
	});

	it("walks the places of the picture of the words of the head of the picture of the walk of the places of the picture of the kind of the walk of them of the places of the picture of the walk of them", () => {
		const odd = riff([
			chunk("VP8X", features(0, 16, 16)),
			chunk("ALPH", Buffer.alloc(5, 0x22)),
			chunk("VP8L", Buffer.concat([losslessHead(16, 16), Buffer.alloc(2)])),
		]);
		const layout = readWebpLayout(odd, odd.length);
		expect(layout?.alphaSize).toBe(5);
		// The places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of them of the picture of the walk of the places of the picture stand of the
		// places of the picture of the walk of the places of the picture of the picture of the word of the
		// picture standing behind it.
		expect(layout?.width).toBe(16);
		expect(layout?.height).toBe(16);
		expect(layout?.isLossless).toBe(true);
	});

	it("turns away a picture that names no picture of the kind of the walk of the places of the pictures of the engine", () => {
		const good = riff([
			chunk("VP8L", Buffer.concat([losslessHead(4, 4), Buffer.alloc(2)])),
		]);
		const wrongRiff = Buffer.from(good);
		wrongRiff.write("RIFf", 0, "latin1");
		expect(readWebpLayout(wrongRiff, wrongRiff.length)).toBeUndefined();
		const wrongWebp = Buffer.from(good);
		wrongWebp.write("WEBp", 8, "latin1");
		expect(readWebpLayout(wrongWebp, wrongWebp.length)).toBeUndefined();
		expect(readWebpLayout(Buffer.alloc(8), 8)).toBeUndefined();
		expect(
			readWebpLayout(Buffer.from("RIFF\0\0\0\0WEBP", "latin1"), 12),
		).toBeUndefined();
	});

	it("turns away the places of the picture of the words of the head of a picture of the kind of the walk of the places of the picture of a picture of their own", () => {
		const shortFeatures = riff([
			chunk("VP8X", features(0, 4, 4).subarray(0, 9)),
		]);
		expect(readWebpLayout(shortFeatures, shortFeatures.length)).toBeUndefined();
		const noHead = riff([chunk("VP8L", Buffer.alloc(4), 4)]);
		expect(readWebpLayout(noHead, noHead.length)).toBeUndefined();
		const wrongLosslessHead = riff([
			chunk(
				"VP8L",
				Buffer.concat([
					Buffer.from([0x2e]),
					losslessHead(4, 4).subarray(1),
					Buffer.alloc(2),
				]),
			),
		]);
		expect(
			readWebpLayout(wrongLosslessHead, wrongLosslessHead.length),
		).toBeUndefined();
		const wrongVersion = riff([
			chunk("VP8L", Buffer.concat([losslessHead(4, 4, 1), Buffer.alloc(2)])),
		]);
		expect(readWebpLayout(wrongVersion, wrongVersion.length)).toBeUndefined();
		const notKeyframe = riff([
			chunk("VP8 ", Buffer.concat([lossyHead(4, 4, false), Buffer.alloc(2)])),
		]);
		expect(readWebpLayout(notKeyframe, notKeyframe.length)).toBeUndefined();
		const wrongLossyHead = riff([
			chunk(
				"VP8 ",
				Buffer.concat([Buffer.from([0, 0, 0, 0x9d, 2, 0x2a]), Buffer.alloc(4)]),
			),
		]);
		expect(
			readWebpLayout(wrongLossyHead, wrongLossyHead.length),
		).toBeUndefined();
		const nothing = riff([chunk("ICCP", Buffer.alloc(4))]);
		expect(readWebpLayout(nothing, nothing.length)).toBeUndefined();
	});

	it("reads the places of the picture of the words of the head of the picture of the places of the picture of the walk of the places of them of the picture of the walk of the places of the picture of their own", () => {
		// The reference stands the places of the picture of the walk of the places of the picture of a picture
		// of the kind of the walk of them where the places of the picture of the words of the head of the
		// picture of the kind of the places of the picture of the walk of them stand, so the places of the
		// picture of the walk of the places of the picture of the kind of the walk of them stand of the places
		// of the picture of the walk of them of the words of the head of the picture of the kind of the places
		// of the picture of the walk of them of the picture of the walk of the places of them.
		const file = riff([
			chunk("VP8X", features(0, 4, 4)),
			chunk("VP8 ", Buffer.alloc(4), 4),
		]);
		const layout = readWebpLayout(file, file.length);
		expect(layout?.width).toBe(4);
		expect(layout?.height).toBe(4);
		expect(layout?.dataOffset).toBe(38);
		expect(layout?.dataSize).toBe(4);
	});

	it("stands the places of the picture out as the places of the picture of their own", async () => {
		const file = riff([
			chunk("VP8L", Buffer.concat([losslessHead(4, 2), Buffer.alloc(2)])),
		]);
		const handle = await webpImageFormat.open(
			new BufferByteSource(file),
			"art/orig.webp",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("orig.webp");
		expect(Number(entry.size)).toBe(file.length);
		const out = await consumeBuffer(await handle.openEntry(entry.id));
		// The places of the picture of the kind of the walk of the places of the pictures of the engine stand
		// as they stand.
		expect(out).toEqual(file);
	});

	it("is told by the words of the picture of the walk of the places of the pictures of the engine", async () => {
		expect(webpImageFormat.descriptor.id).toBe("webp-image");
		const file = riff([
			chunk("VP8L", Buffer.concat([losslessHead(4, 2), Buffer.alloc(2)])),
		]);
		await expect(
			webpImageFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrong = Buffer.from(file);
		wrong.write("WEBp", 8, "latin1");
		await expect(
			webpImageFormat.detect(new BufferByteSource(wrong)),
		).resolves.toBe(false);
		const nothing = riff([chunk("ICCP", Buffer.alloc(4))]);
		await expect(
			webpImageFormat.detect(new BufferByteSource(nothing)),
		).resolves.toBe(false);
	});

	it("turns a picture of the walk of the places of the picture of no picture away", async () => {
		await expect(
			webpImageFormat.open(
				new BufferByteSource(Buffer.from("RIFF\0\0\0\0WEBP", "latin1")),
				"x.webp",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
