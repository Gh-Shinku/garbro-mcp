import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	SwgCursor,
	decompressSwgRow,
	readSwgLayout,
	readSwgPalette,
	splushWaveSwgImageFormat,
	unpackSwg,
} from "../../packages/formats/src/splush-wave/swg-image.js";

/** A picture: the head, an optional colour map and then the pixels. */
function swgFile(input: {
	width: number;
	height: number;
	depth?: number;
	palette?: Buffer;
	compressed?: boolean;
	body: Buffer;
	dataOffset?: number;
}): Buffer {
	const palette = input.palette;
	const dataOffset = input.dataOffset ?? 0x30 + (palette?.length ?? 0);
	const head = Buffer.alloc(0x30, 0x00);
	Buffer.from("SWG", "latin1").copy(head, 0);
	head.writeUInt32LE(dataOffset - 0x10, 0x10);
	head.writeUInt32LE(palette ? 0x30 - 0x10 : 0, 0x14);
	head.writeUInt16LE(input.width, 0x20);
	head.writeUInt16LE(input.height, 0x22);
	head.writeUInt8(input.depth ?? 1, 0x28);
	head.writeUInt8(input.compressed ? 1 : 0, 0x2f);
	return Buffer.concat([head, palette ?? Buffer.alloc(0), input.body]);
}

/** A colour map of two hundred and fifty six entries of four bytes. */
function paletteBytes(): Buffer {
	const palette = Buffer.alloc(0x400, 0x00);
	for (let entry = 0; entry < 0x100; entry += 1) {
		palette[entry * 4] = entry;
		palette[entry * 4 + 1] = entry;
		palette[entry * 4 + 2] = entry;
	}
	return palette;
}

/** A walk of a row: a run of bytes that stand as they are. */
function literalRow(values: number[]): Buffer {
	return Buffer.concat([Buffer.from([values.length - 1]), Buffer.from(values)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await splushWaveSwgImageFormat.open(
		new BufferByteSource(data),
		"pic.swg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Splush Wave Graphics", () => {
	it("reads the head as the reference does", () => {
		expect(
			readSwgLayout(
				swgFile({ width: 2, height: 1, body: Buffer.alloc(6, 0x00) }),
			),
		).toMatchObject({
			width: 2,
			height: 1,
			depth: 1,
			bitsPerPixel: 24,
			paletteOffset: 0,
			dataOffset: 0x30,
			isCompressed: false,
		});
		// A colour map makes the picture one of eight bits a pixel.
		expect(
			readSwgLayout(
				swgFile({
					width: 2,
					height: 1,
					palette: paletteBytes(),
					body: Buffer.alloc(2, 0x00),
				}),
			),
		).toMatchObject({ bitsPerPixel: 8, paletteOffset: 0x30 });
		// Two planes beyond the two of a colour make it one of thirty two.
		expect(
			readSwgLayout(
				swgFile({ width: 2, height: 1, depth: 2, body: Buffer.alloc(8, 0x00) }),
			),
		).toMatchObject({ bitsPerPixel: 32 });
	});

	it("gates on the mark, the sizes and the places", () => {
		const good = swgFile({ width: 2, height: 1, body: Buffer.alloc(6, 0x00) });
		expect(readSwgLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("XWG", 0, "latin1");
		expect(readSwgLayout(mark)).toBeUndefined();
		const width = Buffer.from(good);
		width.writeUInt16LE(0, 0x20);
		expect(readSwgLayout(width)).toBeUndefined();
		// The place of the pixels stands inside the file.
		const place = Buffer.from(good);
		place.writeUInt32LE(0x1000, 0x10);
		expect(readSwgLayout(place)).toBeUndefined();
		// So does a colour map, where there is one.
		const colour = swgFile({
			width: 2,
			height: 1,
			palette: paletteBytes(),
			body: Buffer.alloc(2, 0x00),
		});
		expect(readSwgLayout(colour)).toBeDefined();
		const map = Buffer.from(colour);
		map.writeUInt32LE(0x1000, 0x14);
		expect(readSwgLayout(map)).toBeUndefined();
	});

	it("walks a row of every kind of run", () => {
		const output = Buffer.alloc(6, 0x00);
		// A byte that stands for one pixel, a run of two bytes and a byte that stands for two pixels.
		const cursor = new SwgCursor(
			Buffer.from([0x00, 0x11, 0x01, 0x22, 0x33, 0xff, 0x44]),
			0,
		);
		decompressSwgRow(cursor, 6, output, 0, 1);
		// What the walk counts is its own size, not the pixels it writes, so the last run of two pixels
		// stands one short of the six the row is.
		expect(output.toString("hex")).toBe("112233444400");
		// The same walk across the planes of a picture: every run steps over the pixels it does not write.
		const stepped = Buffer.alloc(9, 0x00);
		decompressSwgRow(
			new SwgCursor(Buffer.from([0x00, 0x11, 0xff, 0x22]), 0),
			4,
			stepped,
			1,
			3,
		);
		expect(stepped.toString("hex")).toBe("001100002200002200");
	});

	it("reads the pixels as they stand where they are not walked along", async () => {
		const out = await extract(
			swgFile({
				width: 2,
				height: 2,
				body: Buffer.from([
					0x10, 0x20, 0x30, 0x11, 0x21, 0x31, 0x40, 0x50, 0x60, 0x41, 0x51,
					0x61,
				]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `CreateFlipped` stores rows bottom up, so the height of the bitmap stays positive.
		expect(out.readInt32LE(0x16)).toBe(2);
		expect(out.subarray(0x36, 0x36 + 16).toString("hex")).toBe(
			"10203011213100004050604151610000",
		);
	});

	it("reads an eight bit picture with its colour map", async () => {
		const out = await extract(
			swgFile({
				width: 2,
				height: 1,
				palette: paletteBytes(),
				body: Buffer.from([0x01, 0x02]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		// The colour map stands four bytes an entry, nought and then one and one again.
		expect(out.subarray(0x36, 0x3a).toString("hex")).toBe("00000000");
		expect(out.subarray(0x3a, 0x3e).toString("hex")).toBe("01010100");
		// And the pixels of the picture are the places in that map.
		expect(out.subarray(0x436, 0x43a).toString("hex")).toBe("01020000");
	});

	it("reads every plane as it stands where the walk says nothing", async () => {
		// Three planes of two pixels each, one plane after another, a byte a pixel. A walk of nought stands
		// behind six bytes rather than two: the word is read again four bytes in, and to reach it the first
		// three bytes have to be nought — one for every plane.
		const data = swgFile({
			width: 2,
			height: 1,
			compressed: true,
			body: Buffer.from([
				0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x10, 0x11, 0x20, 0x21, 0x30, 0x31,
			]),
		});
		const out = await extract(data);
		expect(out.subarray(0x36, 0x3c).toString("hex")).toBe("102030112131");
	});

	it("walks every row of every plane from the last of them", async () => {
		// Two by two with three planes. The row sizes stand two bytes each, every plane from its last row to
		// its first, which is the order the rows themselves stand in behind them.
		const rows = [
			[0x60, 0x61], // the third byte of the last row
			[0x30, 0x31], // and of the first
			[0x50, 0x51],
			[0x20, 0x21],
			[0x40, 0x41],
			[0x10, 0x11],
		];
		const sizes = Buffer.alloc(rows.length * 2, 0x00);
		rows.forEach((_values, index) => {
			sizes.writeUInt16BE(3, index * 2);
		});
		const body = Buffer.concat([
			Buffer.from([0x00, 0x01]),
			sizes,
			...rows.map((values) => literalRow(values)),
		]);
		const data = swgFile({ width: 2, height: 2, compressed: true, body });
		const layout = readSwgLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackSwg(data, layout).toString("hex")).toBe(
			"102030112131405060415161",
		);
		const out = await extract(data);
		expect(out.subarray(0x36, 0x46).toString("hex")).toBe(
			"10203011213100004050604151610000",
		);
	});

	it("reads the colour map as it stands", () => {
		const palette = paletteBytes();
		const data = swgFile({
			width: 2,
			height: 1,
			palette,
			body: Buffer.from([0x01, 0x02]),
		});
		const layout = readSwgLayout(data);
		if (!layout) throw new Error("no layout");
		expect(readSwgPalette(data, layout).toString("hex")).toBe(
			palette.toString("hex"),
		);
	});

	it("declines a picture walked along in a way it does not know", async () => {
		const data = swgFile({
			width: 2,
			height: 1,
			compressed: true,
			body: Buffer.from([0x00, 0x02, 0x00, 0x00]),
		});
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"Splush Wave picture is walked along in a way it does not know",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = swgFile({ width: 2, height: 1, body: Buffer.alloc(6, 0x00) });
		data.write("XWG", 0, "latin1");
		await expect(
			splushWaveSwgImageFormat.open(new BufferByteSource(data), "pic.swg"),
		).rejects.toThrow(GarbroError);
		await expect(
			splushWaveSwgImageFormat.open(new BufferByteSource(data), "pic.swg"),
		).rejects.toThrow("Not a Splush Wave picture");
	});
});
