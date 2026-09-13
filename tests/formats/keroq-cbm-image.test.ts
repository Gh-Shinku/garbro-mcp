import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { keroqCbmImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { withCompanionFiles } from "../helpers/companion.js";

const HEADER_SIZE = 0x10;
const PALETTE_ENTRIES = 0x100;
const PALETTE_PAGE = PALETTE_ENTRIES * 4;
const PIXEL_OFFSET = 54 + PALETTE_PAGE;

interface CbmOptions {
	width?: number;
	height?: number;
	pixels?: number[];
	/** Added to the length the header claims, so a mismatch can be written on purpose. */
	lengthDelta?: number;
	marker?: string;
}

function buildCbm(options: CbmOptions = {}): Buffer {
	const width = options.width ?? 3;
	const height = options.height ?? 2;
	const body: Buffer = Buffer.from(
		options.pixels ??
			Array.from({ length: width * height }, (_, index) => index & 0xff),
	);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "CBM", 0, "latin1");
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	header.writeUInt32LE(body.length + (options.lengthDelta ?? 0), 0x0c);
	return Buffer.concat([header, body]);
}

/** A palette file: blue, green, red triples, one per index. */
function buildPalette(entries = PALETTE_ENTRIES): Buffer {
	const palette: Buffer = Buffer.alloc(entries * 3, 0x00);
	for (let index = 0; index < entries; index += 1) {
		palette[index * 3] = index;
		palette[index * 3 + 1] = 0xff - index;
		palette[index * 3 + 2] = 0x40;
	}
	return palette;
}

async function extractFrom(mainPath: string): Promise<Buffer> {
	const source = await FileByteSource.open(mainPath);
	const archive = await keroqCbmImageFormat.open(source, mainPath);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The ramp a grey bitmap carries, which is what the reader falls back to. */
function greyRamp(): Buffer {
	const page: Buffer = Buffer.alloc(PALETTE_PAGE, 0x00);
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		page[index * 4] = index;
		page[index * 4 + 1] = index;
		page[index * 4 + 2] = index;
	}
	return page;
}

describe("KeroQ bitmap", () => {
	it("insists the header's length word matches the file", async () => {
		const file = buildCbm();
		const source = new BufferByteSource(file);
		expect(await keroqCbmImageFormat.detect(source, "A.cbm")).toBe(true);
		// One byte more or less than the file holds and the reader will not have it.
		for (const delta of [1, -1]) {
			const off = buildCbm({ lengthDelta: delta });
			expect(
				await keroqCbmImageFormat.detect(new BufferByteSource(off), "A.cbm"),
			).toBe(false);
		}
		expect(
			await keroqCbmImageFormat.detect(
				new BufferByteSource(buildCbm({ marker: "CBN" })),
				"A.cbm",
			),
		).toBe(false);
		expect(
			await keroqCbmImageFormat.detect(
				new BufferByteSource(Buffer.from("CBM", "latin1")),
				"A.cbm",
			),
		).toBe(false);
	});

	it("describes an eight bit image", async () => {
		const file = buildCbm({ width: 5, height: 4 });
		const source = new BufferByteSource(file);
		const archive = await keroqCbmImageFormat.open(source, "A.cbm");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 5,
				height: 4,
				bitsPerPixel: 8,
			});
			expect(archive.entries[0]?.sizeKnown).toBe(true);
		} finally {
			await archive.close();
		}
	});

	it("falls back to a grey ramp when no palette is beside it", async () => {
		const file = buildCbm({ width: 3, height: 2, pixels: [1, 2, 3, 4, 5, 6] });
		await withCompanionFiles("CG.cbm", { "CG.cbm": file }, async (mainPath) => {
			const output = await extractFrom(mainPath);
			expect(output.readUInt16LE(28)).toBe(8);
			expect(output.subarray(54, 54 + PALETTE_PAGE)).toEqual(greyRamp());
			// A bitmap pads each row to four bytes, so the two rows sit four bytes apart.
			expect(output.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 3)).toEqual(
				Buffer.from([1, 2, 3]),
			);
			expect(output.subarray(PIXEL_OFFSET + 4, PIXEL_OFFSET + 7)).toEqual(
				Buffer.from([4, 5, 6]),
			);
		});
	});

	it("uses a palette beside the image", async () => {
		const file = buildCbm({ width: 2, height: 1, pixels: [0, 1] });
		const palette = buildPalette();
		await withCompanionFiles(
			"CG.cbm",
			{ "CG.cbm": file, "CG.pal": palette },
			async (mainPath) => {
				const output = await extractFrom(mainPath);
				// The palette page's entries are blue, green, red and an unused byte.
				expect(output.subarray(54, 62)).toEqual(
					Buffer.from([0x00, 0xff, 0x40, 0x00, 0x01, 0xfe, 0x40, 0x00]),
				);
				expect(
					output.subarray(54 + (PALETTE_ENTRIES - 1) * 4, 54 + PALETTE_PAGE),
				).toEqual(Buffer.from([0xff, 0x00, 0x40, 0x00]));
			},
		);
	});

	it("shortens its own name for the last candidates", async () => {
		const file = buildCbm({ width: 2, height: 1 });
		const palette = buildPalette();
		// The reference cuts the base name to three characters and keeps using the cut name, so a long
		// name looks for `CG__1.pal` rather than `CG_01_1.pal`.
		await withCompanionFiles(
			"CG_01.cbm",
			{ "CG_01.cbm": file, "CG__1.pal": palette },
			async (mainPath) => {
				const output = await extractFrom(mainPath);
				expect(output.subarray(54, 58)).toEqual(
					Buffer.from([0x00, 0xff, 0x40, 0x00]),
				);
			},
		);
	});

	it("prefers the palette named after the whole image", async () => {
		const file = buildCbm({ width: 2, height: 1 });
		const whole: Buffer = Buffer.alloc(PALETTE_ENTRIES * 3, 0x11);
		const shortened: Buffer = Buffer.alloc(PALETTE_ENTRIES * 3, 0x22);
		await withCompanionFiles(
			"CG_01.cbm",
			{ "CG_01.cbm": file, "CG_01.pal": whole, "CG_.pal": shortened },
			async (mainPath) => {
				const output = await extractFrom(mainPath);
				expect(output.subarray(54, 58)).toEqual(
					Buffer.from([0x11, 0x11, 0x11, 0x00]),
				);
			},
		);
	});

	it("stops at a palette file it cannot use", async () => {
		const file = buildCbm({ width: 2, height: 1 });
		// A palette that is a page short leaves the image grey: the reference swallows the failure and
		// still stops looking.
		await withCompanionFiles(
			"CG.cbm",
			{ "CG.cbm": file, "CG.pal": Buffer.alloc(PALETTE_ENTRIES * 3 - 1, 0x33) },
			async (mainPath) => {
				const output = await extractFrom(mainPath);
				expect(output.subarray(54, 54 + PALETTE_PAGE)).toEqual(greyRamp());
			},
		);
	});

	it("refuses a file that ends inside its pixels", async () => {
		const file = buildCbm({ width: 4, height: 4 }).subarray(
			0,
			HEADER_SIZE + 10,
		);
		await withCompanionFiles("CG.cbm", { "CG.cbm": file }, async (mainPath) => {
			await expect(extractFrom(mainPath)).rejects.toThrow();
		});
	});

	it("names the entry after the bitmap", async () => {
		const file = buildCbm();
		const source = new BufferByteSource(file);
		const archive = await keroqCbmImageFormat.open(source, "sub/CG_07.cbm");
		try {
			expect(archive.entries[0]?.path).toBe("CG_07.bmp");
		} finally {
			await archive.close();
		}
	});
});
