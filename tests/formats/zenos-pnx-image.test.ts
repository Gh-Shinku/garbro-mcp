import { BufferByteSource } from "@garbro-mcp/core";
import { pnxImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BODY_OFFSET = 8;
const MIN_SIZE = 0x21;
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

interface Built {
	file: Buffer;
	width: number;
	height: number;
	bitDepth: number;
	colorType: number;
}

/**
 * Builds an obfuscated PNG: the Zenos signature, four bytes the reference discards anyway, then a real
 * IHDR chunk at the offsets a plain PNG would use.
 */
function buildPnx(
	width = 0x60,
	height = 0x30,
	bitDepth = 8,
	colorType = 6,
	filler = 0x24,
): Built {
	const file: Buffer = Buffer.alloc(MIN_SIZE + 4, 0x33);
	Buffer.from([0x89, 0x50, 0x4e, 0x58]).copy(file, 0);
	file.fill(filler, 4, 8);
	file.writeUInt32BE(13, 8);
	file.write("IHDR", 12, "latin1");
	file.writeUInt32BE(width, 16);
	file.writeUInt32BE(height, 20);
	file[24] = bitDepth;
	file[25] = colorType;
	file.writeUInt32BE(0x12345678, 29);
	return { file, width, height, bitDepth, colorType };
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("zenos obfuscated png image", () => {
	it("declares the obfuscated signature for the registry", () => {
		expect(pnxImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x89, 0x50, 0x4e, 0x58]) },
		]);
	});

	it("replaces the first eight bytes and keeps the body", async () => {
		const built = buildPnx();
		const source = sourceOf(built.file);
		expect(await pnxImageFormat.detect(source, "CG01.PNX")).toBe(true);
		const archive = await pnxImageFormat.open(source, "CG01.PNX");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.png"]);
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x60,
				height: 0x30,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "png",
				encrypted: true,
				width: 0x60,
				height: 0x30,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// Only the first eight bytes differ, so the output is as long as the input.
			expect(output.length).toBe(built.file.length);
			expect(output.subarray(0, 8)).toEqual(PNG_SIGNATURE);
			expect(output.subarray(BODY_OFFSET)).toEqual(
				built.file.subarray(BODY_OFFSET),
			);
			expect(output.subarray(12, 16).toString("latin1")).toBe("IHDR");
		} finally {
			await archive.close();
		}
	});

	it("ignores the four bytes between the signature and the body", async () => {
		// The reference drops the whole first eight bytes, so those four are not inspected.
		const first = buildPnx(0x10, 0x10, 8, 6, 0x00);
		const second = buildPnx(0x10, 0x10, 8, 6, 0xff);
		for (const built of [first, second]) {
			expect(await pnxImageFormat.detect(sourceOf(built.file), "A.PNX")).toBe(
				true,
			);
			const archive = await pnxImageFormat.open(sourceOf(built.file), "A.PNX");
			try {
				const entry = archive.entries[0];
				if (!entry) throw new Error("missing entry");
				const output = await consumeBuffer(await archive.openEntry(entry.id));
				expect(output.subarray(0, 8)).toEqual(PNG_SIGNATURE);
			} finally {
				await archive.close();
			}
		}
	});

	it("derives the bit depth from the colour type", async () => {
		const rgb = buildPnx(0x20, 0x20, 8, 2);
		const archive = await pnxImageFormat.open(sourceOf(rgb.file), "B.PNX");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
	});

	it("declines a plain png", async () => {
		const built = buildPnx();
		built.file[3] = 0x47;
		expect(await pnxImageFormat.detect(sourceOf(built.file), "CG01.PNX")).toBe(
			false,
		);
	});

	it("declines a file whose first chunk is not the header", async () => {
		const built = buildPnx();
		built.file.write("IDAT", 12, "latin1");
		expect(await pnxImageFormat.detect(sourceOf(built.file), "CG01.PNX")).toBe(
			false,
		);
	});

	it("declines a zero dimension", async () => {
		const built = buildPnx();
		built.file.writeUInt32BE(0, 16);
		expect(await pnxImageFormat.detect(sourceOf(built.file), "CG01.PNX")).toBe(
			false,
		);
	});

	it("declines a file shorter than a header chunk", async () => {
		const built = buildPnx();
		expect(
			await pnxImageFormat.detect(
				sourceOf(built.file.subarray(0, MIN_SIZE - 1)),
				"CG01.PNX",
			),
		).toBe(false);
	});
});
