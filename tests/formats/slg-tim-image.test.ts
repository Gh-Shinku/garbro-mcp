import { MsvcRandom } from "@garbro-mcp/codecs";
import { BufferByteSource } from "@garbro-mcp/core";
import { timImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 1024;
const VERSION = "TIM Data Ver 1.00\0";
const TABLE_SIZE = 0x1000;

interface TimOptions {
	seed?: number;
	width?: number;
	height?: number;
	/** Bytes a stored row takes, which may be wider than the pixels in it. */
	stride?: number;
	/** A plain pixel block, which the builder encrypts. */
	pixels?: Buffer;
	version?: string;
	headerSize?: number;
	body?: Buffer;
}

/**
 * Encrypts a plain image the way the format would: the header's second half has a generator's low bytes
 * subtracted from it, and the pixels take the same sequence's key table from where the header left it. The
 * generator is never reseeded, which is the detail the fixture has to get right too.
 */
function buildTim(options: TimOptions = {}): Buffer {
	const seed = options.seed ?? 0x12345678;
	const width = options.width ?? 2;
	const height = options.height ?? 1;
	const stride = options.stride ?? width * 3;
	if (options.body !== undefined) {
		return Buffer.concat([
			Buffer.alloc(options.headerSize ?? HEADER_SIZE, 0x00),
			options.body,
		]);
	}
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.version ?? VERSION, 0x2de, "latin1");
	header.writeUInt32LE(width, 0x248);
	header.writeUInt32LE(height, 0x29c);
	header.writeInt32LE(stride, 0x2ba);
	for (const [index, offset] of [18, 42, 98, 118].entries()) {
		header[offset] = (seed >>> (index * 8)) & 0xff;
	}
	const random = new MsvcRandom(seed);
	for (let index = HEADER_SIZE / 2; index < HEADER_SIZE; index += 1) {
		header[index] = ((header[index] ?? 0) + (random.next() & 0xff)) & 0xff;
	}
	const table: Buffer = Buffer.alloc(TABLE_SIZE, 0x00);
	for (let index = 0; index < table.length; index += 1) {
		table[index] = random.next() & 0xff;
	}
	// A stride the format would refuse leaves no pixel block to build, which the probe does not care about.
	const size = Math.max(0, stride * height);
	const plain: Buffer = options.pixels ?? Buffer.alloc(size, 0x00);
	const stored: Buffer = Buffer.alloc(Math.max(size, plain.length), 0x00);
	for (let index = 0; index < stored.length; index += 1) {
		stored[index] =
			((plain[index] ?? 0) + (table[index & (TABLE_SIZE - 1)] ?? 0)) & 0xff;
	}
	return Buffer.concat([header, stored]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.tim"): Promise<Buffer> {
	const archive = await timImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("SLG system encrypted image", () => {
	it("is gated on the extension, the length and the version string", async () => {
		const file = buildTim({ width: 2, height: 1 });
		expect(await timImageFormat.detect(sourceOf(file), "CG_01.tim")).toBe(true);
		expect(await timImageFormat.detect(sourceOf(file), "CG_01.TIM")).toBe(true);
		expect(await timImageFormat.detect(sourceOf(file), "CG_01.dat")).toBe(
			false,
		);
		expect(
			await timImageFormat.detect(sourceOf(file.subarray(0, 1023)), "A.tim"),
		).toBe(false);
		// The version string is what the scrambled half of the header is checked for.
		expect(
			await timImageFormat.detect(
				sourceOf(buildTim({ version: "TIM Data Ver 1.01\0" })),
				"A.tim",
			),
		).toBe(false);
		// A header whose seed bytes do not match its encryption reads as noise.
		const mismatched = buildTim({ seed: 0x0badc0de });
		mismatched[18] = 0x99;
		expect(await timImageFormat.detect(sourceOf(mismatched), "A.tim")).toBe(
			false,
		);
	});

	it("folds the seed from four bytes spread through the header", async () => {
		for (const seed of [0, 1, 0xdeadbeef, 0xffffffff]) {
			const file = buildTim({ seed, width: 3, height: 2 });
			expect(await timImageFormat.detect(sourceOf(file), "A.tim")).toBe(true);
			// The four bytes really are the seed: reading them back gives what the fixture put there.
			expect(
				(file[18] ?? 0) |
					((file[42] ?? 0) << 8) |
					((file[98] ?? 0) << 16) |
					((file[118] ?? 0) << 24),
			).toBe(seed | 0);
		}
	});

	it("takes the size and the stride from the decrypted header", async () => {
		const archive = await timImageFormat.open(
			sourceOf(buildTim({ width: 5, height: 4, stride: 20 })),
			"A.tim",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 5,
				height: 4,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 5,
				height: 4,
			});
		} finally {
			await archive.close();
		}
	});

	it("decrypts the pixels with the table the header's own sequence leaves behind", async () => {
		// Six bytes of colour, encrypted by the builder with the same generator, so the output must be the
		// plain input byte for byte.
		const plain: Buffer = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
		const output = await extract(
			buildTim({ width: 2, height: 1, pixels: plain }),
		);
		expect(output.readUInt16LE(28)).toBe(24);
		// The reference hands this image over flipped.
		expect(output.readInt32LE(22)).toBe(1);
		// Six bytes of colour in a row that a bitmap pads to eight.
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x00, 0x00]),
		);
	});

	it("drops the bytes a stored row holds beyond the pixels", async () => {
		// A row of eight stored bytes for two pixels: six of colour and two that are not pixels at all.
		const plain: Buffer = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0xaa, 0xbb,
		]);
		const output = await extract(
			buildTim({ width: 2, height: 1, stride: 8, pixels: plain }),
		);
		// Eight bytes of image, four of padding, and none of the two the row carried.
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x00, 0x00]),
		);
	});

	it("pads a short pixel block rather than failing on it", async () => {
		const plain: Buffer = Buffer.from([0x77, 0x77, 0x77]);
		const output = await extract(
			buildTim({ width: 2, height: 1, pixels: plain }),
		);
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x77, 0x77, 0x77, 0x00, 0x00, 0x00, 0x00, 0x00]),
		);
	});

	it("refuses a stride that cannot describe a row, and lists what it has", async () => {
		const negative = buildTim({ width: 2, height: 1, stride: -4 });
		expect(await timImageFormat.detect(sourceOf(negative), "A.tim")).toBe(true);
		await expect(extract(negative)).rejects.toThrow();
		const file = buildTim({ width: 2, height: 2 });
		const archive = await timImageFormat.open(sourceOf(file), "sub/CG_03.tim");
		try {
			expect(archive.entries[0]?.path).toBe("CG_03.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
