import { BufferByteSource } from "@garbro-mcp/core";
import { brgImageFormat, decryptRegrips } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** A bitmap as the shared writer makes it: a `BM` tag, a complete header and tight or padded rows. */
function buildBmp(
	width: number,
	height: number,
	bitsPerPixel: 24 | 32,
): Buffer {
	const header: Buffer = Buffer.alloc(54, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(14 + 40, 10);
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(width, 18);
	header.writeInt32LE(height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(bitsPerPixel, 28);
	const rowSize = Math.floor((width * (bitsPerPixel / 8) + 3) / 4) * 4;
	const body: Buffer = Buffer.alloc(rowSize * height, 0x40);
	header.writeUInt32LE(header.length + body.length, 2);
	return Buffer.concat([header, body]);
}

/** The stored file is the bitmap with every byte xored. */
function buildBrg(bmp: Buffer): Buffer {
	return decryptRegrips(bmp);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.brg"): Promise<Buffer> {
	const archive = await brgImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

async function metadataOf(
	file: Buffer,
): Promise<Record<string, unknown> | undefined> {
	const archive = await brgImageFormat.open(sourceOf(file), "A.brg");
	try {
		return archive.entries[0]?.metadata;
	} finally {
		await archive.close();
	}
}

describe("Regrips encrypted bitmap", () => {
	it("probes the decrypted bitmap and claims nothing else", async () => {
		const brg = buildBrg(buildBmp(3, 2, 24));
		expect(await brgImageFormat.detect(sourceOf(brg), "A.brg")).toBe(true);
		// A plain bitmap is not this format.
		expect(
			await brgImageFormat.detect(sourceOf(buildBmp(3, 2, 24)), "A.brg"),
		).toBe(false);
		// Nor is the compressed bitmap that starts with an xored `SZDD`, nor a short file.
		expect(
			await brgImageFormat.detect(
				sourceOf(Buffer.from("SZDD", "latin1")),
				"A.brg",
			),
		).toBe(false);
		expect(
			await brgImageFormat.detect(sourceOf(Buffer.alloc(8, 0xff)), "A.brg"),
		).toBe(false);
	});

	it("refuses a prefix that hides anything but a bitmap", async () => {
		const notABitmap: Buffer = decryptRegrips(
			Buffer.concat([Buffer.from("XX"), Buffer.alloc(60, 0x11)]),
		);
		expect(await brgImageFormat.detect(sourceOf(notABitmap), "A.brg")).toBe(
			false,
		);
		await expect(extract(notABitmap)).rejects.toThrow();
		// A bitmap whose DIB header is too short is refused too.
		const shortDib = buildBmp(2, 2, 32);
		shortDib.writeUInt32LE(12, 14);
		const stored = decryptRegrips(shortDib);
		expect(await brgImageFormat.detect(sourceOf(stored), "A.brg")).toBe(false);
	});

	it("takes the size, the depth and the sign of the height from the bitmap", async () => {
		expect(await metadataOf(buildBrg(buildBmp(3, 2, 24)))).toMatchObject({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(await metadataOf(buildBrg(buildBmp(5, 4, 32)))).toMatchObject({
			width: 5,
			height: 4,
			bitsPerPixel: 32,
		});
		// A top down bitmap stores a negative height, which the shared reader reports as its magnitude.
		const topDown = buildBmp(4, 3, 24);
		topDown.writeInt32LE(-3, 22);
		expect(await metadataOf(buildBrg(topDown))).toMatchObject({ height: 3 });
	});

	it("handing over the decrypted bitmap keeps its padding", async () => {
		// Three pixels a row at three bytes is not a multiple of four, so the file holds padding bytes.
		const bmp = buildBmp(3, 2, 24);
		// Nine bytes a row padded to twelve, twice, behind the fifty four byte header.
		expect(bmp.length).toBe(54 + 12 * 2);
		const output = await extract(buildBrg(bmp));
		expect(output.equals(bmp)).toBe(true);
		expect(output.readUInt32LE(2)).toBe(bmp.length);
	});

	it("accepts a bitmap whose size word is zero, as the reference does", async () => {
		// The reference treats a zero size as unknown and uses the stream's own length.
		const bmp = buildBmp(2, 2, 32);
		bmp.writeUInt32LE(0, 2);
		const stored = buildBrg(bmp);
		expect(await brgImageFormat.detect(sourceOf(stored), "A.brg")).toBe(true);
		const output = await extract(stored);
		expect(output.equals(bmp)).toBe(true);
	});

	it("hands a truncated bitmap over rather than refusing it", async () => {
		const stored = buildBrg(buildBmp(6, 4, 32));
		const cut = stored.subarray(0, 60);
		// The header is intact, so the probe accepts it and the extraction keeps what is there.
		expect(await brgImageFormat.detect(sourceOf(cut), "A.brg")).toBe(true);
		const output = await extract(cut);
		expect(output.length).toBe(60);
		expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
	});

	it("names the entry after the bitmap and knows the size", async () => {
		const archive = await brgImageFormat.open(
			sourceOf(buildBrg(buildBmp(2, 2, 32))),
			"sub/CG_09.brg",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_09.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
	});
});
