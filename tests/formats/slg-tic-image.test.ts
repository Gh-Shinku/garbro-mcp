import { BufferByteSource } from "@garbro-mcp/core";
import { MsvcRandom } from "@garbro-mcp/codecs";
import { slgTicImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	COLOUR_JPEG,
	COLOUR_PIXELS,
	GREY_JPEG,
	GREY_PIXELS,
} from "../helpers/jpeg.js";

const DEFAULT_KEY = 0x7f7f7f7f;

/** A segment: its marker, then a length that counts itself plus the body. */
function segment(marker: number, body: Buffer): Buffer {
	const head: Buffer = Buffer.alloc(4, 0x00);
	head.writeUInt16BE(marker, 0);
	head.writeUInt16BE(body.length + 2, 2);
	return Buffer.concat([head, body]);
}

interface JpegOptions {
	width?: number;
	height?: number;
	bits?: number;
	components?: number;
	/** Segments between the start of image and the frame. */
	before?: Buffer[];
	/** Replaces the whole body, for the cases the reader refuses. */
	body?: Buffer;
}

function buildJpeg(options: JpegOptions = {}): Buffer {
	const components = options.components ?? 3;
	const frame: Buffer = Buffer.alloc(6 + 3 * components, 0x00);
	frame[0] = options.bits ?? 8;
	frame.writeUInt16BE(options.height ?? 20, 1);
	frame.writeUInt16BE(options.width ?? 30, 3);
	frame[5] = components;
	return Buffer.concat([
		Buffer.from([0xff, 0xd8]),
		...(options.before ?? []),
		segment(0xffc0, frame),
		// A start of scan and the entropy coded data behind it, which the walk never needs.
		segment(0xffda, Buffer.alloc(6, 0x00)),
		Buffer.alloc(32, 0x77),
		Buffer.from([0xff, 0xd9]),
	]);
}

function encrypt(jpeg: Buffer, key: number = DEFAULT_KEY): Buffer {
	const random = new MsvcRandom(key);
	const out = Buffer.from(jpeg);
	for (let index = 0; index < out.length; index += 1) {
		out[index] = ((out[index] ?? 0) + (random.next() & 0xff)) & 0xff;
	}
	return out;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.tic"): Promise<Buffer> {
	const archive = await slgTicImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("SLG system encrypted JPEG image", () => {
	it("declares its word and no extension", async () => {
		expect(slgTicImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x01, 0x4a, 0xa4, 0x15]) },
		]);
		expect(slgTicImageFormat.descriptor.extensions).toEqual([]);
	});

	it("needs the cipher, and the seed it starts from", async () => {
		expect(
			await slgTicImageFormat.detect(
				sourceOf(encrypt(buildJpeg())),
				"CG01.tic",
			),
		).toBe(true);
		expect(
			await slgTicImageFormat.detect(sourceOf(buildJpeg()), "CG01.tic"),
		).toBe(false);
		expect(
			await slgTicImageFormat.detect(
				sourceOf(encrypt(buildJpeg(), 0x0badbeef)),
				"CG01.tic",
			),
		).toBe(false);
	});

	it("takes its depth from the frame's bits and components", async () => {
		const colour = await slgTicImageFormat.open(
			sourceOf(encrypt(buildJpeg({ width: 30, height: 20 }))),
			"CG01.tic",
		);
		try {
			expect(colour.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 30,
				height: 20,
				bitsPerPixel: 24,
			});
			expect(colour.metadata).toMatchObject({
				image: "bmp",
				compression: "slg-tig",
			});
		} finally {
			await colour.close();
		}
		const grey = await slgTicImageFormat.open(
			sourceOf(encrypt(buildJpeg({ bits: 8, components: 1 }))),
			"CG01.tic",
		);
		try {
			expect(grey.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 8 });
		} finally {
			await grey.close();
		}
		// The product is taken as it comes, so an unusual sample depth is reported as it stands.
		const deep = await slgTicImageFormat.open(
			sourceOf(encrypt(buildJpeg({ bits: 12, components: 3 }))),
			"CG01.tic",
		);
		try {
			expect(deep.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 36 });
		} finally {
			await deep.close();
		}
	});

	it("walks the segments in front of the frame", async () => {
		// An application segment and a Huffman table marker, which shares the frame marker's range but is not a
		// frame: the reader has to pass both to reach the one behind them.
		const jpeg = buildJpeg({
			width: 64,
			height: 48,
			before: [
				segment(0xffe0, Buffer.alloc(14, 0x11)),
				segment(0xffc4, Buffer.alloc(24, 0x22)),
			],
		});
		const archive = await slgTicImageFormat.open(
			sourceOf(encrypt(jpeg)),
			"CG01.tic",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 64,
				height: 48,
			});
		} finally {
			await archive.close();
		}
	});

	it("decodes the decrypted graphic into a bitmap", async () => {
		// The reference hands the decrypted bytes to `Jpeg.Read`, the platform decoder of the Windows imaging
		// stack; this port reads them with its own reader of the format.
		const grey = readBmpImage(await extract(encrypt(GREY_JPEG)));
		if (!grey) throw new Error("no bitmap");
		expect(grey).toMatchObject({ width: 8, height: 8, bitsPerPixel: 32 });
		expect([...grey.pixels]).toEqual([...GREY_PIXELS]);
		const colour = readBmpImage(await extract(encrypt(COLOUR_JPEG)));
		if (!colour) throw new Error("no bitmap");
		expect(colour).toMatchObject({ width: 16, height: 16, bitsPerPixel: 32 });
		let worst = 0;
		for (let at = 0; at < COLOUR_PIXELS.length; at += 1) {
			worst = Math.max(
				worst,
				Math.abs((COLOUR_PIXELS[at] ?? 0) - (colour.pixels[at] ?? 0)),
			);
		}
		expect(worst).toBeLessThanOrEqual(2);
	});

	it("refuses a head that is not a frame", async () => {
		// Not a start of image marker at all.
		expect(
			await slgTicImageFormat.detect(
				sourceOf(encrypt(Buffer.from([0x00, 0xd8, 0x00, 0x00]))),
				"CG01.tic",
			),
		).toBe(false);
		// A marker whose first byte is not 0xFF ends the walk.
		const broken = buildJpeg({ body: Buffer.alloc(0) });
		broken[2] = 0x00;
		expect(
			await slgTicImageFormat.detect(sourceOf(encrypt(broken)), "CG01.tic"),
		).toBe(false);
		// A frame segment too short to hold a frame.
		const shortFrame = Buffer.concat([
			Buffer.from([0xff, 0xd8]),
			Buffer.from([0xff, 0xc0, 0x00, 0x06, 8, 0, 20, 0, 30]),
		]);
		expect(
			await slgTicImageFormat.detect(sourceOf(encrypt(shortFrame)), "CG01.tic"),
		).toBe(false);
		// A stream that stops inside the frame.
		const cut = buildJpeg();
		expect(
			await slgTicImageFormat.detect(
				sourceOf(encrypt(cut.subarray(0, 8))),
				"CG01.tic",
			),
		).toBe(false);
		expect(
			await slgTicImageFormat.detect(
				sourceOf(encrypt(Buffer.alloc(1, 0x00))),
				"CG01.tic",
			),
		).toBe(false);
	});

	it("refuses to open a file whose decrypted head is not a frame", async () => {
		await expect(
			slgTicImageFormat.open(
				sourceOf(encrypt(Buffer.alloc(64, 0x5a))),
				"CG01.tic",
			),
		).rejects.toThrow(/SLG encrypted image/);
	});

	it("names the entry after the picture it hands over", async () => {
		const archive = await slgTicImageFormat.open(
			sourceOf(encrypt(buildJpeg())),
			"sub/CG07.tic",
		);
		try {
			expect(archive.entries[0]?.path).toBe("image.bmp");
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
