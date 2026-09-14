import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { silkyAkbImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { withCompanionFiles } from "../helpers/companion.js";

const HEADER_SIZE = 0x20;
const DEPTH_FLAG = 0x40000000;
const ALPHA_FLAG = 0x80000000;
const PIXEL_OFFSET_24 = 54;

/** Builds a literal only lzss stream: one control byte per eight literals, least significant bit first. */
function literalStream(data: Buffer): Buffer {
	const output: number[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const group = data.subarray(start, start + 8);
		let control = 0;
		const body: number[] = [];
		for (const [index, value] of group.entries()) {
			control |= 1 << index;
			body.push(value);
		}
		output.push(control, ...body);
	}
	return Buffer.from(output);
}

/**
 * The bytes a file stores for a top down overlay. Its rows arrive bottom up, the last one of them as a
 * difference from the pixel before each one, and every other as a difference from the row behind it.
 */
function encodeOverlay(imageRows: Buffer[], pixelSize: number): Buffer {
	const stream = [...imageRows].reverse();
	const stride = imageRows[0]?.length ?? 0;
	const stored = stream.map((row) => Buffer.from(row));
	for (let row = 0; row < stored.length - 1; row += 1) {
		const target = stored[row];
		const below = stream[row + 1];
		if (!target || !below) continue;
		for (let index = 0; index < stride; index += 1) {
			target[index] = ((target[index] ?? 0) - (below[index] ?? 0)) & 0xff;
		}
	}
	const last = stored[stored.length - 1];
	const lastRow = stream[stored.length - 1];
	if (last && lastRow) {
		for (let index = pixelSize; index < stride; index += 1) {
			last[index] =
				((last[index] ?? 0) - (lastRow[index - pixelSize] ?? 0)) & 0xff;
		}
	}
	return Buffer.concat(stored);
}

interface AkbOptions {
	width?: number;
	height?: number;
	depth?: number;
	incremental?: boolean;
	baseName?: string;
	offsetX?: number;
	offsetY?: number;
	innerWidth?: number;
	innerHeight?: number;
	background?: number[];
	alpha?: boolean;
	marker?: string;
	/** The overlay as the file stores it, before it is packed. */
	overlay?: Buffer;
	/** A body to store as it stands instead of packing the overlay. */
	body?: Buffer;
}

function buildAkb(options: AkbOptions = {}): Buffer {
	const width = options.width ?? 4;
	const height = options.height ?? 2;
	const depth = options.depth ?? 24;
	const offsetX = options.offsetX ?? 0;
	const offsetY = options.offsetY ?? 0;
	const innerWidth = options.innerWidth ?? width - offsetX;
	const innerHeight = options.innerHeight ?? height - offsetY;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(
		options.marker ?? (options.incremental ? "AKB+" : "AKB "),
		0,
		"latin1",
	);
	header.writeUInt16LE(width, 4);
	header.writeUInt16LE(height, 6);
	let flags = depth === 24 ? DEPTH_FLAG : 0;
	if (options.alpha) flags |= ALPHA_FLAG;
	header.writeUInt32LE(flags >>> 0, 8);
	for (const [index, value] of (options.background ?? [0, 0, 0, 0]).entries()) {
		header[0x0c + index] = value;
	}
	header.writeInt32LE(offsetX, 0x10);
	header.writeInt32LE(offsetY, 0x14);
	header.writeInt32LE(offsetX + innerWidth, 0x18);
	header.writeInt32LE(offsetY + innerHeight, 0x1c);
	const body =
		options.body ?? literalStream(options.overlay ?? Buffer.alloc(0));
	if (!options.incremental) return Buffer.concat([header, body]);
	const name: Buffer = Buffer.alloc(0x20, 0x00);
	name.write(options.baseName ?? "base", 0, "latin1");
	return Buffer.concat([header, name, body]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.akb"): Promise<Buffer> {
	const archive = await silkyAkbImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

async function extractFrom(path: string): Promise<Buffer> {
	const source = await FileByteSource.open(path);
	const archive = await silkyAkbImageFormat.open(source, path);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** One full size image of two rows, four pixels a row, three bytes a pixel. */
function twoRows(first = 1, second = 13): Buffer[] {
	const row0 = Buffer.from(
		Array.from({ length: 12 }, (_, index) => first + index),
	);
	const row1 = Buffer.from(
		Array.from({ length: 12 }, (_, index) => second + index),
	);
	return [row0, row1];
}

describe("AI6WIN image (AKB)", () => {
	it("declares both of its words and no extension", async () => {
		expect(silkyAkbImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("AKB ", "latin1") },
			{ bytes: Buffer.from("AKB+", "latin1") },
		]);
		expect(silkyAkbImageFormat.descriptor.extensions).toEqual([]);
		for (const incremental of [false, true]) {
			expect(
				await silkyAkbImageFormat.detect(
					sourceOf(
						buildAkb({
							incremental,
							overlay: encodeOverlay(twoRows(), 3),
						}),
					),
					"CG01.akb",
				),
			).toBe(true);
		}
		// An overlay that reaches outside its own image is not this format at all.
		expect(
			await silkyAkbImageFormat.detect(
				sourceOf(
					buildAkb({ width: 4, innerWidth: 5, overlay: Buffer.alloc(1) }),
				),
				"CG01.akb",
			),
		).toBe(false);
		expect(
			await silkyAkbImageFormat.detect(
				sourceOf(buildAkb({ marker: "AKBx", overlay: Buffer.alloc(1) })),
				"CG01.akb",
			),
		).toBe(false);
		expect(
			await silkyAkbImageFormat.detect(
				sourceOf(Buffer.alloc(0x10)),
				"CG01.akb",
			),
		).toBe(false);
	});

	it("reads its measurements, its offsets and its name field", async () => {
		const archive = await silkyAkbImageFormat.open(
			sourceOf(
				buildAkb({
					width: 4,
					height: 2,
					incremental: true,
					baseName: "bg.akb",
					offsetX: 1,
					offsetY: 1,
					innerWidth: 2,
					innerHeight: 1,
					background: [0x11, 0x22, 0x33, 0x44],
					alpha: true,
					overlay: encodeOverlay([Buffer.from([9, 9, 9, 8, 8, 8])], 3),
				}),
			),
			"CG01.akb",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 4,
				height: 2,
				bitsPerPixel: 24,
				background: [0x11, 0x22, 0x33, 0x44],
				offsetX: 1,
				offsetY: 1,
				innerWidth: 2,
				innerHeight: 1,
				baseFileName: "bg.akb",
				hasAlpha: true,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
			});
		} finally {
			await archive.close();
		}
	});

	it("turns the rows of a full size overlay the right way up", async () => {
		const rows = twoRows();
		const output = await extract(buildAkb({ overlay: encodeOverlay(rows, 3) }));
		expect(output.readUInt16LE(28)).toBe(24);
		// `ImageData.Create` with no flip, so a twenty four bit height stays negative.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 24)).toEqual(
			Buffer.concat(rows),
		);
	});

	it("unfolds a delta that runs the length of a row", async () => {
		// The stored row is entirely black, so every pixel comes from the ones before it.
		const overlay = Buffer.concat([
			Buffer.alloc(12, 0x00),
			Buffer.alloc(12, 0x00),
		]);
		const output = await extract(buildAkb({ overlay }));
		expect(output.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 24)).toEqual(
			Buffer.alloc(24, 0x00),
		);
		const increasing = encodeOverlay(
			[Buffer.from([1, 2, 3, 4, 5, 6]), Buffer.from([7, 8, 9, 10, 11, 12])],
			3,
		);
		const single = await extract(
			buildAkb({ width: 2, height: 2, overlay: increasing }),
		);
		// Two pixels of three bytes are six bytes a row, which a bitmap pads to eight.
		expect(single.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 6)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6]),
		);
		expect(single.subarray(PIXEL_OFFSET_24 + 8, PIXEL_OFFSET_24 + 14)).toEqual(
			Buffer.from([7, 8, 9, 10, 11, 12]),
		);
	});

	it("draws an overlay onto the colour its header names", async () => {
		const output = await extract(
			buildAkb({
				offsetX: 1,
				offsetY: 1,
				innerWidth: 2,
				innerHeight: 1,
				background: [0x11, 0x22, 0x33, 0x00],
				overlay: encodeOverlay(
					[Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])],
					3,
				),
			}),
		);
		const expected: Buffer = Buffer.alloc(24, 0x00);
		for (let at = 0; at < 24; at += 3) {
			expected[at] = 0x11;
			expected[at + 1] = 0x22;
			expected[at + 2] = 0x33;
		}
		// The overlay starts one row down and one pixel across.
		expected.set([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff], 12 + 3);
		expect(output.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 24)).toEqual(
			expected,
		);
	});

	it("lets the image behind an incremental overlay show through its green key", async () => {
		const base = buildAkb({ overlay: encodeOverlay(twoRows(0x40, 0x60), 3) });
		const overlayRows = [
			Buffer.from([1, 2, 3, 0x00, 0xff, 0x00, 4, 5, 6, 0x00, 0xff, 0x00]),
			Buffer.from([0x00, 0xff, 0x00, 7, 8, 9, 0x00, 0xff, 0x00, 10, 11, 12]),
		];
		const overlay = buildAkb({
			incremental: true,
			baseName: "base",
			overlay: encodeOverlay(overlayRows, 3),
		});
		await withCompanionFiles(
			"overlay.akb",
			{ "overlay.akb": overlay, "base.akb": base },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await silkyAkbImageFormat.detect(source, mainPath)).toBe(true);
				const output = await extractFrom(mainPath);
				const expected: Buffer = Buffer.alloc(24, 0x00);
				// The pixels of the base that the key leaves alone, in the row each one is in.
				for (const [at, base, local] of [
					[3, 0x40, 3],
					[9, 0x40, 9],
					[12, 0x60, 0],
					[18, 0x60, 6],
				] as const) {
					expected[at] = base + local;
					expected[at + 1] = base + local + 1;
					expected[at + 2] = base + local + 2;
				}
				for (const [at, value] of [
					[0, 1],
					[1, 2],
					[2, 3],
					[6, 4],
					[7, 5],
					[8, 6],
					[15, 7],
					[16, 8],
					[17, 9],
					[21, 10],
					[22, 11],
					[23, 12],
				] as const) {
					expected[at] = value;
				}
				expect(output.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 24)).toEqual(
					expected,
				);
			},
		);
	});

	it("stands on its own colour when no image of that name lies beside it", async () => {
		const overlay = buildAkb({
			incremental: true,
			// The name points at the overlay's own stem, which the search leaves out.
			baseName: "overlay",
			offsetX: 1,
			offsetY: 1,
			innerWidth: 2,
			innerHeight: 1,
			background: [0x90, 0x91, 0x92, 0x00],
			overlay: encodeOverlay(
				[Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff])],
				3,
			),
		});
		await withCompanionFiles(
			"overlay.akb",
			{ "overlay.akb": overlay },
			async (mainPath) => {
				const output = await extractFrom(mainPath);
				const expected: Buffer = Buffer.alloc(24, 0x00);
				for (let at = 0; at < 24; at += 3) {
					expected[at] = 0x90;
					expected[at + 1] = 0x91;
					expected[at + 2] = 0x92;
				}
				// An overlay with no image found underneath it is copied in whole, so its green pixels are drawn
				// as they stand rather than letting the colour behind them through.
				expected.set([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff], 12 + 3);
				expect(output.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 24)).toEqual(
					expected,
				);
			},
		);
	});

	it("passes over an image of the name that is not the same size", async () => {
		const other = buildAkb({
			width: 8,
			overlay: encodeOverlay(
				[Buffer.alloc(24, 0x55), Buffer.alloc(24, 0x66)],
				3,
			),
		});
		const overlay = buildAkb({
			incremental: true,
			baseName: "base",
			background: [0x90, 0x91, 0x92, 0x00],
			overlay: encodeOverlay(twoRows(1, 13), 3),
		});
		await withCompanionFiles(
			"overlay.akb",
			{ "overlay.akb": overlay, "base.akb": other },
			async (mainPath) => {
				const output = await extractFrom(mainPath);
				// Every pixel of the overlay is drawn, so the colour behind it is nowhere to be seen.
				expect(output.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 24)).toEqual(
					Buffer.concat(twoRows()),
				);
			},
		);
	});

	it("returns the image alone for an overlay with nothing in it", async () => {
		const output = await extract(
			buildAkb({
				innerWidth: 0,
				innerHeight: 0,
				background: [0x11, 0x22, 0x33, 0x00],
			}),
		);
		const expected: Buffer = Buffer.alloc(24, 0x00);
		for (let at = 0; at < 24; at += 3) {
			expected[at] = 0x11;
			expected[at + 1] = 0x22;
			expected[at + 2] = 0x33;
		}
		expect(output.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 24)).toEqual(
			expected,
		);
	});

	it("refuses a stream that runs out before the last row", async () => {
		const short = buildAkb({
			width: 4,
			height: 2,
			overlay: Buffer.alloc(12, 0x01),
		});
		await expect(extract(short)).rejects.toThrow(/too short/);
	});

	it("keeps a thirty two bit fourth byte and names the entry", async () => {
		const rows = [
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
			Buffer.from([9, 10, 11, 12, 13, 14, 15, 16]),
		];
		const output = await extract(
			buildAkb({
				width: 2,
				height: 2,
				depth: 32,
				alpha: true,
				overlay: encodeOverlay(rows, 4),
			}),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(PIXEL_OFFSET_24, PIXEL_OFFSET_24 + 16)).toEqual(
			Buffer.concat(rows),
		);
		const archive = await silkyAkbImageFormat.open(
			sourceOf(buildAkb({ overlay: encodeOverlay(twoRows(), 3) })),
			"sub/CG07.akb",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG07.bmp");
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
