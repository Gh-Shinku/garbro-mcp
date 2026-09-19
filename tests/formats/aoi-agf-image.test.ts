import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	aoiAgfImageFormat,
	blendAgf,
	readAgfBaseName,
	readAgfImage,
	readAgfLayout,
	unpackAgf,
} from "../../packages/formats/src/aoi/agf-image.js";
import { withCompanionFiles } from "../helpers/companion.js";

/** The bytes of a row, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}

/** A picture: the head of a hundred and twenty eight bytes and then the place the head gives. */
function agfFile(input: {
	width: number;
	height: number;
	version?: number;
	ops: Buffer;
	dataOffset?: number;
	flags?: number;
	baseName?: string;
	baseNameOffset?: number;
	mark?: string;
}): Buffer {
	const version = input.version ?? 1;
	const head = Buffer.alloc(0x80, 0x00);
	Buffer.from(input.mark ?? "AGF", "latin1").copy(head, 0);
	head.writeInt32LE(version, 4);
	const dataOffset = input.dataOffset ?? 0x80;
	if (1 === version) head.writeUInt32LE(dataOffset, 0x0c);
	else head.writeUInt32LE(dataOffset, 0x10);
	head.writeUInt32LE(input.width, 0x1c);
	head.writeUInt32LE(input.height, 0x20);
	if (2 === version) {
		head.writeUInt32LE(input.flags ?? 0, 0x54);
		head.writeUInt32LE(input.baseNameOffset ?? 0, 0x6c);
	}
	const name =
		input.baseName === undefined
			? Buffer.alloc(0)
			: Buffer.concat([
					Buffer.from(input.baseName, "utf16le"),
					Buffer.alloc(2, 0x00),
				]);
	return Buffer.concat([head, input.ops, name]);
}

/** A step of the walk: a word whose lowest byte is the kind and whose places above it count the pixels. */
function step(kind: number, count: number): Buffer {
	const word = Buffer.alloc(4, 0x00);
	word.writeUInt32LE((((count << 8) >>> 0) | kind) >>> 0, 0);
	return word;
}

/** A picture of one row whose pixels are four bytes each, written by steps that stand as they are. */
function pixelsOf(rows: number[][]): Buffer {
	return Buffer.from(rows.flat());
}

async function extract(data: Buffer, sourcePath = "pic.agf"): Promise<Buffer> {
	const handle = await aoiAgfImageFormat.open(
		new BufferByteSource(data),
		sourcePath,
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Aoi engine image", () => {
	it("reads the head of both versions", () => {
		const first = agfFile({
			width: 2,
			height: 1,
			ops: Buffer.concat([step(1, 2), Buffer.alloc(8, 0x00)]),
		});
		expect(readAgfLayout(first)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
			version: 1,
			dataOffset: 0x80,
			flags: 0,
			baseNameOffset: 0,
		});
		const second = agfFile({
			width: 2,
			height: 1,
			version: 2,
			flags: 0x10,
			baseNameOffset: 12,
			baseName: "base.agf",
			ops: Buffer.concat([step(1, 2), Buffer.alloc(8, 0x00)]),
		});
		expect(readAgfLayout(second)).toMatchObject({
			version: 2,
			flags: 0x10,
			baseNameOffset: 12,
		});
		const secondLayout = readAgfLayout(second);
		if (!secondLayout) throw new Error("no layout");
		expect(readAgfBaseName(second, secondLayout)).toBe("base.agf");
	});

	it("gates on the word, the version and the sizes", () => {
		const good = agfFile({
			width: 2,
			height: 1,
			ops: Buffer.concat([step(1, 2), Buffer.alloc(8, 0x00)]),
		});
		expect(readAgfLayout(good)).toBeDefined();
		expect(
			readAgfLayout(
				agfFile({
					width: 2,
					height: 1,
					mark: "AGX",
					ops: Buffer.concat([step(1, 2), Buffer.alloc(8, 0x00)]),
				}),
			),
		).toBeUndefined();
		expect(
			readAgfLayout(
				agfFile({
					width: 2,
					height: 1,
					version: 3,
					ops: Buffer.concat([step(1, 2), Buffer.alloc(8, 0x00)]),
				}),
			),
		).toBeUndefined();
		expect(
			readAgfLayout(
				agfFile({
					width: 0,
					height: 1,
					ops: Buffer.concat([step(1, 2), Buffer.alloc(8, 0x00)]),
				}),
			),
		).toBeUndefined();
	});

	it("walks the pixels of every kind of step", () => {
		// Eight pixels: two that stand as they are, then one that stands and is written again twice, then a
		// pixel copied from four pixels behind, then one passed over, and one more that stands as it is.
		const ops = Buffer.concat([
			step(1, 2),
			pixelsOf([
				[0x10, 0x11, 0x12, 0x13],
				[0x14, 0x15, 0x16, 0x17],
			]),
			step(2, 3),
			pixelsOf([[0x20, 0x21, 0x22, 0x23]]),
			// A run of one pixel copied from four pixels behind the one being written.
			step(4, (1 << 12) | 4),
			// One pixel passed over: the number stands in the second byte of the count.
			step(5, 1 << 8),
			Buffer.alloc(4, 0xee),
			step(1, 1),
			pixelsOf([[0x30, 0x31, 0x32, 0x33]]),
		]);
		const data = agfFile({ width: 8, height: 1, ops });
		const layout = readAgfLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackAgf(data, layout).toString("hex")).toBe(
			hex([
				0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x20, 0x21, 0x22, 0x23,
				0x20, 0x21, 0x22, 0x23, 0x20, 0x21, 0x22, 0x23, 0x14, 0x15, 0x16, 0x17,
				0, 0, 0, 0, 0x30, 0x31, 0x32, 0x33,
			]),
		);
	});

	it("walks a run of pixels that stands again and again", () => {
		// Five pixels: one that stands, then a run of two that stands and stands again.
		const ops = Buffer.concat([
			step(1, 1),
			pixelsOf([[0x01, 0x02, 0x03, 0x04]]),
			step(3, (2 << 8) | 2),
			pixelsOf([
				[0x11, 0x12, 0x13, 0x14],
				[0x21, 0x22, 0x23, 0x24],
			]),
		]);
		const data = agfFile({ width: 5, height: 1, ops });
		const layout = readAgfLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackAgf(data, layout).toString("hex")).toBe(
			hex([
				0x01, 0x02, 0x03, 0x04, 0x11, 0x12, 0x13, 0x14, 0x21, 0x22, 0x23, 0x24,
				0x11, 0x12, 0x13, 0x14, 0x21, 0x22, 0x23, 0x24,
			]),
		);
	});

	it("writes a picture out as a bitmap", async () => {
		const ops = Buffer.concat([
			step(1, 2),
			pixelsOf([
				[0x10, 0x20, 0x30, 0x40],
				[0x50, 0x60, 0x70, 0x80],
			]),
		]);
		const out = await extract(agfFile({ width: 2, height: 1, ops }));
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// `ImageData.Create` keeps the stored order top down, so the height of the bitmap is negative.
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("1020304050607080");
	});

	it("writes the picture it stands on under it", () => {
		const overlay = Buffer.from([0, 0, 0, 0, 1, 2, 3, 4]);
		const base = Buffer.from([9, 8, 7, 6, 5, 5, 5, 5]);
		blendAgf(overlay, base);
		expect(overlay.toString("hex")).toBe(hex([9, 8, 7, 6, 1, 2, 3, 4]));
		// A picture behind of another size is left alone.
		const other = Buffer.from([0, 0, 0, 0]);
		blendAgf(other, Buffer.alloc(8, 0x00));
		expect(other.toString("hex")).toBe("00000000");
	});

	it("reads the picture it stands on beside it", async () => {
		const behind = agfFile({
			width: 2,
			height: 1,
			ops: Buffer.concat([
				step(1, 2),
				pixelsOf([
					[9, 8, 7, 6],
					[5, 5, 5, 5],
				]),
			]),
		});
		const over = agfFile({
			width: 2,
			height: 1,
			version: 2,
			flags: 0x10,
			baseNameOffset: 12,
			baseName: "base.agf",
			ops: Buffer.concat([
				step(1, 2),
				pixelsOf([
					[0, 0, 0, 0],
					[1, 2, 3, 4],
				]),
			]),
		});
		await withCompanionFiles(
			"over.agf",
			{ "base.agf": behind },
			async (mainPath) => {
				const handle = await aoiAgfImageFormat.open(
					new BufferByteSource(over),
					mainPath,
				);
				const entry = handle.entries[0];
				if (!entry) throw new Error("no entry");
				const chunks: Buffer[] = [];
				for await (const chunk of await handle.openEntry(entry.id)) {
					chunks.push(Buffer.from(chunk));
				}
				const out = Buffer.concat(chunks);
				// The pixel of the picture that is nought in all four of its bytes takes the one behind it.
				expect(out.subarray(0x36, 0x3e).toString("hex")).toBe(
					hex([9, 8, 7, 6, 1, 2, 3, 4]),
				);
				// The same picture read where nothing stands beside it keeps the pixels it has.
				const alone = await readAgfImage(over, mainPath);
				expect(alone.subarray(0, 8).toString("hex")).toBe(
					hex([9, 8, 7, 6, 1, 2, 3, 4]),
				);
			},
		);
	});

	it("turns a step it does not know away", () => {
		const data = agfFile({
			width: 1,
			height: 1,
			ops: Buffer.concat([step(6, 1), Buffer.alloc(4, 0x00)]),
		});
		const layout = readAgfLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => unpackAgf(data, layout)).toThrow(GarbroError);
		expect(() => unpackAgf(data, layout)).toThrow(
			"Aoi engine picture is written by a step it does not know",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = agfFile({
			width: 2,
			height: 1,
			mark: "AGX",
			ops: Buffer.concat([step(1, 2), Buffer.alloc(8, 0x00)]),
		});
		await expect(
			aoiAgfImageFormat.open(new BufferByteSource(data), "pic.agf"),
		).rejects.toThrow(GarbroError);
		await expect(
			aoiAgfImageFormat.open(new BufferByteSource(data), "pic.agf"),
		).rejects.toThrow("Not an Aoi engine picture");
	});
});
