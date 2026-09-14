import { BufferByteSource } from "@garbro-mcp/core";
import { silkyMfgImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x14;

interface MfgOptions {
	marker?: string;
	width?: number;
	height?: number;
	/** The bytes each row occupies; the depth is derived from this against the width. */
	stride?: number;
	/** Palette blocks, one per row: a count and that many eight byte entries. */
	rows?: Buffer[];
	pixels?: Buffer;
}

function buildMfg(options: MfgOptions = {}): Buffer {
	const width = options.width ?? 3;
	const height = options.height ?? 2;
	const stride = options.stride ?? width * 3;
	const pixels =
		options.pixels ??
		Buffer.from(
			Array.from(
				{ length: stride * height },
				(_, index) => (index * 7 + 3) & 0xff,
			),
		);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "MFG_", 0, "latin1");
	header.writeUInt32LE(pixels.length, 4);
	header.writeUInt32LE(width, 8);
	header.writeUInt32LE(height, 0xc);
	header.writeUInt32LE(stride, 0x10);
	return Buffer.concat([header, ...(options.rows ?? []), pixels]);
}

/** A palette block: a count, then that many eight byte entries. */
function paletteRow(entries: number): Buffer {
	const block: Buffer = Buffer.alloc(4 + entries * 8, 0x11);
	block.writeUInt32LE(entries, 0);
	return block;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.mfp"): Promise<Buffer> {
	const archive = await silkyMfgImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Silky's RGB image", () => {
	it("takes all three flavours of the marker and nothing else", async () => {
		for (const marker of ["MFG_", "MFGA", "MFGC"]) {
			expect(
				await silkyMfgImageFormat.detect(
					sourceOf(buildMfg({ marker })),
					"A.mfp",
				),
			).toBe(true);
		}
		expect(
			await silkyMfgImageFormat.detect(
				sourceOf(buildMfg({ marker: "MFGX" })),
				"A.mfp",
			),
		).toBe(false);
		expect(
			await silkyMfgImageFormat.detect(
				sourceOf(Buffer.from("MFG_", "latin1")),
				"A.mfp",
			),
		).toBe(false);
	});

	it("needs a length that matches the rows and a stride no narrower than the row", async () => {
		// A length that does not match is how the reference returns no metadata at all.
		const mismatched = buildMfg({ width: 3, height: 2 });
		mismatched.writeUInt32LE(6, 4);
		expect(
			await silkyMfgImageFormat.detect(sourceOf(mismatched), "A.mfp"),
		).toBe(false);
		// A stride below the width is what the reference rejects outright.
		const narrow = buildMfg({ width: 8, height: 2, stride: 4 });
		expect(await silkyMfgImageFormat.detect(sourceOf(narrow), "A.mfp")).toBe(
			false,
		);
		// No width or height is not an image either.
		expect(
			await silkyMfgImageFormat.detect(
				sourceOf(buildMfg({ width: 0, height: 2 })),
				"A.mfp",
			),
		).toBe(false);
	});

	it("derives the depth from the stride and the width", async () => {
		const archive = await silkyMfgImageFormat.open(
			sourceOf(buildMfg({ width: 5, height: 2, stride: 15 })),
			"A.mfp",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 5,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(silkyMfgImageFormat.descriptor.extensions).toEqual(["mfp"]);
		} finally {
			await archive.close();
		}
		// A stride of eight for five pixels divides out to twelve bits, which the reference reports as is.
		const odd = await silkyMfgImageFormat.open(
			sourceOf(buildMfg({ width: 5, height: 2, stride: 8 })),
			"A.mfp",
		);
		try {
			expect(odd.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 12 });
		} finally {
			await odd.close();
		}
	});

	it("hands a twenty four bit image over top down and tight", async () => {
		const pixels = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18,
		]);
		const output = await extract(buildMfg({ width: 3, height: 2, pixels }));
		expect(output.readUInt16LE(28)).toBe(24);
		// The reference never flips, so the height stays negative.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(54, 66)).toEqual(
			Buffer.concat([
				Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]),
				Buffer.alloc(3),
			]),
		);
		expect(output.subarray(66, 78)).toEqual(
			Buffer.concat([
				Buffer.from([10, 11, 12, 13, 14, 15, 16, 17, 18]),
				Buffer.alloc(3),
			]),
		);
	});

	it("hands a thirty two bit image over as one", async () => {
		const pixels = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
		const output = await extract(
			buildMfg({ width: 2, height: 2, stride: 8, pixels }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		// Each pixel keeps all four of its bytes, alpha included.
		expect(output.subarray(54, 62)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
		);
	});

	it("skips the palette block every other flavour carries per row", async () => {
		const pixels = Buffer.from([
			9, 8, 7, 6, 5, 4, 3, 2, 1, 18, 17, 16, 15, 14, 13, 12, 11, 10,
		]);
		for (const marker of ["MFGA", "MFGC"]) {
			// Two rows, each with a different number of entries.
			const file = buildMfg({
				marker,
				width: 3,
				height: 2,
				rows: [paletteRow(2), paletteRow(5)],
				pixels,
			});
			const output = await extract(file);
			expect(output.readUInt16LE(28)).toBe(24);
			expect(output.subarray(54, 66)).toEqual(
				Buffer.concat([
					Buffer.from([9, 8, 7, 6, 5, 4, 3, 2, 1]),
					Buffer.alloc(3),
				]),
			);
			expect(output.subarray(66, 78)).toEqual(
				Buffer.concat([
					Buffer.from([18, 17, 16, 15, 14, 13, 12, 11, 10]),
					Buffer.alloc(3),
				]),
			);
		}
	});

	it("pads a row that is narrower than the depth it chose", async () => {
		// Five pixels at eight bits a row derive a depth of twelve, so the reference's choice of a thirty two
		// bit image cannot be filled by the row: the port pads the rest with zeroes.
		const pixels = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
		const output = await extract(
			buildMfg({ width: 5, height: 2, stride: 8, pixels }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(54, 74)).toEqual(
			Buffer.concat([Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]), Buffer.alloc(12)]),
		);
	});

	it("refuses a body that stops short", async () => {
		const file = buildMfg({ width: 3, height: 2 });
		await expect(extract(file.subarray(0, file.length - 4))).rejects.toThrow();
		// A palette block that runs past the end fails the same way.
		const short = buildMfg({
			marker: "MFGA",
			width: 3,
			height: 2,
			rows: [paletteRow(4)],
		});
		await expect(extract(short)).rejects.toThrow();
	});

	it("names the entry after the image", async () => {
		const archive = await silkyMfgImageFormat.open(
			sourceOf(buildMfg({ width: 3, height: 2 })),
			"sub/CG_07.mfp",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
