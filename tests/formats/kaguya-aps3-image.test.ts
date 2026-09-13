import { BufferByteSource } from "@garbro-mcp/core";
import { aps3ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BMP_HEADER_SIZE = 54;
const FRAME_SIZE = 0x1000;

/** MSB first, the ordering the KaGuYa codec reads. */
class MsbWriter {
	#bytes: number[] = [];
	#current = 0;
	#bitCount = 0;

	writeBit(bit: number): void {
		this.#current = (this.#current << 1) | (bit & 1);
		this.#bitCount += 1;
		if (this.#bitCount === 8) {
			this.#bytes.push(this.#current);
			this.#current = 0;
			this.#bitCount = 0;
		}
	}

	writeBits(value: number, count: number): void {
		for (let index = count - 1; index >= 0; index -= 1) {
			this.writeBit((value >> index) & 1);
		}
	}

	finish(): Buffer {
		if (this.#bitCount > 0) {
			this.#bytes.push((this.#current << (8 - this.#bitCount)) & 0xff);
			this.#current = 0;
			this.#bitCount = 0;
		}
		return Buffer.from(this.#bytes);
	}
}

/** Mirrors the decoder's frame so a match can name the distance it wants. */
class LzWriter {
	#writer = new MsbWriter();
	#frame: Buffer = Buffer.alloc(FRAME_SIZE, 0x00);
	#framePos = 1;

	literal(byte: number): void {
		this.#writer.writeBit(1);
		this.#writer.writeBits(byte, 8);
		this.#frame[this.#framePos++] = byte;
		this.#framePos &= FRAME_SIZE - 1;
	}

	/** `distance` bytes back, `count` of them, with the count biased by two as the format stores it. */
	match(distance: number, count: number): void {
		this.#writer.writeBit(0);
		const offset = (this.#framePos - distance) & (FRAME_SIZE - 1);
		this.#writer.writeBits(offset, 12);
		this.#writer.writeBits(count - 2, 4);
		let position = this.#framePos;
		for (let index = 0; index < count; index += 1) {
			const byte = this.#frame[(offset + index) & (FRAME_SIZE - 1)] ?? 0;
			this.#frame[position++] = byte;
			position &= FRAME_SIZE - 1;
		}
		this.#framePos = position;
	}

	finish(): Buffer {
		return this.#writer.finish();
	}
}

/** An inner AP image: bottom row first, four bytes a pixel. */
function buildAp(width: number, height: number, pixels: Buffer): Buffer {
	const header: Buffer = Buffer.alloc(12, 0x00);
	header.write("AP", 0, "latin1");
	header.writeUInt32LE(width, 2);
	header.writeUInt32LE(height, 6);
	header.writeInt16LE(32, 10);
	return Buffer.concat([header, pixels]);
}

interface Part {
	name: string;
	x: number;
	y: number;
	farX: number;
	farY: number;
}

function buildParts(parts: Part[]): Buffer {
	const chunks: Buffer[] = [];
	for (const part of parts) {
		const header: Buffer = Buffer.alloc(4 + 1, 0x00);
		const name = Buffer.from(part.name, "latin1");
		header.writeUInt8(name.length, 4);
		const rect: Buffer = Buffer.alloc(16 + 12, 0x00);
		rect.writeInt32LE(part.x, 0);
		rect.writeInt32LE(part.y, 4);
		rect.writeInt32LE(part.farX, 8);
		rect.writeInt32LE(part.farY, 12);
		chunks.push(header, name, rect);
	}
	return Buffer.concat([
		Buffer.from([0x04, 0x41, 0x50, 0x53, 0x33]),
		(() => {
			const count: Buffer = Buffer.alloc(4, 0x00);
			count.writeInt32LE(parts.length, 0);
			return count;
		})(),
		...chunks,
	]);
}

function buildAps3(options: {
	parts: Part[];
	payload: Buffer;
	compression?: number;
	packed?: Buffer;
	/** What the payload should decompress to; defaults to the payload itself. */
	unpackedSize?: number;
	dataSize?: number;
	version?: number;
}): Buffer {
	const table = buildParts(options.parts);
	const compression = options.compression ?? 0;
	const packed = options.packed ?? Buffer.alloc(0);
	const trailer: Buffer = Buffer.alloc(compression === 1 ? 10 : 6, 0x00);
	trailer.writeInt16LE(compression, 0);
	if (compression === 1) trailer.writeUInt32LE(packed.length, 2);
	trailer.writeUInt32LE(
		options.unpackedSize ?? options.payload.length,
		compression === 1 ? 6 : 2,
	);
	const declared =
		options.dataSize ??
		trailer.length + (compression === 1 ? packed.length : 0);
	const size: Buffer = Buffer.alloc(4, 0x00);
	size.writeUInt32LE(declared, 0);
	const file = Buffer.concat([table, size, trailer, packed, options.payload]);
	if (options.version !== undefined) file[4] = options.version;
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "PARTS.APS"): Promise<Buffer> {
	const archive = await aps3ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

const IMAGE_PIXELS = Buffer.from([
	0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x21, 0x22, 0x23, 0x24, 0x25,
	0x26, 0x27, 0x28,
]);
const INNER = buildAp(2, 2, IMAGE_PIXELS);
/** A named part at (10, 10) reaching (15, 15). */
const PART: Part = { name: "head", x: 10, y: 10, farX: 15, farY: 15 };

describe("kaguya aps3 tiled image", () => {
	it("registers the four byte signature and the three extensions", () => {
		expect(aps3ImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x04, 0x41, 0x50, 0x53]) },
		]);
		expect(aps3ImageFormat.descriptor.extensions).toEqual([
			"aps",
			"parts",
			"ap3",
		]);
	});

	it("includes the origin in the union of its parts", async () => {
		// The bounding box starts at (0, 0) and grows outwards, so a part at (10, 10) reaching (15, 15) makes
		// the image fifteen by fifteen rather than five by five.
		const file = buildAps3({ parts: [PART], payload: INNER });
		const archive = await aps3ImageFormat.open(sourceOf(file), "PARTS.APS");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 15,
				height: 15,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({ compression: 0 });
		} finally {
			await archive.close();
		}
	});

	it("leaves unnamed parts out of the union but still extracts the payload", async () => {
		const file = buildAps3({
			parts: [{ ...PART, name: "" }],
			payload: INNER,
		});
		const archive = await aps3ImageFormat.open(sourceOf(file), "PARTS.APS");
		try {
			// The union stayed at the origin, so the metadata is empty while the payload is a real image.
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 0,
				height: 0,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		expect(output.readInt32LE(18)).toBe(2);
		expect(output.readInt32LE(22)).toBe(-2);
	});

	it("runs the base format's reader on the payload, rows and all", async () => {
		const file = buildAps3({ parts: [PART], payload: INNER });
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(32);
		// `ImageData.Create`, the base format's factory: top down, so a negative height, and the stored rows
		// reversed into it.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([
				0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x11, 0x12, 0x13, 0x14,
				0x15, 0x16, 0x17, 0x18,
			]),
		);
	});

	it("decompresses a packed payload with the KaGuYa LZ codec", async () => {
		const writer = new LzWriter();
		for (let index = 0; index < INNER.length; index += 1) {
			writer.literal(INNER[index] ?? 0);
		}
		const packed = writer.finish();
		const plain = await extract(buildAps3({ parts: [PART], payload: INNER }));
		const compressed = await extract(
			buildAps3({
				parts: [PART],
				payload: Buffer.alloc(0),
				compression: 1,
				packed,
				unpackedSize: INNER.length,
			}),
		);
		expect(compressed).toEqual(plain);
	});

	it("copies a match out of the sliding window", async () => {
		// Four pixel bytes then a twelve byte match reading four bytes back: the copy overlaps itself and the
		// frame advances as it goes, so the whole run repeats. This is the codec's second path, and the
		// uncompressed twin proves the bytes.
		const pixels = Buffer.from([
			0xa1, 0xb2, 0xc3, 0xd4, 0xa1, 0xb2, 0xc3, 0xd4, 0xa1, 0xb2, 0xc3, 0xd4,
			0xa1, 0xb2, 0xc3, 0xd4,
		]);
		const inner = buildAp(4, 1, pixels);
		const writer = new LzWriter();
		for (let index = 0; index < 16; index += 1) {
			writer.literal(inner[index] ?? 0);
		}
		writer.match(4, 12);
		const plain = await extract(buildAps3({ parts: [PART], payload: inner }));
		const compressed = await extract(
			buildAps3({
				parts: [PART],
				payload: Buffer.alloc(0),
				compression: 1,
				packed: writer.finish(),
				unpackedSize: inner.length,
			}),
		);
		expect(compressed).toEqual(plain);
		// One row of four pixels, so the body is the pixels in storage order.
		expect(compressed.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("declines an unknown version, a third compression mode and an overlong payload", async () => {
		const good = buildAps3({ parts: [PART], payload: INNER });
		expect(await aps3ImageFormat.detect(sourceOf(good), "A.APS")).toBe(true);
		expect(
			await aps3ImageFormat.detect(
				sourceOf(buildAps3({ parts: [PART], payload: INNER, version: 0x32 })),
				"A.APS",
			),
		).toBe(false);
		expect(
			await aps3ImageFormat.detect(
				sourceOf(buildAps3({ parts: [PART], payload: INNER, compression: 2 })),
				"A.APS",
			),
		).toBe(false);
		expect(
			await aps3ImageFormat.detect(
				sourceOf(
					buildAps3({ parts: [PART], payload: INNER, dataSize: 0x10000 }),
				),
				"A.APS",
			),
		).toBe(false);
	});

	it("fails when the payload is not an AP image", async () => {
		const file = buildAps3({
			parts: [PART],
			payload: Buffer.alloc(32, 0x5a),
		});
		expect(await aps3ImageFormat.detect(sourceOf(file), "A.APS")).toBe(true);
		const archive = await aps3ImageFormat.open(sourceOf(file), "A.APS");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});
});
