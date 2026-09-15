import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { gameresBmpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
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
