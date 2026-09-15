import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { powerdNclImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	writeBmp8Palette,
	writeBmp24,
} from "../../packages/formats/src/shared/bmp.js";

/** The header the reference reads, and where the bitmap behind it begins. */
const HEADER_SIZE = 0x20;
const DATA_OFFSET = 0x24;
const MARKER = 0x010100;

interface PowerdOptions {
	width?: number;
	height?: number;
	marker?: number;
	/** The bitmap behind the header, which is a twenty four bit one unless the caller says otherwise. */
	base?: Buffer;
	/** A bitmap behind that one, which carries the alpha channel. */
	alpha?: Buffer;
}

/** One colour map as a bitmap stores it: blue, green, red, unused, one grey to an index. */
function greyEntries(): Buffer {
	const entries: Buffer = Buffer.alloc(256 * 4);
	for (let i = 0; i < 256; i += 1) {
		entries[i * 4] = i;
		entries[i * 4 + 1] = i;
		entries[i * 4 + 2] = i;
	}
	return entries;
}

function buildPowerdFile(options: PowerdOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	// The bitmap stands at the twenty fourth byte, four behind the twenty the header takes up.
	const header: Buffer = Buffer.alloc(DATA_OFFSET, 0x00);
	header.write("CELL", 0, "latin1");
	header.writeUInt32LE(options.marker ?? MARKER, 4);
	header.writeUInt32LE(width, 0x18);
	header.writeUInt32LE(height, 0x1c);
	const base =
		options.base ??
		writeBmp24(
			width,
			height,
			Buffer.from([1, 2, 3, 4, 5, 6, 11, 12, 13, 14, 15, 16]),
		);
	return Buffer.concat([header, base, options.alpha ?? Buffer.alloc(0)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.ncl"): Promise<Buffer> {
	const archive = await powerdNclImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Powerd NCL image", () => {
	it("finds its pictures by their word", async () => {
		const file = buildPowerdFile();
		expect(await powerdNclImageFormat.detect(sourceOf(file))).toBe(true);
		// The word at the fourth byte is half of what makes a picture of this engine.
		expect(
			await powerdNclImageFormat.detect(
				sourceOf(buildPowerdFile({ marker: 0 })),
			),
		).toBe(false);
		expect(
			await powerdNclImageFormat.detect(
				sourceOf(Buffer.from("CELL", "latin1")),
			),
		).toBe(false);
		expect(
			await powerdNclImageFormat.detect(
				sourceOf(buildPowerdFile().fill(0x00, 0, 4)),
			),
		).toBe(false);
		expect(
			await powerdNclImageFormat.detect(sourceOf(Buffer.alloc(HEADER_SIZE))),
		).toBe(false);
	});

	it("hands back the bitmap behind the header", async () => {
		const file = buildPowerdFile();
		const archive = await powerdNclImageFormat.open(sourceOf(file), "CG01.ncl");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(24);
		expect(bmp.readInt32LE(18)).toBe(2);
		expect(bmp.readInt32LE(22)).toBe(-2);
		// Two pixels to a row are six bytes, which a bitmap pads out to eight.
		expect(bmp.subarray(54, 54 + 6)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
		expect(bmp.subarray(54 + 8, 54 + 8 + 6)).toEqual(
			Buffer.from([11, 12, 13, 14, 15, 16]),
		);
	});

	it("lays the second bitmap over the first as its alpha channel", async () => {
		// An eight bit picture of its own colour map, with a grey bitmap of the same size behind it.
		const entries: Buffer = Buffer.alloc(256 * 4);
		entries[1 * 4] = 0x10;
		entries[1 * 4 + 1] = 0x20;
		entries[1 * 4 + 2] = 0x30;
		const base = writeBmp8Palette(2, 1, Buffer.from([1, 0]), entries);
		const alpha = writeBmp8Palette(
			2,
			1,
			Buffer.from([0x40, 0xff]),
			greyEntries(),
		);
		const bmp = await extract(
			buildPowerdFile({ width: 2, height: 1, base, alpha }),
		);
		expect(bmp.readUInt16LE(28)).toBe(32);
		expect(bmp.readInt32LE(22)).toBe(-1);
		// The indexed pixel is taken through its colour map and the alpha written after it.
		expect(bmp.subarray(54, 54 + 8)).toEqual(
			Buffer.from([0x10, 0x20, 0x30, 0x40, 0x00, 0x00, 0x00, 0xff]),
		);
	});

	it("hands back the first bitmap when what follows is not one", async () => {
		const base = writeBmp24(1, 1, Buffer.from([7, 8, 9]));
		const bmp = await extract(
			buildPowerdFile({
				width: 1,
				height: 1,
				base,
				alpha: Buffer.from("not a bitmap at all", "latin1"),
			}),
		);
		expect(bmp.readUInt16LE(28)).toBe(24);
		expect(bmp.subarray(54, 57)).toEqual(Buffer.from([7, 8, 9]));
	});

	it("refuses an alpha channel that covers too few pixels", async () => {
		const file = buildPowerdFile({
			width: 2,
			height: 2,
			alpha: writeBmp8Palette(1, 1, Buffer.from([1]), greyEntries()),
		});
		await expect(extract(file)).rejects.toThrow(GarbroError);
		await expect(extract(file)).rejects.toThrow(
			"Powerd NCL image alpha covers too few pixels",
		);
	});

	it("refuses an alpha channel it cannot read as grey", async () => {
		const file = buildPowerdFile({
			width: 1,
			height: 1,
			alpha: writeBmp24(1, 1, Buffer.from([1, 2, 3])),
		});
		await expect(extract(file)).rejects.toThrow(GarbroError);
		await expect(extract(file)).rejects.toThrow(
			"Unsupported Powerd NCL alpha of 24 bits",
		);
	});

	it("refuses a header with no bitmap behind it", async () => {
		const file = buildPowerdFile();
		const header = Buffer.from(file.subarray(0, DATA_OFFSET));
		await expect(extract(header, "CG01.ncl")).rejects.toThrow(
			"Powerd NCL image has no bitmap",
		);
		await expect(
			extract(Buffer.concat([header, Buffer.alloc(0x20, 0x00)]), "CG01.ncl"),
		).rejects.toThrow("Powerd NCL image has no bitmap");
	});
});
