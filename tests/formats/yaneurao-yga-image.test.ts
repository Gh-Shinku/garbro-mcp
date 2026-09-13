import { BufferByteSource } from "@garbro-mcp/core";
import { ygaImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x18;
const MAX_UNPACKED_SIZE = 0x4000000;

/** Literal only LZSS with the reference's default frame, which a literal stream never reads anyway. */
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

interface YgaOptions {
	marker?: string;
	compressed?: boolean;
	unpackedSize?: number;
	compressionWord?: number;
}

function buildYga(
	width: number,
	height: number,
	pixels: Buffer,
	options: YgaOptions = {},
): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "yga", 0, "latin1");
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	header.writeInt32LE(
		options.compressionWord ?? (options.compressed ? 1 : 0),
		0x0c,
	);
	header.writeInt32LE(options.unpackedSize ?? pixels.length, 0x10);
	const body = options.compressed ? lzssLiterals(pixels) : pixels;
	return Buffer.concat([header, body]);
}

function pixelsOf(width: number, height: number): Buffer {
	const pixels = Buffer.alloc(width * height * 4, 0x00);
	for (let index = 0; index < pixels.length; index += 1) {
		pixels[index] = (index * 13 + 7) & 0xff;
	}
	return pixels;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.yga"): Promise<Buffer> {
	const archive = await ygaImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("yaneurao image format", () => {
	it("declares both markers and both extensions", () => {
		expect(ygaImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x79, 0x67, 0x61]) },
			{ bytes: Buffer.from([0x65, 0x70, 0x66]) },
		]);
		expect(ygaImageFormat.descriptor.extensions).toEqual(["yga", "epf"]);
	});

	it("accepts either three byte marker", async () => {
		const pixels = pixelsOf(2, 2);
		for (const marker of ["yga", "epf"]) {
			expect(
				await ygaImageFormat.detect(
					sourceOf(buildYga(2, 2, pixels, { marker })),
					"A.yga",
				),
			).toBe(true);
		}
		const wrong = buildYga(2, 2, pixels, { marker: "xga" });
		expect(await ygaImageFormat.detect(sourceOf(wrong), "A.yga")).toBe(false);
		expect(
			await ygaImageFormat.detect(
				sourceOf(buildYga(2, 2, pixels).subarray(0, 0x17)),
				"A.yga",
			),
		).toBe(false);
	});

	it("reports the header fields", async () => {
		const archive = await ygaImageFormat.open(
			sourceOf(buildYga(3, 5, pixelsOf(3, 5))),
			"CG_01.EPF",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_01.bmp");
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 5,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				unpackedSize: 3 * 5 * 4,
				compressed: false,
			});
		} finally {
			await archive.close();
		}
	});

	it("reads the compression word as signed", async () => {
		const pixels = pixelsOf(2, 2);
		for (const word of [2, 5, 100]) {
			expect(
				await ygaImageFormat.detect(
					sourceOf(buildYga(2, 2, pixels, { compressionWord: word })),
					"A.yga",
				),
			).toBe(false);
		}
		// Only a word above one is refused, so a negative one passes and, because the test is `!= 0`, it counts
		// as compressed.
		const negative = buildYga(2, 2, pixels, {
			compressed: true,
			compressionWord: -1,
		});
		expect(await ygaImageFormat.detect(sourceOf(negative), "A.yga")).toBe(true);
		const archive = await ygaImageFormat.open(sourceOf(negative), "A.yga");
		try {
			expect(archive.metadata).toMatchObject({ compressed: true });
		} finally {
			await archive.close();
		}
	});

	it("writes a top down bitmap from the stored pixels", async () => {
		const pixels = pixelsOf(3, 2);
		const output = await extract(buildYga(3, 2, pixels));
		expect(output.readUInt16LE(0)).toBe(0x4d42);
		expect(output.readUInt16LE(28)).toBe(32);
		// `ImageData.Create` has no stride of its own, and its bitmap is top down, which a negative height says.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(54)).toEqual(pixels);
	});

	it("decompresses a compressed payload", async () => {
		const pixels = pixelsOf(4, 3);
		const plain = await extract(buildYga(4, 3, pixels));
		const packed = await extract(buildYga(4, 3, pixels, { compressed: true }));
		expect(packed).toEqual(plain);
		expect(packed.subarray(54)).toEqual(pixels);
	});

	it("leaves the tail of the buffer as it was allocated", async () => {
		// The reference ignores what its reader returns, so a stream that stops early yields zeroes rather than
		// an error — the array was allocated empty and only the decoded part is written.
		const pixels = pixelsOf(2, 2);
		const truncated = lzssLiterals(pixels).subarray(0, 9);
		const file = Buffer.concat([
			// The header has to say compressed, or the port would take the plain path and copy the stream.
			buildYga(2, 2, pixels, { compressed: true }).subarray(0, HEADER_SIZE),
			truncated,
		]);
		const output = await extract(file);
		expect(output.subarray(54, 54 + 8)).toEqual(pixels.subarray(0, 8));
		expect(output.subarray(54 + 8)).toEqual(
			Buffer.alloc(pixels.length - 8, 0x00),
		);
	});

	it("fills an uncompressed file's missing tail with zeroes", async () => {
		const pixels = pixelsOf(2, 2);
		const file = Buffer.concat([
			buildYga(2, 2, pixels).subarray(0, HEADER_SIZE),
			pixels.subarray(0, 6),
		]);
		const output = await extract(file);
		expect(output.subarray(54, 60)).toEqual(pixels.subarray(0, 6));
		expect(output.subarray(60)).toEqual(Buffer.alloc(pixels.length - 6, 0x00));
	});

	it("refuses a declared size a bitmap cannot use", async () => {
		const pixels = pixelsOf(2, 2);
		// Too small for the pixels the header asks for.
		await expect(
			extract(buildYga(2, 2, pixels, { unpackedSize: 12 })),
		).rejects.toThrow();
		// Negative, which the reference would refuse to allocate.
		await expect(
			extract(buildYga(2, 2, pixels, { unpackedSize: -1 })),
		).rejects.toThrow();
		await expect(
			extract(buildYga(2, 2, pixels, { unpackedSize: MAX_UNPACKED_SIZE + 1 })),
		).rejects.toThrow();
	});
});
