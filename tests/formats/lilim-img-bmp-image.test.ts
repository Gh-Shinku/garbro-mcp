import { BufferByteSource } from "@garbro-mcp/core";
import {
	brgImageFormat,
	deobfuscateLilim,
	imgBmpImageFormat,
	prgImageFormat,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const PREFIX = 0x20;

/** A bitmap as the shared writer makes it: a complete header and rows padded to four bytes. */
function buildBmp(
	width: number,
	height: number,
	bitsPerPixel: 24 | 32,
): Buffer {
	const header: Buffer = Buffer.alloc(54, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(width, 18);
	header.writeInt32LE(height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(bitsPerPixel, 28);
	const rowSize = Math.floor((width * (bitsPerPixel / 8) + 3) / 4) * 4;
	const body: Buffer = Buffer.alloc(rowSize * height, 0x5a);
	header.writeUInt32LE(header.length + body.length, 2);
	return Buffer.concat([header, body]);
}

/** The stored file is the bitmap with its first thirty two bytes xored; the tail is untouched. */
function buildImg(bmp: Buffer): Buffer {
	return deobfuscateLilim(bmp);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.img"): Promise<Buffer> {
	const archive = await imgBmpImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Lilim obfuscated bitmap", () => {
	it("obfuscates only the first thirty two bytes", async () => {
		const bmp = buildBmp(3, 2, 24);
		const img = buildImg(bmp);
		// The prefix is xored and everything behind it is the bitmap's own bytes, untouched.
		expect(
			img
				.subarray(0, PREFIX)
				.equals(bmp.subarray(0, PREFIX).map((x) => x ^ 0xff)),
		).toBe(true);
		expect(img.subarray(PREFIX).equals(bmp.subarray(PREFIX))).toBe(true);
		// A file whose whole body had been xored would not pass, which is what separates this format from the
		// Regrips one that claims the same stored signature in its graphic flavour.
		expect(await imgBmpImageFormat.detect(sourceOf(img), "A.img")).toBe(true);
	});

	it("probes the deobfuscated header and nothing else", async () => {
		const img = buildImg(buildBmp(2, 2, 32));
		expect(await imgBmpImageFormat.detect(sourceOf(img), "A.img")).toBe(true);
		// The plain bitmap is not this format.
		expect(
			await imgBmpImageFormat.detect(sourceOf(buildBmp(2, 2, 32)), "A.img"),
		).toBe(false);
		// Nor is a file that starts like one but holds no bitmap behind the prefix, nor a short one. These are
		// the stored bytes: behind their deobfuscated `BM` sits a negative width, which no bitmap has.
		expect(
			await imgBmpImageFormat.detect(
				sourceOf(
					Buffer.concat([Buffer.from([0xbd, 0xb2]), Buffer.alloc(60, 0x11)]),
				),
				"A.img",
			),
		).toBe(false);
		expect(
			await imgBmpImageFormat.detect(sourceOf(Buffer.alloc(20, 0xba)), "A.img"),
		).toBe(false);
	});

	it("shares its stored prefix with the Regrips bitmap, as the reference does", async () => {
		// Both formats store `BM` xored and both read the header after deobfuscating. A Lilim file is untouched
		// behind its thirty two byte prefix and a Regrips one is xored throughout, so the two readers agree on
		// the header either way: the reference draws no distinction here and neither does the port.
		const lilim = buildImg(buildBmp(2, 2, 24));
		expect(await imgBmpImageFormat.detect(sourceOf(lilim), "A.img")).toBe(true);
		expect(await brgImageFormat.detect(sourceOf(lilim), "A.brg")).toBe(true);
		// What the bytes behind the header say is still this format's own business: its extraction leaves them
		// as they are, which is a readable bitmap.
		const output = await extract(lilim);
		expect(output.subarray(54).equals(buildBmp(2, 2, 24).subarray(54))).toBe(
			true,
		);
	});

	it("is not fooled by a graphic from the other obfuscated format", async () => {
		// The Regrips graphic xors the whole file and so does not start with the xored bitmap tag.
		const png: Buffer = Buffer.from([
			0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
		]);
		const regrips: Buffer = Buffer.from(png.map((x) => x ^ 0xff));
		expect(await imgBmpImageFormat.detect(sourceOf(regrips), "A.img")).toBe(
			false,
		);
		// And this format's own files are not claimed by the graphic reader either.
		expect(
			await prgImageFormat.detect(
				sourceOf(buildImg(buildBmp(2, 2, 24))),
				"A.img",
			),
		).toBe(false);
	});

	it("takes the size and the depth from the deobfuscated bitmap", async () => {
		for (const [width, height, depth] of [
			[3, 2, 24],
			[5, 4, 32],
		] as [number, number, 24 | 32][]) {
			const archive = await imgBmpImageFormat.open(
				sourceOf(buildImg(buildBmp(width, height, depth))),
				"A.img",
			);
			try {
				expect(archive.entries[0]?.metadata).toMatchObject({
					type: "image",
					width,
					height,
					bitsPerPixel: depth,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("hands the deobfuscated bitmap over whole", async () => {
		const bmp = buildBmp(6, 3, 32);
		const output = await extract(buildImg(bmp));
		expect(output.equals(bmp)).toBe(true);
		expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
		// Nothing was re-encoded: the size word and the pixel bytes are the bitmap's own.
		expect(output.readUInt32LE(2)).toBe(bmp.length);
		expect(output.subarray(54).equals(bmp.subarray(54))).toBe(true);
	});

	it("names the entry after the bitmap and knows the size", async () => {
		const archive = await imgBmpImageFormat.open(
			sourceOf(buildImg(buildBmp(2, 2, 24))),
			"sub/CG_05.img",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_05.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 2,
				height: 2,
			});
		} finally {
			await archive.close();
		}
	});
});
