import { FileByteSource } from "@garbro-mcp/core";
import { wbmImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { withCompanionFiles } from "../helpers/companion.js";

const SIGNATURE = Buffer.from([0x21, 0x57, 0x42, 0x4d]);
const HEADER_SIZE = 12;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;

const WIDTH = 3;
const HEIGHT = 2;
const STRIDE = 4;

function buildPixels(width = WIDTH, height = HEIGHT): Buffer {
	const pixels: Buffer = Buffer.alloc(width * height);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 31 + 7) & 0xff;
	return pixels;
}

function buildWbm(
	options: {
		width?: number;
		height?: number;
		pixels?: Buffer;
		tail?: number;
	} = {},
): Buffer {
	const width = options.width ?? WIDTH;
	const height = options.height ?? HEIGHT;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt16LE(width, 4);
	header.writeUInt16LE(height, 6);
	return Buffer.concat([
		header,
		options.pixels ?? buildPixels(width, height),
		Buffer.alloc(options.tail ?? 0, 0x5a),
	]);
}

/** An `act` palette is three bytes an entry: red, green, blue. */
function buildAct(): Buffer {
	const act: Buffer = Buffer.alloc(768);
	for (let i = 0; i < 256; i += 1) {
		act[i * 3] = (i * 5) & 0xff;
		act[i * 3 + 1] = (i * 7) & 0xff;
		act[i * 3 + 2] = (i * 11) & 0xff;
	}
	return act;
}

async function extract(mainPath: string): Promise<Buffer> {
	const source = await FileByteSource.open(mainPath);
	const archive = await wbmImageFormat.open(source, mainPath);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("hypatia wbm image", () => {
	it("declares the !WBM signature and two extensions", () => {
		expect(wbmImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("!WBM");
		expect(wbmImageFormat.descriptor.extensions).toEqual(["wbm", "dat"]);
	});

	it("writes a gray bitmap when there is no palette file", async () => {
		const pixels = buildPixels();
		await withCompanionFiles(
			"CG01.wbm",
			{ "CG01.wbm": buildWbm() },
			async (main) => {
				const source = await FileByteSource.open(main);
				expect(await wbmImageFormat.detect(source, main)).toBe(true);
				const archive = await wbmImageFormat.open(source, main);
				try {
					expect(archive.entries.map((entry) => entry.path)).toEqual([
						"CG01.bmp",
					]);
					expect(archive.metadata).toMatchObject({
						image: "bmp",
						width: WIDTH,
						height: HEIGHT,
						bitsPerPixel: 8,
						palette: "grey",
					});
				} finally {
					await archive.close();
				}
				const output = await extract(main);
				expect(output.readUInt16LE(28)).toBe(8);
				expect(output.readInt32LE(22)).toBe(-HEIGHT);
				expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE + PALETTE_SIZE);
				// The default palette is the grey ramp `writeBmp8` writes.
				for (const index of [0, 1, 200, 255]) {
					const at = BMP_HEADER_SIZE + index * 4;
					expect(output.subarray(at, at + 3)).toEqual(
						Buffer.from([index, index, index]),
					);
				}
				const body = output.subarray(BMP_HEADER_SIZE + PALETTE_SIZE);
				for (let row = 0; row < HEIGHT; row += 1) {
					expect(body.subarray(row * STRIDE, row * STRIDE + WIDTH)).toEqual(
						pixels.subarray(row * WIDTH, (row + 1) * WIDTH),
					);
					expect(
						body.subarray(row * STRIDE + WIDTH, (row + 1) * STRIDE),
					).toEqual(Buffer.alloc(STRIDE - WIDTH));
				}
			},
		);
	});

	it("converts a companion act palette from rgb to bgrx", async () => {
		const act = buildAct();
		await withCompanionFiles(
			"CG01.wbm",
			{ "CG01.wbm": buildWbm(), "data.act": act },
			async (main) => {
				const archive = await (async () => {
					const source = await FileByteSource.open(main);
					return wbmImageFormat.open(source, main);
				})();
				try {
					expect(archive.metadata).toMatchObject({ palette: "data.act" });
				} finally {
					await archive.close();
				}
				const output = await extract(main);
				// Entry one is stored red 5, green 7, blue 11 and reaches the bitmap as blue, green, red, zero.
				expect(
					output.subarray(BMP_HEADER_SIZE + 4, BMP_HEADER_SIZE + 8),
				).toEqual(Buffer.from([11, 7, 5, 0]));
				// The last entry, to show the whole table was converted.
				const last = BMP_HEADER_SIZE + 255 * 4;
				expect(output[last]).toBe(act[255 * 3 + 2]);
				expect(output[last + 1]).toBe(act[255 * 3 + 1]);
				expect(output[last + 2]).toBe(act[255 * 3]);
			},
		);
	});

	it("fails to extract a palette file that is too short", async () => {
		await withCompanionFiles(
			"CG01.wbm",
			{ "CG01.wbm": buildWbm(), "data.act": Buffer.alloc(64, 0x11) },
			async (main) => {
				const source = await FileByteSource.open(main);
				// Detection and listing do not depend on the companion file.
				expect(await wbmImageFormat.detect(source, main)).toBe(true);
				const archive = await wbmImageFormat.open(source, main);
				try {
					const entry = archive.entries[0];
					if (!entry) throw new Error("missing entry");
					await expect(archive.openEntry(entry.id)).rejects.toThrow();
				} finally {
					await archive.close();
				}
			},
		);
	});

	it("lists a short image but fails to extract it", async () => {
		const full = buildWbm();
		const short = full.subarray(0, full.length - 2);
		await withCompanionFiles(
			"CG01.wbm",
			{ "CG01.wbm": short },
			async (main) => {
				const source = await FileByteSource.open(main);
				expect(await wbmImageFormat.detect(source, main)).toBe(true);
				const archive = await wbmImageFormat.open(source, main);
				try {
					const entry = archive.entries[0];
					if (!entry) throw new Error("missing entry");
					await expect(archive.openEntry(entry.id)).rejects.toThrow();
				} finally {
					await archive.close();
				}
			},
		);
	});

	it("ignores data past the image", async () => {
		await withCompanionFiles(
			"CG01.wbm",
			{ "CG01.wbm": buildWbm({ tail: 32 }) },
			async (main) => {
				const output = await extract(main);
				expect(output.length).toBe(
					BMP_HEADER_SIZE + PALETTE_SIZE + STRIDE * HEIGHT,
				);
			},
		);
	});

	it("declines zero dimensions, a short header and a wrong signature", async () => {
		const zero = buildWbm({ height: 0, pixels: Buffer.alloc(0) });
		await withCompanionFiles("CG01.wbm", { "CG01.wbm": zero }, async (main) => {
			const source = await FileByteSource.open(main);
			expect(await wbmImageFormat.detect(source, main)).toBe(false);
		});
		const short = buildWbm().subarray(0, HEADER_SIZE - 1);
		await withCompanionFiles(
			"CG01.wbm",
			{ "CG01.wbm": short },
			async (main) => {
				const source = await FileByteSource.open(main);
				expect(await wbmImageFormat.detect(source, main)).toBe(false);
			},
		);
		const wrong = buildWbm();
		wrong[0] = 0x20;
		await withCompanionFiles(
			"CG01.wbm",
			{ "CG01.wbm": wrong },
			async (main) => {
				const source = await FileByteSource.open(main);
				expect(await wbmImageFormat.detect(source, main)).toBe(false);
			},
		);
	});
});
