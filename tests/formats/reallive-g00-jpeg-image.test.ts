import { BufferByteSource } from "@garbro-mcp/core";
import { G00_JPEG_KEY, g00JpegImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 5;

/** The key as a repeating pad, written out independently of the port's own loop. */
function keystream(length: number): Buffer {
	const out: Buffer = Buffer.alloc(length, 0x00);
	for (let index = 0; index < length; index += 1) {
		out[index] = G00_JPEG_KEY[index % G00_JPEG_KEY.length] ?? 0;
	}
	return out;
}

function encrypt(payload: Buffer): Buffer {
	const pad = keystream(payload.length);
	const out: Buffer = Buffer.alloc(payload.length);
	for (let index = 0; index < payload.length; index += 1) {
		out[index] = (payload[index] ?? 0) ^ (pad[index] ?? 0);
	}
	return out;
}

interface JpegOptions {
	precision?: number;
	components?: number;
	includeDht?: boolean;
	includeSof?: boolean;
}

/** A JPEG header: start of image, a JFIF segment, optionally a huffman table, then the frame header. */
function buildJpeg(
	width: number,
	height: number,
	options: JpegOptions = {},
): Buffer {
	const components = options.components ?? 3;
	const parts: Buffer[] = [Buffer.from([0xff, 0xd8])];
	// A segment's length field counts its own two bytes, so it is the buffer's length less the marker.
	const app = Buffer.alloc(16, 0x00);
	app.writeUInt16BE(0xffe0, 0);
	app.writeUInt16BE(app.length - 2, 2);
	app.write("JFIF", 4, "latin1");
	parts.push(app);
	if (options.includeDht) {
		const dht = Buffer.alloc(6, 0x00);
		dht.writeUInt16BE(0xffc4, 0);
		dht.writeUInt16BE(dht.length - 2, 2);
		parts.push(dht);
	}
	if (options.includeSof !== false) {
		const length = 8 + 3 * components;
		const sof = Buffer.alloc(length + 2, 0x00);
		sof.writeUInt16BE(0xffc0, 0);
		sof.writeUInt16BE(length, 2);
		sof[4] = options.precision ?? 8;
		sof.writeUInt16BE(height, 5);
		sof.writeUInt16BE(width, 7);
		sof[9] = components;
		parts.push(sof);
	}
	parts.push(Buffer.from([0xff, 0xd9]));
	return Buffer.concat(parts);
}

/** The outer header plus the encrypted payload. */
function buildG00(
	jpeg: Buffer,
	options: { type?: number; width?: number; height?: number } = {},
): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header[0] = options.type ?? 0x03;
	header.writeUInt16LE(options.width ?? 10, 1);
	header.writeUInt16LE(options.height ?? 10, 3);
	return Buffer.concat([header, encrypt(jpeg)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.g00"): Promise<Buffer> {
	const archive = await g00JpegImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("siglus engine encrypted jpeg image", () => {
	it("declares no signature and no extension", () => {
		expect(g00JpegImageFormat.detection?.signatures).toEqual([]);
		expect(g00JpegImageFormat.descriptor.extensions).toEqual([]);
		expect(g00JpegImageFormat.descriptor.capabilities.encryption).toBe(true);
		expect(g00JpegImageFormat.descriptor.id).toBe("reallive-g00-jpeg-image");
	});

	it("accepts only the JPEG version byte", async () => {
		const jpeg = buildJpeg(4, 3);
		expect(
			await g00JpegImageFormat.detect(sourceOf(buildG00(jpeg)), "A.g00"),
		).toBe(true);
		for (const type of [0x00, 0x01, 0x02, 0x04, 0xff]) {
			expect(
				await g00JpegImageFormat.detect(
					sourceOf(buildG00(jpeg, { type })),
					"A.g00",
				),
			).toBe(false);
		}
	});

	it("validates the outer dimensions but reports the inner ones", async () => {
		const jpeg = buildJpeg(4, 3);
		for (const [width, height] of [
			[0, 10],
			[10, 0],
			[0x8001, 10],
			[10, 0x8001],
		] as const) {
			expect(
				await g00JpegImageFormat.detect(
					sourceOf(buildG00(jpeg, { width, height })),
					"A.g00",
				),
			).toBe(false);
		}
		// The header says ten by ten and the frame header says four by three; the metadata follows the JPEG,
		// which is what the reference returns.
		const archive = await g00JpegImageFormat.open(
			sourceOf(buildG00(jpeg, { width: 10, height: 10 })),
			"A.g00",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 4,
				height: 3,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
	});

	it("walks the segments to the frame header", async () => {
		const fields = (width: number, height: number, options: JpegOptions = {}) =>
			g00JpegImageFormat.open(
				sourceOf(buildG00(buildJpeg(width, height, options))),
				"A.g00",
			);
		// A huffman table segment is `FF C4`, the one marker in the C0 row that is not a frame header.
		const withDht = await fields(6, 5, { includeDht: true });
		try {
			expect(withDht.entries[0]?.metadata).toMatchObject({
				width: 6,
				height: 5,
			});
		} finally {
			await withDht.close();
		}
		// A grayscale frame reports eight bits for its single component.
		const gray = await fields(8, 2, { components: 1, precision: 8 });
		try {
			expect(gray.entries[0]?.metadata).toMatchObject({
				width: 8,
				height: 2,
				bitsPerPixel: 8,
			});
		} finally {
			await gray.close();
		}
	});

	it("declines a payload that is not a JPEG", async () => {
		const notJpeg = Buffer.from("this is not a picture at all", "latin1");
		expect(
			await g00JpegImageFormat.detect(sourceOf(buildG00(notJpeg)), "A.g00"),
		).toBe(false);
		// A JPEG with no frame header at all.
		const noSof = buildJpeg(4, 3, { includeSof: false });
		expect(
			await g00JpegImageFormat.detect(sourceOf(buildG00(noSof)), "A.g00"),
		).toBe(false);
		// Only the two start of image bytes.
		const empty = Buffer.from([0xff, 0xd8]);
		expect(
			await g00JpegImageFormat.detect(sourceOf(buildG00(empty)), "A.g00"),
		).toBe(false);
		expect(
			await g00JpegImageFormat.detect(sourceOf(Buffer.alloc(4)), "A.g00"),
		).toBe(false);
		expect(
			await g00JpegImageFormat.detect(
				sourceOf(buildG00(jpegOf(4, 3)).subarray(0, 5)),
				"A.g00",
			),
		).toBe(false);
	});

	it("extracts the decrypted JPEG", async () => {
		const jpeg = buildJpeg(4, 3);
		expect(await extract(buildG00(jpeg))).toEqual(jpeg);
		const archive = await g00JpegImageFormat.open(
			sourceOf(buildG00(jpeg)),
			"CG_01.G00",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_01.jpg");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.metadata).toMatchObject({ image: "jpg" });
		} finally {
			await archive.close();
		}
	});

	it("repeats the key past its own length", async () => {
		// A payload longer than the two hundred and fifty six byte key, so the pad has to wrap. The JPEG's own
		// header stays intact — it has to be readable — and the arbitrary bytes follow it.
		const filler: Buffer = Buffer.alloc(300, 0x00);
		for (let index = 0; index < filler.length; index += 1) {
			filler[index] = (index * 7 + 3) & 0xff;
		}
		const long = Buffer.concat([buildJpeg(4, 3), filler]);
		expect(long.length).toBeGreaterThan(256);
		const output = await extract(buildG00(long));
		expect(output).toEqual(long);
		// The byte at twice the key's length uses the key's first byte again, and it is not a zero here.
		expect(output[256]).toBe(long[256]);
		expect(long[256]).not.toBe(0x00);
	});

	it("declines a stream that ends before a frame header", async () => {
		// A segment whose declared length is impossible must not be walked backwards.
		const truncated = Buffer.concat([
			Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x00]),
		]);
		expect(
			await g00JpegImageFormat.detect(sourceOf(buildG00(truncated)), "A.g00"),
		).toBe(false);
	});
});

/** A JPEG whose frame header is fine but whose bytes are arbitrary, for the length cases. */
function jpegOf(width: number, height: number): Buffer {
	return buildJpeg(width, height);
}
