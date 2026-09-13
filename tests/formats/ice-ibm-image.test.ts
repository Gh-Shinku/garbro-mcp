import { BufferByteSource } from "@garbro-mcp/core";
import { ibmImageFormat, isdScriptFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const BMP_HEADER_SIZE = 54;

/**
 * Literal only TPW: the seed word the codec reads at offset eight, then control bytes below 0x40 that copy
 * exactly that many literal bytes. Distances are never used, so the seed only has to be present.
 */
function tpwPlain(data: Buffer, seed = 0x0010): Buffer {
	const out: number[] = [seed & 0xff, (seed >> 8) & 0xff];
	for (let offset = 0; offset < data.length; offset += 0x3f) {
		const count = Math.min(0x3f, data.length - offset);
		out.push(count);
		for (let index = offset; index < offset + count; index += 1) {
			out.push(data[index] ?? 0);
		}
	}
	return Buffer.from(out);
}

interface IbmOptions {
	unpackedSize?: number;
	marker?: string;
	body?: Buffer;
}

/** The marker and the declared size are the eight bytes the codec's own prefix is made of. */
function buildIbm(body: Buffer, options: IbmOptions = {}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "TPW", 0, "latin1");
	if (!options.marker) header[3] = 0x01;
	header.writeInt32LE(options.unpackedSize ?? body.length, 4);
	return Buffer.concat([header, options.body ?? tpwPlain(body)]);
}

/** A twenty four bit bitmap with an index ramp, big enough for the header probe to have pixels after it. */
function buildBmp24(width: number, height: number): Buffer {
	const stride = (width * 3 + 3) & ~3;
	const pixels = Buffer.alloc(stride * height, 0x00);
	for (let index = 0; index < pixels.length; index += 1) {
		pixels[index] = (index * 5 + 1) & 0xff;
	}
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(BMP_HEADER_SIZE + pixels.length, 2);
	header.writeUInt32LE(BMP_HEADER_SIZE, 10);
	header.writeUInt32LE(40, 14);
	header.writeUInt32LE(width, 18);
	header.writeInt32LE(height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(24, 28);
	header.writeUInt32LE(pixels.length, 34);
	return Buffer.concat([header, pixels]);
}

/** An eight bit bitmap, whose palette lies beyond the fifty six bytes the probe decompresses. */
function buildBmp8(width: number, height: number): Buffer {
	const stride = (width + 3) & ~3;
	const palette = Buffer.alloc(1024, 0x20);
	const pixels = Buffer.alloc(stride * height, 0x11);
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(BMP_HEADER_SIZE + palette.length + pixels.length, 2);
	header.writeUInt32LE(BMP_HEADER_SIZE + palette.length, 10);
	header.writeUInt32LE(40, 14);
	header.writeUInt32LE(width, 18);
	header.writeInt32LE(height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(8, 28);
	header.writeUInt32LE(pixels.length, 34);
	const colours = Buffer.alloc(256 * 4, 0x00);
	return Buffer.concat([header, colours, pixels]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.ibm"): Promise<Buffer> {
	const archive = await ibmImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("ice soft compressed bitmap", () => {
	it("declares the four byte marker and no extension", () => {
		expect(ibmImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x54, 0x50, 0x57, 0x01]) },
		]);
		expect(ibmImageFormat.descriptor.extensions).toEqual([]);
		expect(ibmImageFormat.descriptor.id).toBe("ice-ibm-image");
	});

	it("requires the marker, a positive size and a bitmap header", async () => {
		const bmp = buildBmp24(4, 3);
		expect(await ibmImageFormat.detect(sourceOf(buildIbm(bmp)), "A.ibm")).toBe(
			true,
		);
		const wrongMarker = buildIbm(bmp, { marker: "XpW" });
		expect(await ibmImageFormat.detect(sourceOf(wrongMarker), "A.ibm")).toBe(
			false,
		);
		expect(
			await ibmImageFormat.detect(
				sourceOf(buildIbm(bmp, { unpackedSize: 0 })),
				"A.ibm",
			),
		).toBe(false);
		expect(
			await ibmImageFormat.detect(
				sourceOf(buildIbm(bmp, { unpackedSize: -5 })),
				"A.ibm",
			),
		).toBe(false);
		// A payload that is not a bitmap at all has no header to read.
		const notABitmap = Buffer.alloc(64, 0x41);
		expect(
			await ibmImageFormat.detect(sourceOf(buildIbm(notABitmap)), "A.ibm"),
		).toBe(false);
		// A truncated stream cannot fill even the header.
		expect(
			await ibmImageFormat.detect(
				sourceOf(buildIbm(bmp, { body: tpwPlain(bmp).subarray(0, 0x10) })),
				"A.ibm",
			),
		).toBe(false);
	});

	it("reports the fields of the decompressed header", async () => {
		const archive = await ibmImageFormat.open(
			sourceOf(buildIbm(buildBmp24(5, 7))),
			"CG_01.IBM",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_01.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 5,
				height: 7,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({ bitsPerPixel: 24 });
		} finally {
			await archive.close();
		}
	});

	it("extracts the bitmap the stream carries", async () => {
		const bmp = buildBmp24(4, 3);
		expect(await extract(buildIbm(bmp))).toEqual(bmp);
	});

	it("accepts a header whose palette lies past the probe", async () => {
		// The probe decompresses fifty six bytes, so an eight bit bitmap's palette is only partly present; the
		// header itself is complete and that is all the check needs.
		const bmp = buildBmp8(3, 2);
		const archive = await ibmImageFormat.open(sourceOf(buildIbm(bmp)), "A.ibm");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 3,
				height: 2,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
		expect(await extract(buildIbm(bmp))).toEqual(bmp);
	});

	it("leaves an early end as zeroes", async () => {
		// A zero control byte stops the codec, so the extraction's buffer keeps everything past that point as it
		// was allocated. The header survives, so the file still extracts.
		const bmp = buildBmp24(4, 3);
		const body = Buffer.concat([
			tpwPlain(bmp.subarray(0, 60)),
			Buffer.from([0x00]),
		]);
		const output = await extract(
			buildIbm(bmp, { unpackedSize: bmp.length, body }),
		);
		expect(output.subarray(0, 60)).toEqual(bmp.subarray(0, 60));
		expect(output.subarray(60)).toEqual(Buffer.alloc(bmp.length - 60, 0x00));
	});

	it("keeps the two TPW formats apart", async () => {
		// Both start with the same four bytes. The bitmap's probe is the stricter one, so an ISD script and a
		// bitmap each reach their own format.
		const bmp = buildBmp24(4, 3);
		const bitmap = buildIbm(bmp);
		expect(await ibmImageFormat.detect(sourceOf(bitmap), "A.ibm")).toBe(true);
		expect(await isdScriptFormat.detect(sourceOf(bitmap), "A.ibm")).toBe(false);
		const script = Buffer.from("SCRIPT DATA ".repeat(6), "latin1");
		const isd = buildIbm(script);
		expect(await isdScriptFormat.detect(sourceOf(isd), "A.isd")).toBe(true);
		expect(await ibmImageFormat.detect(sourceOf(isd), "A.isd")).toBe(false);
	});

	it("refuses a size beyond its own ceiling", async () => {
		// The probe only checks that the declared size is positive; the ceiling applies when a buffer for it
		// would be allocated.
		const bmp = buildBmp24(2, 2);
		const huge = buildIbm(bmp, { unpackedSize: 0x10000001 });
		expect(await ibmImageFormat.detect(sourceOf(huge), "A.ibm")).toBe(true);
		await expect(extract(huge)).rejects.toThrow();
	});
});
