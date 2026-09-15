import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { pochetteGdtImageFormat } from "../../packages/formats/src/pochette/gdt-image.js";
import {
	writeBmp24,
	writeBmp32,
} from "../../packages/formats/src/shared/bmp.js";
import { withCompanionFiles } from "../helpers/companion.js";

/** A container: two offsets, the name of a base picture, and a bitmap right behind the header. */
function gdtFile(
	offsetX: number,
	offsetY: number,
	base: string | undefined,
	bmp: Buffer,
): Buffer {
	const header = Buffer.alloc(16, 0);
	header.writeInt16LE(offsetX, 0);
	header.writeInt16LE(offsetY, 2);
	if (base !== undefined) {
		header.writeUInt8(7, 8);
		header.write(base, 9, "latin1");
	}
	return Buffer.concat([header, bmp]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, path = "cg.gdt"): Promise<Buffer> {
	const handle = await pochetteGdtImageFormat.open(sourceOf(data), path);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const stream = await handle.openEntry(entry.id);
	return consumeBuffer(stream);
}

describe("Pochette bitmap container", () => {
	it("finds a container by its header", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		expect(
			await pochetteGdtImageFormat.detect(
				sourceOf(gdtFile(0, 0, undefined, bmp)),
			),
		).toBe(true);
		// A length for the name that is neither of the two the reference accepts.
		const odd = gdtFile(0, 0, undefined, bmp);
		odd.writeUInt8(5, 8);
		expect(await pochetteGdtImageFormat.detect(sourceOf(odd))).toBe(false);
		// And a header whose bitmap is not there.
		const other = gdtFile(0, 0, undefined, Buffer.alloc(0x40, 0x41));
		expect(await pochetteGdtImageFormat.detect(sourceOf(other))).toBe(false);
	});

	it("lists the picture with the place of its base", async () => {
		const bmp = writeBmp24(3, 2, Buffer.alloc(18, 0x33));
		const data = gdtFile(-4, 7, "base", bmp);
		const handle = await pochetteGdtImageFormat.open(
			sourceOf(data),
			"dir/cg.gdt",
		);
		expect(handle.entries).toHaveLength(1);
		const entry = handle.entries[0];
		expect(entry?.path).toBe("cg.bmp");
		expect(entry?.compressed).toBe(false);
		expect(entry?.metadata).toMatchObject({
			type: "image",
			width: 3,
			height: 2,
			bitsPerPixel: 24,
			bitmapOffset: 16,
			offsetX: -4,
			offsetY: 7,
			baseLine: "base",
		});
	});

	it("hands back the bitmap alone when it names no base", async () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const out = await extract(gdtFile(0, 0, undefined, bmp));
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
	});

	it("draws the picture over its base at the place it names", async () => {
		const base = writeBmp24(
			4,
			2,
			Buffer.from([
				10, 20, 30, 10, 20, 30, 10, 20, 30, 10, 20, 30, 40, 50, 60, 40, 50, 60,
				40, 50, 60, 40, 50, 60,
			]),
		);
		const overlay = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const main = gdtFile(1, 0, "base", overlay);
		await withCompanionFiles(
			"cg.gdt",
			{ "cg.gdt": main, base: gdtFile(0, 0, undefined, base) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				const handle = await pochetteGdtImageFormat.open(source, mainPath);
				const entry = handle.entries[0];
				if (!entry) throw new Error("no entry");
				const out = await consumeBuffer(await handle.openEntry(entry.id));
				expect(out.readUInt32LE(18)).toBe(4);
				// The rows are written top down, which a bitmap records with a negative height.
				expect(out.readInt32LE(22)).toBe(-2);
				// The second and third pixel of the first row are the picture that was drawn over the base.
				expect(out.subarray(54 + 3, 54 + 9)).toEqual(
					Buffer.from([1, 2, 3, 4, 5, 6]),
				);
				expect(out.subarray(54, 54 + 3)).toEqual(Buffer.from([10, 20, 30]));
				expect(out.subarray(54 + 9, 54 + 12)).toEqual(
					Buffer.from([10, 20, 30]),
				);
				// The second row is the base's own.
				expect(out.subarray(54 + 12, 54 + 24)).toEqual(
					Buffer.from([40, 50, 60, 40, 50, 60, 40, 50, 60, 40, 50, 60]),
				);
			},
		);
	});

	it("finds the base under the extension of the format", async () => {
		const base = writeBmp24(2, 1, Buffer.from([9, 9, 9, 9, 9, 9]));
		const overlay = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const main = gdtFile(0, 0, "base", overlay);
		await withCompanionFiles(
			"cg.gdt",
			{ "cg.gdt": main, "base.gdt": gdtFile(0, 0, undefined, base) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				const handle = await pochetteGdtImageFormat.open(source, mainPath);
				const entry = handle.entries[0];
				if (!entry) throw new Error("no entry");
				const out = await consumeBuffer(await handle.openEntry(entry.id));
				expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
			},
		);
	});

	it("hands back the bitmap alone when its base is not there", async () => {
		const overlay = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const main = gdtFile(0, 0, "base", overlay);
		await withCompanionFiles("cg.gdt", { "cg.gdt": main }, async (mainPath) => {
			const source = await FileByteSource.open(mainPath);
			const handle = await pochetteGdtImageFormat.open(source, mainPath);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			const out = await consumeBuffer(await handle.openEntry(entry.id));
			expect(out.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
		});
	});

	it("keeps four bytes to a pixel when its base does", async () => {
		const base = writeBmp32(2, 1, Buffer.alloc(8, 0x77));
		const overlay = writeBmp24(1, 1, Buffer.from([1, 2, 3]));
		const main = gdtFile(1, 0, "base", overlay);
		await withCompanionFiles(
			"cg.gdt",
			{ "cg.gdt": main, base: gdtFile(0, 0, undefined, base) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				const handle = await pochetteGdtImageFormat.open(source, mainPath);
				const entry = handle.entries[0];
				if (!entry) throw new Error("no entry");
				const out = await consumeBuffer(await handle.openEntry(entry.id));
				expect(out.readUInt16LE(28)).toBe(32);
				// A bitmap of thirty two bits carries a fourth byte this one leaves empty, and the picture drawn
				// over the base brings its own three.
				expect(out.subarray(54, 58)).toEqual(
					Buffer.from([0x77, 0x77, 0x77, 0x00]),
				);
				expect(out.subarray(58, 62)).toEqual(Buffer.from([1, 2, 3, 0x00]));
			},
		);
	});

	it("refuses a picture that does not fit over its base", async () => {
		const base = writeBmp24(2, 1, Buffer.from([9, 9, 9, 9, 9, 9]));
		const overlay = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const main = gdtFile(1, 0, "base", overlay);
		await withCompanionFiles(
			"cg.gdt",
			{ "cg.gdt": main, base: gdtFile(0, 0, undefined, base) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				const handle = await pochetteGdtImageFormat.open(source, mainPath);
				const entry = handle.entries[0];
				if (!entry) throw new Error("no entry");
				await expect(handle.openEntry(entry.id)).rejects.toMatchObject({
					code: "INVALID_ARCHIVE",
				});
			},
		);
	});

	it("refuses a container whose bitmap is not there", async () => {
		const data = gdtFile(0, 0, undefined, Buffer.alloc(20, 0x11));
		// The header of a bitmap is there, but not the picture itself.
		expect(await pochetteGdtImageFormat.detect(sourceOf(data))).toBe(false);
	});
});
