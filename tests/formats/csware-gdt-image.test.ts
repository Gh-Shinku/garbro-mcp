import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { BufferByteSource } from "@garbro-mcp/core";
import { cswareGdtImageFormat } from "../../packages/formats/src/csware/gdt-image.js";

/** AGS flag: a colour map is stored, and the planes are unpacked two rows at a time. */
const PALETTE_FLAG = 0x80;
/** The flag the single row scheme is named by, which is the double flag left clear. */
const SINGLE = 0x40;

/** A picture: the header, a colour map when one is named, the four lengths, then the four plane streams. */
function gdtFile(
	width: number,
	height: number,
	planes: Buffer[],
	flags = SINGLE,
	palette?: Buffer,
): Buffer {
	const header = Buffer.alloc(16, 0);
	header.write("DA1", 0, "latin1");
	header.writeUInt8(width >> 3, 9);
	header.writeUInt16LE(height, 0xc);
	header.writeUInt8(flags, 0xf);
	const parts: Buffer[] = [header];
	if (palette) parts.push(palette);
	const sizes: Buffer = Buffer.alloc(8, 0);
	for (const [index, plane] of planes.entries()) {
		sizes.writeUInt16LE(plane.length, index * 2);
	}
	parts.push(sizes);
	for (const plane of planes) parts.push(plane);
	return Buffer.concat(parts);
}

/** A run of a colour map read four bits to a channel: blue, then red, then green. */
function paletteBytes(colours: number[][]): Buffer {
	const bits: number[] = [];
	for (const [red, green, blue] of colours) {
		for (const value of [blue ?? 0, red ?? 0, green ?? 0]) {
			for (let i = 3; i >= 0; i -= 1) bits.push((value >> i) & 1);
		}
	}
	const bytes: Buffer = Buffer.alloc(Math.ceil(bits.length / 8), 0);
	for (const [index, bit] of bits.entries()) {
		if (bit)
			bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (1 << (7 - (index & 7)));
	}
	return bytes;
}

/** The grey ramp a picture without a colour map is handed out with. */
function greyPalette(): number[] {
	const entries: number[] = [];
	for (let i = 0; i < 16; i += 1) entries.push(i * 0x11, i * 0x11, i * 0x11, 0);
	return entries;
}

const PIXELS_AT = 54 + 64;

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await cswareGdtImageFormat.open(sourceOf(data), "cg.gdt");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const stream = await handle.openEntry(entry.id);
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

describe("AGS engine image", () => {
	it("finds a picture under its word", async () => {
		const data = gdtFile(8, 8, [Buffer.from([0x08, 0xff])], SINGLE);
		expect(await cswareGdtImageFormat.detect(sourceOf(data))).toBe(true);
		expect(
			await cswareGdtImageFormat.detect(sourceOf(Buffer.from("DA2....."))),
		).toBe(false);
	});

	it("lists the picture with its places and flags", async () => {
		const data = gdtFile(8, 8, [Buffer.from([0x08, 0xff])], SINGLE);
		data.writeUInt8(2, 8);
		data.writeUInt16LE(5, 0xa);
		const handle = await cswareGdtImageFormat.open(
			sourceOf(data),
			"dir/cg.gdt",
		);
		expect(handle.entries).toHaveLength(1);
		const entry = handle.entries[0];
		expect(entry?.path).toBe("cg.bmp");
		expect(entry?.metadata).toMatchObject({
			type: "image",
			width: 8,
			height: 8,
			bitsPerPixel: 4,
			offsetX: 16,
			offsetY: 5,
			flags: SINGLE,
		});
	});

	it("flattens four empty planes into a grey picture", async () => {
		const row = Buffer.from([0x08, 0xff]);
		const out = await extract(gdtFile(8, 8, [row, row, row, row], SINGLE));
		expect(out.readUInt16LE(28)).toBe(4);
		// The colour map of a picture without one is a ramp of greys.
		expect(out.subarray(54, 54 + 64)).toEqual(Buffer.from(greyPalette()));
		expect(out.subarray(PIXELS_AT, PIXELS_AT + 4 * 8)).toEqual(
			Buffer.alloc(4 * 8, 0x00),
		);
	});

	it("fills a plane with ones and shows them in every pixel", async () => {
		// A run of eight white bytes in the first plane, which is the lowest bit of every pixel.
		const white = Buffer.from([0x28, 0xff]);
		const empty = Buffer.from([0x08, 0xff]);
		const out = await extract(
			gdtFile(8, 8, [white, empty, empty, empty], SINGLE),
		);
		// Four bits to a pixel, so a byte of the picture carries two pixels, and both are one.
		expect(out.subarray(PIXELS_AT, PIXELS_AT + 4)).toEqual(
			Buffer.alloc(4, 0x11),
		);
	});

	it("carries the highest bit in the fourth plane", async () => {
		// The same run in the last plane, which is the bit above the other three.
		const white = Buffer.from([0x28, 0xff]);
		const empty = Buffer.from([0x08, 0xff]);
		const out = await extract(
			gdtFile(8, 8, [empty, empty, empty, white], SINGLE),
		);
		expect(out.subarray(PIXELS_AT, PIXELS_AT + 4)).toEqual(
			Buffer.alloc(4, 0x88),
		);
	});

	it("repeats a run of what it has already written", async () => {
		// Two white bytes, then a run of six more copied from the two behind them.
		const repeated = Buffer.from([0x22, 0xd6, 0xff]);
		const empty = Buffer.from([0x08, 0xff]);
		const out = await extract(
			gdtFile(8, 8, [repeated, empty, empty, empty], SINGLE),
		);
		expect(out.subarray(PIXELS_AT, PIXELS_AT + 4)).toEqual(
			Buffer.alloc(4, 0x11),
		);
	});

	it("copies a row out of another plane", async () => {
		// The second plane takes its row from the first, so every pixel carries two bits of one.
		const white = Buffer.from([0x28, 0xff]);
		const copied = Buffer.from([0x48, 0xff]);
		const empty = Buffer.from([0x08, 0xff]);
		const out = await extract(
			gdtFile(8, 8, [white, copied, empty, empty], SINGLE),
		);
		// Every pixel is three, the two lowest bits of it set.
		expect(out.subarray(PIXELS_AT, PIXELS_AT + 4)).toEqual(
			Buffer.alloc(4, 0x33),
		);
	});

	it("reads the colour map a picture carries", async () => {
		const colours: number[][] = [];
		for (let i = 0; i < 16; i += 1) colours.push([i, 15 - i, i]);
		const row = Buffer.from([0x08, 0xff]);
		const out = await extract(
			gdtFile(
				8,
				8,
				[row, row, row, row],
				SINGLE | PALETTE_FLAG,
				paletteBytes(colours),
			),
		);
		const expected: number[] = [];
		for (const entry of colours) {
			expected.push(
				(entry[0] ?? 0) * 0x11,
				(entry[1] ?? 0) * 0x11,
				(entry[2] ?? 0) * 0x11,
				0x00,
			);
		}
		expect(out.subarray(54, 54 + 64)).toEqual(Buffer.from(expected));
	});

	it("refuses a row that reaches past its plane", async () => {
		// A run of sixteen bytes in a plane that holds eight.
		const tooLong = Buffer.from([0x30, 0xff]);
		const empty = Buffer.from([0x08, 0xff]);
		await expect(
			extract(gdtFile(8, 8, [tooLong, empty, empty, empty], SINGLE)),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a stream that ends inside an opcode", async () => {
		// A long word fill whose words are not there, in the plane the file ends with.
		const empty = Buffer.from([0x08, 0xff]);
		const broken = Buffer.from([0xfd, 0x82]);
		await expect(
			extract(gdtFile(8, 8, [empty, empty, empty, broken], SINGLE)),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("unpacks two rows at a time when the flags say so", async () => {
		// A run of two bytes in both rows at once, which fills the two columns of a picture of sixteen
		// pixels across and closes the pair of rows behind it.
		const double = Buffer.from([0x02, 0xc5, 0x00, 0xff]);
		const empty = Buffer.from([0x00, 0xff]);
		const out = await extract(
			gdtFile(16, 8, [double, empty, empty, empty], 0x00),
		);
		expect(out.readUInt32LE(18)).toBe(16);
		// The two bytes the run writes are the first two columns of both rows, and every other bit of the
		// value is set, so the two pixels of a byte hold one and zero by turns.
		expect(out.subarray(PIXELS_AT, PIXELS_AT + 4)).toEqual(
			Buffer.from([0x01, 0x01, 0x01, 0x01]),
		);
	});

	it("keeps the place the literals of the two row scheme leave behind", async () => {
		// The reference reads the bytes of both rows without moving on, so a second run of literals behind the
		// first one writes over it rather than beside it.
		const double = Buffer.from([
			0x01, 0xd0, 0xf0, 0x0f, 0x01, 0xd0, 0x0f, 0xf0, 0x00, 0xff,
		]);
		const empty = Buffer.from([0x00, 0xff]);
		const out = await extract(
			gdtFile(16, 8, [double, empty, empty, empty], 0x00),
		);
		// The last run is the one that stays, so the first column carries its low bits.
		expect(out.subarray(PIXELS_AT, PIXELS_AT + 4)).toEqual(
			Buffer.from([0x00, 0x00, 0x11, 0x11]),
		);
	});
});
