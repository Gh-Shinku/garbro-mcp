// The picture of a difference against a base picture, against a base and two walks written by hand: the base
// of the fixture is a bitmap (or a graphic) of the places this test asks for and the difference names the
// places it changes, so the places of the picture are the ones the fixture names.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { FileByteSource } from "@garbro-mcp/core";
import { mnoVioletDifImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	composeDifPicture,
	readDifHeader,
} from "../../packages/formats/src/mnoviolet/dif-image.js";
import {
	readBmpImage,
	writeBmp24,
} from "../../packages/formats/src/shared/bmp.js";
import { withCompanionFiles } from "../helpers/companion.js";
import { pngFile } from "../helpers/png.js";

/** The base picture of the fixture: a bitmap of two by two places of three colours, of its own places. */
function baseBmp(): Buffer {
	return writeBmp24(
		2,
		2,
		Buffer.from([
			0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0,
		]),
		false,
	);
}

/** The base picture of the fixture as a graphic, of the same places. */
function basePng(): Buffer {
	return pngFile({
		width: 2,
		height: 2,
		colourType: 2,
		rows: [
			// A graphic of three places a colour stands of the red place first, so the places of a picture
			// of it stand of the blue one first, which is the order of a bitmap of its own.
			[0x30, 0x20, 0x10, 0x60, 0x50, 0x40],
			[0x90, 0x80, 0x70, 0xc0, 0xb0, 0xa0],
		],
	});
}

/** A walk of the places of the fixture, of its own places one after the other. */
function literalLzss(values: readonly number[]): Buffer {
	const out: number[] = [];
	for (let at = 0; at < values.length; at += 8) {
		const group = values.slice(at, at + 8);
		let flag = 0;
		for (let bit = 0; bit < group.length; bit += 1) flag |= 1 << bit;
		out.push(flag, ...group);
	}
	return Buffer.from(out);
}

/** A difference of the engine: the head, the index of the parts and the difference itself. */
function buildDif(input: {
	baseName: string;
	index: readonly (readonly [number, number])[];
	difference: readonly number[];
	packedDiffSize?: number;
}): Buffer {
	const head = Buffer.alloc(0x7c, 0);
	head.write("dif\0", 0, "latin1");
	head.write(input.baseName, 4, "latin1");
	const index = Buffer.alloc(input.index.length * 8, 0);
	input.index.forEach(([offset, size], at) => {
		index.writeInt32LE(offset, at * 8);
		index.writeInt32LE(size, at * 8 + 4);
	});
	const packedIndex = literalLzss([...index]);
	const packedDiff = literalLzss(input.difference);
	head.writeInt32LE(packedIndex.length, 0x68);
	head.writeInt32LE(index.length, 0x6c);
	head.writeInt32LE(input.packedDiffSize ?? packedDiff.length, 0x70);
	head.writeInt32LE(input.difference.length, 0x74);
	head.writeInt32LE(input.index.length, 0x78);
	return Buffer.concat([head, packedIndex, packedDiff]);
}

/** The places of the picture the composition turns out, of a row of three places a place. */
function rows(places: Buffer, width: number): number[][] {
	const out: number[][] = [];
	for (let row = 0; row < places.length; row += width * 3) {
		out.push([...places.subarray(row, row + width * 3)]);
	}
	return out;
}

describe("M no Violet incremental picture", () => {
	it("reads the head of the picture", () => {
		const data = buildDif({
			baseName: "base",
			index: [[0, 3]],
			difference: [0xaa, 0xbb, 0xcc],
		});
		const header = readDifHeader(data);
		expect(header?.baseName).toBe("base");
		expect(header?.indexSize).toBe(8);
		expect(header?.diffCount).toBe(1);
		expect(header?.packedDiffSize).toBeGreaterThan(0);
		// The name may carry a directory, and it stands of the places of the head up to the first nothing.
		const named = buildDif({
			baseName: "gs/base",
			index: [[0, 3]],
			difference: [0xaa, 0xbb, 0xcc],
		});
		expect(readDifHeader(named)?.baseName).toBe("gs/base");
	});

	it("turns away what is not one of its pictures", () => {
		const good = buildDif({
			baseName: "base",
			index: [[0, 3]],
			difference: [0xaa, 0xbb, 0xcc],
		});
		expect(readDifHeader(good)).toBeDefined();
		// The picture stands of a name, and of an index whose parts stand within it.
		const noName = Buffer.from(good);
		noName.fill(0, 4, 0x68);
		expect(readDifHeader(noName)).toBeUndefined();
		const otherMark = Buffer.from(good);
		otherMark.write("fid\0", 0, "latin1");
		expect(readDifHeader(otherMark)).toBeUndefined();
		const short = buildDif({
			baseName: "base",
			index: [[0, 3]],
			difference: [0xaa, 0xbb, 0xcc],
			packedDiffSize: 0x1000,
		});
		expect(readDifHeader(short)).toBeUndefined();
		const manyParts = buildDif({
			baseName: "base",
			index: [[0, 3]],
			difference: [0xaa, 0xbb, 0xcc],
		});
		manyParts.writeInt32LE(0x100, 0x78);
		expect(readDifHeader(manyParts)).toBeUndefined();
		expect(readDifHeader(good.subarray(0, 0x20))).toBeUndefined();
	});

	it("lays the difference of the picture over the base of it", async () => {
		// The base of two by two places stands of its rows turned over and of a row of eight places, so the
		// places of the difference at nothing stand on the last row of the base and the ones at nine on the
		// second place of the row in front of it.
		const data = buildDif({
			baseName: "base",
			index: [
				[0, 3],
				[9, 2],
			],
			difference: [0xaa, 0xbb, 0xcc, 0xdd, 0xee],
		});
		const header = readDifHeader(data);
		if (!header) throw new Error("no header");
		await withCompanionFiles(
			"image.dif",
			{ "image.dif": data, "base.bmp": baseBmp() },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await mnoVioletDifImageFormat.detect(source, mainPath)).toBe(
					true,
				);
				const handle = await mnoVioletDifImageFormat.open(source, mainPath);
				const entry = handle.entries[0];
				if (!entry) throw new Error("no entry");
				expect(entry.metadata?.width).toBe(2);
				expect(entry.metadata?.height).toBe(2);
				const bmp = await consumeBuffer(await handle.openEntry(entry.id));
				await handle.close();
				const read = readBmpImage(bmp);
				if (!read) throw new Error("no bitmap");
				expect(read.width).toBe(2);
				// Every row of the base stands of four places a place in the picture of the difference, of
				// which the third one is the padding behind it: the bitmap of the format stands of a tight
				// row, so the padding is taken out and the rows stand from the top down.
				// The first part of the difference lands on the row the base turns over, which the picture
				// of the format stores from the bottom up, and the second one on the row behind it.
				expect(rows(read.pixels, 2)).toEqual([
					[0x10, 0xdd, 0xee, 0x40, 0x50, 0x60],
					[0xaa, 0xbb, 0xcc, 0xa0, 0xb0, 0xc0],
				]);
			},
		);
	});

	it("stands of the places of the difference itself", async () => {
		// The two walks of the picture stand one behind the other from the end of the head, and every place
		// of the difference lands where the index of it names, of the places of the base turned over.
		const base = baseBmp();
		const places = readBmpImage(base);
		if (!places) throw new Error("no bitmap");
		expect(places.height).toBe(2);
		expect([...places.pixels]).toEqual([
			0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0,
		]);
		const data = buildDif({
			baseName: "base",
			index: [[0, 3]],
			difference: [0x01, 0x02, 0x03],
		});
		const header = readDifHeader(data);
		if (!header) throw new Error("no header");
		const picture = await composeDifPicture(data, header, {
			width: 2,
			height: 2,
			pixels: Buffer.from([
				0x70, 0x80, 0x90, 0xa0, 0xb0, 0xc0, 0x00, 0x00, 0x10, 0x20, 0x30, 0x40,
				0x50, 0x60, 0x00, 0x00,
			]),
		});
		expect([...picture]).toEqual([
			0x01, 0x02, 0x03, 0xa0, 0xb0, 0xc0, 0x00, 0x00, 0x10, 0x20, 0x30, 0x40,
			0x50, 0x60, 0x00, 0x00,
		]);
	});

	it("stands of a graphic of its own beside the picture as well", async () => {
		const data = buildDif({
			baseName: "base",
			index: [[0, 6]],
			difference: [0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff],
		});
		await withCompanionFiles(
			"image.dif",
			{ "image.dif": data, "base.png": basePng() },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await mnoVioletDifImageFormat.detect(source, mainPath)).toBe(
					true,
				);
				const handle = await mnoVioletDifImageFormat.open(source, mainPath);
				const entry = handle.entries[0];
				if (!entry) throw new Error("no entry");
				const bmp = await consumeBuffer(await handle.openEntry(entry.id));
				await handle.close();
				const read = readBmpImage(bmp);
				if (!read) throw new Error("no bitmap");
				expect(rows(read.pixels, 2)).toEqual([
					[0x10, 0x20, 0x30, 0x40, 0x50, 0x60],
					[0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff],
				]);
			},
		);
	});

	it("stands of no picture where no base of it stands beside it", async () => {
		const data = buildDif({
			baseName: "base",
			index: [[0, 3]],
			difference: [0xaa, 0xbb, 0xcc],
		});
		await withCompanionFiles(
			"image.dif",
			{ "image.dif": data },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await mnoVioletDifImageFormat.detect(source, mainPath)).toBe(
					false,
				);
			},
		);
		// A difference that names itself finds no base beside it either, which is what the reference turns
		// away as well.
		const itself = buildDif({
			baseName: "image",
			index: [[0, 3]],
			difference: [0xaa, 0xbb, 0xcc],
		});
		await withCompanionFiles(
			"image.dif",
			{ "image.dif": itself },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await mnoVioletDifImageFormat.detect(source, mainPath)).toBe(
					false,
				);
			},
		);
	});
});
