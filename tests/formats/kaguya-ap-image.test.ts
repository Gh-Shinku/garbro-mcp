import { BufferByteSource } from "@garbro-mcp/core";
import { apImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 12;
const BMP_HEADER_SIZE = 54;

/** A patch of four byte pixels, one array a row. */
function rows(...values: number[][]): Buffer {
	return Buffer.from(values.flat());
}

interface ApOptions {
	marker?: string;
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	pixels?: Buffer;
}

function buildAp(options: ApOptions = {}): Buffer {
	const { marker = "AP", width = 2, height = 2, bitsPerPixel = 32 } = options;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(marker, 0, "latin1");
	header.writeUInt32LE(width, 2);
	header.writeUInt32LE(height, 6);
	header.writeInt16LE(bitsPerPixel, 10);
	return Buffer.concat([
		header,
		options.pixels ??
			rows(
				[0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18],
				[0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28],
			),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "BG_001.AP"): Promise<Buffer> {
	const archive = await apImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("kaguya ap image", () => {
	it("has no signature and declares the seven extensions", () => {
		expect(apImageFormat.detection?.signatures).toEqual([]);
		expect(apImageFormat.descriptor.extensions).toEqual([
			"bg_",
			"cg_",
			"cgw",
			"sp_",
			"aps",
			"alp",
			"prs",
		]);
	});

	it("requires the AP marker, a dimension ceiling and one of two depths", async () => {
		expect(await apImageFormat.detect(sourceOf(buildAp()), "A.AP")).toBe(true);
		expect(
			await apImageFormat.detect(sourceOf(buildAp({ marker: "AQ" })), "A.AP"),
		).toBe(false);
		for (const bitsPerPixel of [0, 8, 16, 31, 33, -24]) {
			expect(
				await apImageFormat.detect(sourceOf(buildAp({ bitsPerPixel })), "A.AP"),
			).toBe(false);
		}
		expect(
			await apImageFormat.detect(sourceOf(buildAp({ width: 0x8001 })), "A.AP"),
		).toBe(false);
		expect(
			await apImageFormat.detect(sourceOf(buildAp({ height: 0x8001 })), "A.AP"),
		).toBe(false);
		// Neither dimension is tested for zero, so an empty image is a valid one.
		expect(
			await apImageFormat.detect(
				sourceOf(buildAp({ width: 0, height: 0, pixels: Buffer.alloc(0) })),
				"A.AP",
			),
		).toBe(true);
	});

	it("reverses the stored rows, which run bottom up", async () => {
		// The first row in the file is the bottom row of the image, and the buffer is built top down.
		const file = buildAp();
		const source = sourceOf(file);
		expect(await apImageFormat.detect(source, "BG_001.AP")).toBe(true);
		const archive = await apImageFormat.open(source, "BG_001.AP");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"BG_001.bmp",
			]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(32);
		// `ImageData.Create` is top down, so the height is negative.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			rows(
				[0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28],
				[0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18],
			),
		);
		expect(output.length).toBe(BMP_HEADER_SIZE + 16);
	});

	it("treats the depth as a label: twenty four bit pixels are still four bytes", async () => {
		const file = buildAp({ bitsPerPixel: 24 });
		const archive = await apImageFormat.open(sourceOf(file), "CG_001.AP");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 24 });
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		// The stored depth is reported as it was, while the bitmap the port writes is thirty two bit.
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.length).toBe(BMP_HEADER_SIZE + 16);
	});

	it("fails on extraction when a row is short", async () => {
		// The reference throws when a row does not arrive whole, so a truncated image lists and then fails.
		const file = buildAp();
		const truncated = file.subarray(0, file.length - 2);
		expect(await apImageFormat.detect(sourceOf(truncated), "A.AP")).toBe(true);
		const archive = await apImageFormat.open(sourceOf(truncated), "A.AP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("accepts a header on its own when both dimensions are zero", async () => {
		const file = buildAp({ width: 0, height: 0, pixels: Buffer.alloc(0) });
		expect((await extract(file)).length).toBe(BMP_HEADER_SIZE);
	});

	it("declines a file shorter than a header", async () => {
		expect(
			await apImageFormat.detect(
				sourceOf(buildAp().subarray(0, HEADER_SIZE - 1)),
				"A.AP",
			),
		).toBe(false);
	});
});
