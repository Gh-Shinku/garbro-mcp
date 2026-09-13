import { BufferByteSource } from "@garbro-mcp/core";
import { sfgImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const PALETTE_ENTRIES = 0x100;
const PALETTE_BYTES = PALETTE_ENTRIES * 4;
const BMP_HEADER_SIZE = 54;

/** One plane is eight bit indexed with a kilobyte of palette; four planes are thirty two bit. */
function buildSfg(options: {
	planes?: number;
	width: number;
	height: number;
	pixels?: Buffer;
	/** Appends or removes bytes to prove the length check is exact. */
	pad?: number;
}): Buffer {
	const { planes = 4, width, height } = options;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeUInt16LE(planes, 0);
	header.writeUInt16LE(width, 2);
	header.writeUInt16LE(height, 4);
	const parts: Buffer[] = [header];
	if (planes === 1) {
		// Entry n holds n, n+1, n+2 and n+3, in the blue-green-red-alpha order the format stores.
		const palette: Buffer = Buffer.alloc(PALETTE_BYTES, 0x00);
		for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
			palette[index * 4] = index;
			palette[index * 4 + 1] = (index + 1) & 0xff;
			palette[index * 4 + 2] = (index + 2) & 0xff;
			palette[index * 4 + 3] = (index + 3) & 0xff;
		}
		parts.push(palette);
	}
	parts.push(options.pixels ?? Buffer.alloc(width * height * planes, 0x00));
	const file = Buffer.concat(parts);
	return options.pad
		? Buffer.concat([file, Buffer.alloc(options.pad, 0xaa)])
		: file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "IMAGE.SFG"): Promise<Buffer> {
	const archive = await sfgImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("alpha system sfg image", () => {
	it("has no signature, so the length is the gate", () => {
		expect(sfgImageFormat.detection?.signatures).toEqual([]);
		expect(sfgImageFormat.descriptor.extensions).toEqual([]);
	});

	it("accepts only the two plane counts and non-zero dimensions", async () => {
		for (const planes of [0, 2, 3, 5, 8, 0xffff]) {
			expect(
				await sfgImageFormat.detect(
					sourceOf(buildSfg({ planes, width: 2, height: 2 })),
					"A.SFG",
				),
			).toBe(false);
		}
		expect(
			await sfgImageFormat.detect(
				sourceOf(buildSfg({ planes: 1, width: 0, height: 2 })),
				"A.SFG",
			),
		).toBe(false);
		expect(
			await sfgImageFormat.detect(
				sourceOf(buildSfg({ planes: 1, width: 2, height: 0 })),
				"A.SFG",
			),
		).toBe(false);
		expect(
			await sfgImageFormat.detect(
				sourceOf(buildSfg({ width: 2, height: 2 })),
				"A.SFG",
			),
		).toBe(true);
	});

	it("requires the length to match exactly, palette included", async () => {
		// The same bytes are declined once anything is appended, which is how a file with no signature is
		// identified at all.
		for (const planes of [1, 4]) {
			const file = buildSfg({ planes, width: 2, height: 2 });
			expect(await sfgImageFormat.detect(sourceOf(file), "A.SFG")).toBe(true);
			expect(
				await sfgImageFormat.detect(
					sourceOf(file.subarray(0, file.length - 1)),
					"A.SFG",
				),
			).toBe(false);
			expect(
				await sfgImageFormat.detect(
					sourceOf(buildSfg({ planes, width: 2, height: 2, pad: 1 })),
					"A.SFG",
				),
			).toBe(false);
		}
	});

	it("carries a one plane image through as eight bit indexed", async () => {
		// Three pixels a row is three bytes, which a bitmap pads out to four.
		const pixels = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		const file = buildSfg({ planes: 1, width: 3, height: 2, pixels });
		const source = sourceOf(file);
		const archive = await sfgImageFormat.open(source, "IMAGE.SFG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["IMAGE.bmp"]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(8);
		// `ImageData.Create` is top down, so the height is negative.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.readUInt32LE(46)).toBe(PALETTE_ENTRIES);
		// Blue-green-red-alpha is what a bitmap palette wants, so entry n arrives as n, n+1, n+2, n+3.
		expect(output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 8)).toEqual(
			Buffer.from([0x00, 0x01, 0x02, 0x03, 0x01, 0x02, 0x03, 0x04]),
		);
		expect(output.subarray(BMP_HEADER_SIZE + PALETTE_BYTES)).toEqual(
			Buffer.from([0x01, 0x02, 0x03, 0x00, 0x04, 0x05, 0x06, 0x00]),
		);
	});

	it("carries a four plane image through as thirty two bit", async () => {
		const pixels = Buffer.from([
			0x11, 0x12, 0x13, 0x14, 0x21, 0x22, 0x23, 0x24, 0x31, 0x32, 0x33, 0x34,
			0x41, 0x42, 0x43, 0x44,
		]);
		const file = buildSfg({ width: 2, height: 2, pixels });
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.readInt32LE(22)).toBe(-2);
		// Four bytes a pixel need no padding at any width, so the pixels are copied verbatim.
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
		expect(output.length).toBe(BMP_HEADER_SIZE + pixels.length);
	});

	it("reads a pixel block that the length check has already sized", async () => {
		// The equality guarantees the reads are complete, so a short stream cannot occur and there is nothing
		// to tolerate. A file that is one byte short is simply not recognised, which the earlier test covers.
		const file = buildSfg({ width: 1, height: 1 });
		expect(await sfgImageFormat.detect(sourceOf(file), "A.SFG")).toBe(true);
		expect((await extract(file)).length).toBe(BMP_HEADER_SIZE + 4);
	});
});
