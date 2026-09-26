import { BufferByteSource } from "@garbro-mcp/core";
import { hiddenJpegImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { GREY_JPEG, GREY_PIXELS } from "../helpers/jpeg.js";

const MARKER = Buffer.from([0xff, 0xfd, 0x00]);
const PREFIX_SIZE = 100;
const WIDTH = 5;
const HEIGHT = 3;

/** A minimal JPEG: SOI, an APP0 segment, a baseline frame header and EOI. */
function buildJpeg(width = WIDTH, height = HEIGHT): Buffer {
	const app0: Buffer = Buffer.alloc(18);
	app0.writeUInt16BE(0xffe0, 0);
	app0.writeUInt16BE(16, 2);
	app0.write("JFIF\0", 4, "latin1");
	app0[9] = 1;
	app0[10] = 1;
	const sof: Buffer = Buffer.alloc(19);
	sof.writeUInt16BE(0xffc0, 0);
	sof.writeUInt16BE(17, 2);
	sof[4] = 8;
	sof.writeUInt16BE(height, 5);
	sof.writeUInt16BE(width, 7);
	sof[9] = 3;
	return Buffer.concat([
		Buffer.from([0xff, 0xd8]),
		app0,
		sof,
		Buffer.from([0xff, 0xd9]),
	]);
}

/** The 100 byte prefix: the marker followed by bytes the reference never inspects. */
function buildPrefix(marker = MARKER): Buffer {
	const prefix: Buffer = Buffer.alloc(PREFIX_SIZE, 0x41);
	marker.copy(prefix, 0);
	return prefix;
}

function buildHidden(jpeg = buildJpeg(), prefix = buildPrefix()): Buffer {
	return Buffer.concat([prefix, jpeg]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("gaia hidden jpeg image", () => {
	it("declares no signature, since the reference has none", () => {
		expect(hiddenJpegImageFormat.detection?.signatures).toEqual([]);
	});

	it("decodes the jpeg behind the prefix into a bitmap", async () => {
		const stored = buildHidden(GREY_JPEG);
		const source = sourceOf(stored);
		expect(await hiddenJpegImageFormat.detect(source, "CG01.DAT")).toBe(true);
		const archive = await hiddenJpegImageFormat.open(source, "CG01.DAT");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["image.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 8,
				height: 8,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 8,
				height: 8,
				prefixSize: PREFIX_SIZE,
			});
			expect(archive.entries[0]?.size).toBe(BigInt(GREY_JPEG.length));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// The reference reads the picture through `Jpeg.Read`, the platform decoder of the Windows imaging
			// stack; this port reads it with its own reader of the format, so the output is a bitmap of the
			// places the Python imaging library also decodes from the same stream.
			const image = readBmpImage(output);
			if (!image) throw new Error("no bitmap");
			expect(image).toMatchObject({ width: 8, height: 8, bitsPerPixel: 32 });
			expect([...image.pixels]).toEqual([...GREY_PIXELS]);
		} finally {
			await archive.close();
		}
	});

	it("does not inspect the rest of the prefix", async () => {
		const jpeg = buildJpeg();
		const prefix = buildPrefix();
		prefix.fill(0x00, MARKER.length);
		// Byte 3 onwards is never read, so a different filler changes nothing.
		prefix[3] = 0xff;
		prefix[50] = 0xd8;
		expect(
			await hiddenJpegImageFormat.detect(
				sourceOf(buildHidden(jpeg, prefix)),
				"CG02.DAT",
			),
		).toBe(true);
	});

	it("reads the dimensions from a frame header that follows other segments", async () => {
		const jpeg = buildJpeg(0x120, 0x90);
		const archive = await hiddenJpegImageFormat.open(
			sourceOf(buildHidden(jpeg)),
			"CG03.DAT",
		);
		try {
			expect(archive.metadata).toMatchObject({ width: 0x120, height: 0x90 });
		} finally {
			await archive.close();
		}
	});

	it("declines a prefix with a different marker", async () => {
		const marker = Buffer.from([0xff, 0xfd, 0x01]);
		expect(
			await hiddenJpegImageFormat.detect(
				sourceOf(buildHidden(buildJpeg(), buildPrefix(marker))),
				"CG01.DAT",
			),
		).toBe(false);
	});

	it("declines a file whose payload is not a jpeg", async () => {
		const stored = Buffer.concat([buildPrefix(), Buffer.alloc(0x40, 0x42)]);
		expect(
			await hiddenJpegImageFormat.detect(sourceOf(stored), "CG01.DAT"),
		).toBe(false);
	});

	it("declines a jpeg without a frame header", async () => {
		const jpeg = Buffer.concat([
			Buffer.from([0xff, 0xd8]),
			Buffer.alloc(0x10, 0x11),
			Buffer.from([0xff, 0xd9]),
		]);
		expect(
			await hiddenJpegImageFormat.detect(
				sourceOf(buildHidden(jpeg)),
				"CG01.DAT",
			),
		).toBe(false);
	});

	it("declines a file shorter than the prefix", async () => {
		expect(
			await hiddenJpegImageFormat.detect(sourceOf(buildPrefix()), "CG01.DAT"),
		).toBe(false);
	});
});
