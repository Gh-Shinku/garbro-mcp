import { BufferByteSource } from "@garbro-mcp/core";
import { biz2ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;

/** GARbro's default LZSS framing: a set control bit means a literal, eight to a control byte. */
function lzssLiterals(data: Buffer): Buffer {
	const out: number[] = [];
	for (let index = 0; index < data.length; index += 8) {
		out.push(0xff);
		for (let next = index; next < Math.min(index + 8, data.length); next += 1) {
			out.push(data[next] ?? 0);
		}
	}
	return Buffer.from(out);
}

interface Biz2Options {
	width?: number;
	height?: number;
	marker?: string;
	payload?: Buffer;
	headerSize?: number;
}

function buildBiz2(options: Biz2Options = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const header: Buffer = Buffer.alloc(options.headerSize ?? HEADER_SIZE, 0x00);
	header.write(options.marker ?? "BIZ2", 0, "latin1");
	if (header.length >= HEADER_SIZE) {
		header.writeUInt16LE(width, 4);
		header.writeUInt16LE(height, 6);
	}
	return Buffer.concat([
		header,
		lzssLiterals(options.payload ?? Buffer.alloc(0)),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.biz"): Promise<Buffer> {
	const archive = await biz2ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("ADVIZ compressed image", () => {
	it("needs the four byte marker and a header that fits", async () => {
		expect(await biz2ImageFormat.detect(sourceOf(buildBiz2()), "A.biz")).toBe(
			true,
		);
		expect(
			await biz2ImageFormat.detect(
				sourceOf(buildBiz2({ marker: "BIZ1" })),
				"A.biz",
			),
		).toBe(false);
		expect(
			await biz2ImageFormat.detect(
				sourceOf(buildBiz2({ headerSize: 4 })),
				"A.biz",
			),
		).toBe(false);
	});

	it("reports the dimensions and twenty four bits", async () => {
		const archive = await biz2ImageFormat.open(
			sourceOf(buildBiz2({ width: 7, height: 5 })),
			"A.biz",
		);
		try {
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 7,
				height: 5,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
	});

	it("copies a colour plane", async () => {
		const payload: Buffer = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
		]);
		const output = await extract(buildBiz2({ payload }));
		expect(output.readUInt16LE(28)).toBe(24);
		// A flipped image carries a positive height.
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(54)).toEqual(
			Buffer.from([
				0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x00, 0x00, 0x07, 0x08, 0x09, 0x0a,
				0x0b, 0x0c, 0x00, 0x00,
			]),
		);
	});

	it("uses every third byte of an alpha plane", async () => {
		// Four pixels of colour and a plane whose other bytes are noise: only the red channel of each triple
		// is read, which is what the reference's comment about grayscale alpha describes.
		const rgb: Buffer = Buffer.from([
			0x01, 0x11, 0x21, 0x02, 0x12, 0x22, 0x03, 0x13, 0x23, 0x04, 0x14, 0x24,
		]);
		const alpha: Buffer = Buffer.from([
			0x80, 0xee, 0xee, 0x40, 0xee, 0xee, 0x20, 0xee, 0xee, 0x10, 0xee, 0xee,
		]);
		const output = await extract(
			buildBiz2({ payload: Buffer.concat([rgb, alpha]) }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(54)).toEqual(
			Buffer.from([
				0x01, 0x11, 0x21, 0x80, 0x02, 0x12, 0x22, 0x40, 0x03, 0x13, 0x23, 0x20,
				0x04, 0x14, 0x24, 0x10,
			]),
		);
	});

	it("requires a whole colour plane and a whole alpha plane", async () => {
		// Eleven bytes for twelve: the colour plane is short.
		await expect(
			extract(buildBiz2({ payload: Buffer.alloc(11, 0x00) })),
		).rejects.toThrow();
		// Thirteen bytes: one more than the colour plane, which is not a whole alpha plane.
		await expect(
			extract(buildBiz2({ payload: Buffer.alloc(13, 0x00) })),
		).rejects.toThrow();
		// An empty stream is a short colour plane too.
		await expect(
			extract(buildBiz2({ width: 1, height: 1, payload: Buffer.alloc(0) })),
		).rejects.toThrow();
	});

	it("ignores anything behind the two planes", async () => {
		const payload: Buffer = Buffer.concat([
			Buffer.alloc(12, 0x33),
			Buffer.alloc(12, 0xff),
			Buffer.alloc(20, 0x77),
		]);
		const output = await extract(buildBiz2({ payload }));
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.length).toBe(54 + 16);
	});

	it("lists its single bitmap entry", async () => {
		const file = buildBiz2({ payload: Buffer.alloc(12, 0x00) });
		const archive = await biz2ImageFormat.open(sourceOf(file), "sub/CG_05.biz");
		try {
			const entry = archive.entries[0];
			expect(entry?.path).toBe("CG_05.bmp");
			expect(entry?.sizeKnown).toBe(false);
			expect(entry?.size).toBe(BigInt(file.length));
		} finally {
			await archive.close();
		}
	});
});
