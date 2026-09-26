import {
	BufferByteSource,
	FileByteSource,
	GarbroError,
} from "@garbro-mcp/core";
import { gameresBmpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { withCompanionFiles } from "../helpers/companion.js";
import {
	readBmpImage,
	writeBmp1,
	writeBmp8,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../../packages/formats/src/shared/bmp.js";

/** A bitmap with the twelve byte header: words to a measurement and three bytes to a colour. */
function coreHeaderBmp(
	width: number,
	height: number,
	pixels: number[],
	palette: number[],
): Buffer {
	const rowBytes = width;
	const stride = (rowBytes + 3) & ~3;
	const entries: Buffer = Buffer.alloc(256 * 3);
	Buffer.from(palette).copy(entries, 0);
	const header: Buffer = Buffer.alloc(14 + 12, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(header.length + entries.length + stride * height, 2);
	header.writeUInt32LE(header.length + entries.length, 10);
	header.writeUInt32LE(12, 14);
	header.writeUInt16LE(width, 18);
	header.writeUInt16LE(height, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt16LE(8, 24);
	const rows: Buffer[] = [];
	for (let row = 0; row < height; row += 1) {
		const line: Buffer = Buffer.alloc(stride, 0x00);
		for (let i = 0; i < rowBytes; i += 1) {
			line[i] = pixels[row * rowBytes + i] ?? 0;
		}
		rows.push(line);
	}
	return Buffer.concat([header, entries, ...rows]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.bmp"): Promise<Buffer> {
	const archive = await gameresBmpImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The places of the picture of the companion tests: two places square, of three places of a colour. */
const COMPANION_PICTURE = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
/** The places of the alpha of the companion: a place a place of the picture. */
const COMPANION_ALPHA = Buffer.from([
	0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80,
]);

/** The picture the format hands out of a companion whose rows stand in the given order. */
async function alphaOf(bottomUp: boolean): Promise<number[]> {
	const picture = writeBmp24(2, 2, COMPANION_PICTURE, bottomUp);
	let places: number[] = [];
	await withCompanionFiles(
		"CG01.bmp",
		{ "CG01.bmp": picture, "CG01.alp": COMPANION_ALPHA },
		async (mainPath) => {
			const source = await FileByteSource.open(mainPath);
			const archive = await gameresBmpImageFormat.open(source, mainPath);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const image = readBmpImage(
				await consumeBuffer(await archive.openEntry(entry.id)),
			);
			if (!image) throw new Error("no bitmap");
			places = [...image.pixels];
		},
	);
	return places;
}

describe("Windows bitmap", () => {
	it("finds a bitmap by its own tag", async () => {
		expect(gameresBmpImageFormat.detection?.signatures).toEqual([]);
		const file = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		expect(await gameresBmpImageFormat.detect(sourceOf(file))).toBe(true);
		expect(await gameresBmpImageFormat.detect(sourceOf(Buffer.alloc(0)))).toBe(
			false,
		);
		expect(
			await gameresBmpImageFormat.detect(sourceOf(Buffer.alloc(64, 0x00))),
		).toBe(false);
		expect(
			await gameresBmpImageFormat.detect(
				sourceOf(Buffer.concat([Buffer.from("BX"), file.subarray(2)])),
			),
		).toBe(false);
	});

	it("reads the measurements its header declares", async () => {
		const file = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const archive = await gameresBmpImageFormat.open(
			sourceOf(file),
			"CG01.bmp",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 1,
				bitsPerPixel: 24,
				imageOffset: 54,
				imageLength: file.length,
			});
		} finally {
			await archive.close();
		}
	});

	it("hands back every depth it can read", async () => {
		const cases: Array<{ file: Buffer; depth: number; pixels: number[] }> = [
			{
				file: writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6])),
				depth: 24,
				pixels: [1, 2, 3, 4, 5, 6],
			},
			{
				file: writeBmp32(1, 1, Buffer.from([1, 2, 3, 4])),
				depth: 32,
				pixels: [1, 2, 3, 4],
			},
			{
				file: writeBmp8(3, 1, Buffer.from([1, 2, 3])),
				depth: 8,
				pixels: [1, 2, 3],
			},
			{
				file: writeBmp16(1, 1, Buffer.from([0x1f, 0x00])),
				depth: 16,
				pixels: [0x1f, 0x00],
			},
			{
				file: writeBmp1(
					9,
					1,
					Buffer.from([0b11000000, 0b10000000]),
					Buffer.from([1, 2, 3, 0, 4, 5, 6, 0]),
				),
				depth: 1,
				pixels: [0b11000000, 0b10000000],
			},
		];
		// The pixels sit behind the colour map and the colour masks each depth needs, and behind the header.
		const offsets: Record<number, number> = { 1: 8, 4: 64, 8: 1024, 16: 12 };
		for (const item of cases) {
			const bmp = await extract(item.file);
			expect(bmp.readUInt16LE(28)).toBe(item.depth);
			const start = 54 + (offsets[item.depth] ?? 0);
			expect(bmp.subarray(start, start + item.pixels.length)).toEqual(
				Buffer.from(item.pixels),
			);
		}
	});

	it("lays the alpha channel of a companion over the picture", async () => {
		// `AlpBitmap` looks for a companion of the same name with the extension `.alp`, of three places of a
		// colour of a place of a row behind it, and lays it over the fourth place of every place of the
		// picture. The rows of the companion stand of the rows of the picture as the file stores them, which
		// is the way the reference walks them as well: a picture whose rows stand the other way round in the
		// file takes the rows of its companion the same way round.
		// A picture whose rows stand the other way round in the file - which is what a height above nought
		// stands for - takes the rows of its companion the other way round as well.
		expect(await alphaOf(true)).toEqual([
			7, 8, 9, 0x50, 10, 11, 12, 0x60, 1, 2, 3, 0x10, 4, 5, 6, 0x20,
		]);
		expect(await alphaOf(false)).toEqual([
			1, 2, 3, 0x10, 4, 5, 6, 0x20, 7, 8, 9, 0x50, 10, 11, 12, 0x60,
		]);
		// A companion of another count, and a picture with no companion at all, stand aside.
		const picture = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		await withCompanionFiles(
			"CG01.bmp",
			{ "CG01.bmp": picture, "CG01.alp": Buffer.from([1, 2, 3]) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				const archive = await gameresBmpImageFormat.open(source, mainPath);
				const entry = archive.entries[0];
				if (!entry) throw new Error("missing entry");
				const image = readBmpImage(
					await consumeBuffer(await archive.openEntry(entry.id)),
				);
				expect(image?.bitsPerPixel).toBe(24);
			},
		);
	});

	it("reads a bitmap stored with the older header", async () => {
		// Two rows of two pixels stored bottom up, which is the only way that header stores them.
		const file = coreHeaderBmp(
			2,
			2,
			[1, 2, 3, 4],
			[10, 20, 30, 40, 50, 60, 70, 80],
		);
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(8);
		expect(bmp.readInt32LE(22)).toBe(-2);
		// The rows come back top down, two pixels to a row padded out to four bytes: what the file stored last
		// leads the picture.
		expect(bmp.subarray(54 + 1024, 54 + 1024 + 2)).toEqual(Buffer.from([3, 4]));
		expect(bmp.subarray(54 + 1024 + 4, 54 + 1024 + 6)).toEqual(
			Buffer.from([1, 2]),
		);
		expect(bmp.subarray(54, 54 + 8)).toEqual(
			Buffer.from([10, 20, 30, 0, 40, 50, 60, 0]),
		);
	});

	it("reads the two lengths a bitmap may leave out", async () => {
		const file = writeBmp24(1, 1, Buffer.from([1, 2, 3]));
		for (const size of [0, 0xe]) {
			const odd = Buffer.from(file);
			odd.writeUInt32LE(size, 2);
			expect(await gameresBmpImageFormat.detect(sourceOf(odd))).toBe(true);
			const archive = await gameresBmpImageFormat.open(
				sourceOf(odd),
				"CG01.bmp",
			);
			try {
				// The reference reads the file's own length where the claim is one of those two.
				expect(archive.entries[0]?.metadata).toMatchObject({
					imageLength: odd.length,
				});
			} finally {
				await archive.close();
			}
		}
		// Any other claim shorter than the headers is not a bitmap this reader knows.
		const short = Buffer.from(file);
		short.writeUInt32LE(0x20, 2);
		expect(await gameresBmpImageFormat.detect(sourceOf(short))).toBe(false);
		// One that claims more than the file is clamped to it.
		const long = Buffer.from(file);
		long.writeUInt32LE(0x1000, 2);
		expect(await gameresBmpImageFormat.detect(sourceOf(long))).toBe(true);
	});

	it("refuses a header it cannot read a bitmap out of", async () => {
		// A header shorter than the forty bytes every bitmap this reader knows carries.
		const shortHeader = writeBmp24(1, 1, Buffer.from([1, 2, 3]));
		shortHeader.writeUInt32LE(28, 14);
		expect(await gameresBmpImageFormat.detect(sourceOf(shortHeader))).toBe(
			false,
		);
		await expect(extract(Buffer.alloc(64, 0x00))).rejects.toThrow(GarbroError);
		await expect(extract(Buffer.alloc(64, 0x00))).rejects.toThrow(
			"Invalid Windows bitmap",
		);
		// A bitmap whose header is sound but whose pixels are not there at all is listed and only fails when
		// it is taken apart, as it does in the reference.
		const short = Buffer.from(writeBmp24(4, 4, Buffer.alloc(48, 0x11)));
		expect(await gameresBmpImageFormat.detect(sourceOf(short))).toBe(true);
		await expect(extract(short.subarray(0, 60))).rejects.toThrow(
			"Invalid Windows bitmap",
		);
	});

	it("refuses a bitmap of a depth it cannot weave", async () => {
		// The reference's own reader takes any depth it is handed; the one here knows the six a game uses.
		const file = writeBmp24(1, 1, Buffer.from([1, 2, 3]));
		file.writeUInt16LE(3, 28);
		expect(await gameresBmpImageFormat.detect(sourceOf(file))).toBe(true);
		await expect(extract(file)).rejects.toThrow("Invalid Windows bitmap");
	});
});
