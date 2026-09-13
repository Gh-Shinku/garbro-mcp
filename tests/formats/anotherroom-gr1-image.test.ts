import { BufferByteSource } from "@garbro-mcp/core";
import { gr1ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x4c, 0x55, 0x56, 0x4c]);
const HEADER_SIZE = 0x24;
const DATA_OFFSET = 66;

const WIDTH = 3;
const HEIGHT = 2;

/** The codec's control byte: one per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

function buildPixels(width = WIDTH, height = HEIGHT): Buffer {
	const pixels: Buffer = Buffer.alloc(width * height * 2);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 29 + 3) & 0xff;
	return pixels;
}

function buildGr1(
	pixels = buildPixels(),
	width = WIDTH,
	height = HEIGHT,
): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.write("LATIO", 4, "latin1");
	header.writeUInt32LE(width, 0x1c);
	header.writeUInt32LE(height, 0x20);
	return Buffer.concat([header, lzssLiterals(pixels)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("anotherroom gr1 image", () => {
	it("declares the LUVL signature", () => {
		expect(gr1ImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
	});

	it("writes a bottom up 555 bitmap", async () => {
		const pixels = buildPixels();
		const stored = buildGr1(pixels);
		const source = sourceOf(stored);
		expect(await gr1ImageFormat.detect(source, "CG01.GR1")).toBe(true);
		const archive = await gr1ImageFormat.open(source, "CG01.GR1");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 15,
			});
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.encrypted).toBe(false);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
				width: WIDTH,
				height: HEIGHT,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// A bitmap field, with the 555 masks and a data offset past the three masks.
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.readInt32LE(22)).toBe(HEIGHT);
			expect(output.readUInt16LE(28)).toBe(16);
			expect(output.readUInt32LE(30)).toBe(3);
			expect(output.readUInt32LE(54)).toBe(0x7c00);
			expect(output.readUInt32LE(58)).toBe(0x03e0);
			expect(output.readUInt32LE(62)).toBe(0x001f);
			// Three pixels per row are six stored bytes, padded to eight.
			const stride = 8;
			const body = output.subarray(DATA_OFFSET);
			expect(body.length).toBe(stride * HEIGHT);
			for (let row = 0; row < HEIGHT; row += 1) {
				expect(body.subarray(row * stride, row * stride + WIDTH * 2)).toEqual(
					pixels.subarray(row * WIDTH * 2, (row + 1) * WIDTH * 2),
				);
				expect(
					body.subarray(row * stride + WIDTH * 2, (row + 1) * stride),
				).toEqual(Buffer.alloc(stride - WIDTH * 2));
			}
		} finally {
			await archive.close();
		}
	});

	it("leaves the rest zero when the stream ends early", async () => {
		const stored = buildGr1(Buffer.from([0x21, 0x43]), WIDTH, HEIGHT);
		const archive = await gr1ImageFormat.open(sourceOf(stored), "CG01.GR1");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(DATA_OFFSET, DATA_OFFSET + 6)).toEqual(
				Buffer.from([0x21, 0x43, 0x00, 0x00, 0x00, 0x00]),
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose marker is wrong", async () => {
		const stored = buildGr1();
		// Only the last character of `LATIO` changes, so the signature still matches.
		stored[8] = 0x41;
		expect(await gr1ImageFormat.detect(sourceOf(stored), "CG01.GR1")).toBe(
			false,
		);
	});

	it("declines zero dimensions", async () => {
		expect(
			await gr1ImageFormat.detect(
				sourceOf(buildGr1(Buffer.alloc(0), 0, HEIGHT)),
				"CG01.GR1",
			),
		).toBe(false);
	});

	it("declines a file that stops inside the header", async () => {
		const stored = buildGr1().subarray(0, HEADER_SIZE - 1);
		expect(await gr1ImageFormat.detect(sourceOf(stored), "CG01.GR1")).toBe(
			false,
		);
	});

	it("treats an empty stream as a zeroed image", async () => {
		// A header with no stream at all is what the reference sees as an exhausted LZSS stream, and it
		// reads that as the zero filled pixel buffer it allocated.
		const stored = buildGr1(Buffer.alloc(0));
		expect(await gr1ImageFormat.detect(sourceOf(stored), "CG01.GR1")).toBe(
			true,
		);
		const archive = await gr1ImageFormat.open(sourceOf(stored), "CG01.GR1");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			const stride = 8;
			expect(output.subarray(DATA_OFFSET)).toEqual(
				Buffer.alloc(stride * HEIGHT),
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a different signature", async () => {
		const stored = buildGr1();
		stored[3] = 0x4d;
		expect(await gr1ImageFormat.detect(sourceOf(stored), "CG01.GR1")).toBe(
			false,
		);
	});
});
