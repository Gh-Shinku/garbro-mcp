import { BufferByteSource } from "@garbro-mcp/core";
import { interheartHmpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const PIXEL_OFFSET = 54 + 0x100 * 4;

function buildHmp(options: {
	width: number;
	height: number;
	pixels?: Buffer;
	tail?: number;
}): Buffer {
	const pixels =
		options.pixels ??
		Buffer.from(
			Array.from(
				{ length: options.width * options.height },
				(_, index) => index & 0xff,
			),
		);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeUInt32LE(options.width, 0);
	header.writeUInt32LE(options.height, 4);
	return Buffer.concat([header, pixels, Buffer.alloc(options.tail ?? 0, 0x5a)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

/** The palette entry at an index, four bytes of it. */
function entry(output: Buffer, index: number): Buffer {
	return output.subarray(54 + index * 4, 54 + index * 4 + 4);
}

async function extract(file: Buffer, name = "CG01.hmp"): Promise<Buffer> {
	const archive = await interheartHmpImageFormat.open(sourceOf(file), name);
	try {
		const entryRow = archive.entries[0];
		if (!entryRow) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entryRow.id));
	} finally {
		await archive.close();
	}
}

describe("Interheart hover map", () => {
	it("is reached by its extension alone", async () => {
		expect(interheartHmpImageFormat.detection?.signatures).toEqual([]);
		expect(interheartHmpImageFormat.descriptor.extensions).toEqual(["hmp"]);
		const stored = buildHmp({ width: 2, height: 2 });
		expect(
			await interheartHmpImageFormat.detect(sourceOf(stored), "CG01.hmp"),
		).toBe(true);
		// The same bytes under another name are not a hover map.
		expect(
			await interheartHmpImageFormat.detect(sourceOf(stored), "CG01.hmt"),
		).toBe(false);
		expect(
			await interheartHmpImageFormat.detect(sourceOf(stored), "CG01"),
		).toBe(false);
	});

	it("needs two dimensions within its limits", async () => {
		expect(
			await interheartHmpImageFormat.detect(
				sourceOf(buildHmp({ width: 0, height: 2 })),
				"A.hmp",
			),
		).toBe(false);
		expect(
			await interheartHmpImageFormat.detect(
				sourceOf(buildHmp({ width: 2, height: 0x8000 })),
				"A.hmp",
			),
		).toBe(false);
		expect(
			await interheartHmpImageFormat.detect(
				sourceOf(buildHmp({ width: 2, height: 2 }).subarray(0, 7)),
				"A.hmp",
			),
		).toBe(false);
	});

	it("describes an eight bit image and its extension", async () => {
		const archive = await interheartHmpImageFormat.open(
			sourceOf(buildHmp({ width: 4, height: 3 })),
			"CG01.hmp",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 4,
				height: 3,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
	});

	it("hands the pixels over top down and tight", async () => {
		const pixels = Buffer.from([0, 1, 2, 3, 0xff, 0x40]);
		const output = await extract(buildHmp({ width: 3, height: 2, pixels }));
		expect(output.readUInt16LE(28)).toBe(8);
		// The reference never flips this image, so the height stays negative.
		expect(output.readInt32LE(22)).toBe(-2);
		// Three bytes a row are padded to four.
		expect(output.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 4)).toEqual(
			Buffer.from([0, 1, 2, 0]),
		);
		expect(output.subarray(PIXEL_OFFSET + 4, PIXEL_OFFSET + 8)).toEqual(
			Buffer.from([3, 0xff, 0x40, 0x00]),
		);
	});

	it("carries the reference's own default palette", async () => {
		const output = await extract(buildHmp({ width: 2, height: 1 }));
		// The first eight entries are the dark set, written in the reference's red-green-blue order.
		expect(entry(output, 0)).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x00]));
		expect(entry(output, 1)).toEqual(Buffer.from([0x7f, 0x00, 0x00, 0x00]));
		expect(entry(output, 4)).toEqual(Buffer.from([0x00, 0x00, 0x7f, 0x00]));
		expect(entry(output, 7)).toEqual(Buffer.from([0x7f, 0x7f, 0x7f, 0x00]));
		// Then the sixteen bright ones.
		expect(entry(output, 8)).toEqual(Buffer.from([0xff, 0x00, 0x00, 0x00]));
		expect(entry(output, 14)).toEqual(Buffer.from([0xff, 0xff, 0xff, 0x00]));
		expect(entry(output, 15)).toEqual(Buffer.from([0x7f, 0x00, 0xff, 0x00]));
		// Index sixteen is assigned twice in the reference, so the second value stands.
		expect(entry(output, 16)).toEqual(Buffer.from([0x7f, 0x7f, 0xff, 0x00]));
		expect(entry(output, 17)).toEqual(Buffer.from([0xff, 0x00, 0x7f, 0x00]));
		expect(entry(output, 18)).toEqual(Buffer.from([0x7f, 0xff, 0xff, 0x00]));
		// The grey ramp the bright colours were written over therefore starts at nineteen.
		expect(entry(output, 19)).toEqual(Buffer.from([19, 19, 19, 0x00]));
		expect(entry(output, 255)).toEqual(Buffer.from([0xff, 0xff, 0xff, 0x00]));
	});

	it("reads its pixels from offset eight and refuses a short body", async () => {
		const withTail = buildHmp({ width: 2, height: 2, tail: 9 });
		const output = await extract(withTail);
		// Two bytes a row are padded to four as well.
		expect(output.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 4)).toEqual(
			Buffer.from([0, 1, 0, 0]),
		);
		const short = buildHmp({ width: 4, height: 4 }).subarray(
			0,
			HEADER_SIZE + 8,
		);
		await expect(extract(short)).rejects.toThrow();
	});

	it("names the entry after the image", async () => {
		const archive = await interheartHmpImageFormat.open(
			sourceOf(buildHmp({ width: 2, height: 2 })),
			"sub/CG07.HMP",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
