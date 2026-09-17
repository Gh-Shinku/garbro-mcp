import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	convertXmgPalette,
	decryptXmg,
	readXmgHeader,
	unpackXmg,
	zyxXmgImageFormat,
} from "../../packages/formats/src/zyx/xmg-image.js";

const OBFUSCATION = 0xf3;
const HEADER_KEY = 0;
const PALETTE_KEY = 12 * 7;

/** The inverse of `XmgFormat.Decrypt`, which is what the reference actually stores. */
function encrypt(data: Buffer, key: number): Buffer {
	const output = Buffer.alloc(data.length);
	let current = key & 0xff;
	for (let i = 0; i < data.length; i += 1) {
		output[i] = ((((data[i] ?? 0) ^ OBFUSCATION) + current) & 0xff) >>> 0;
		current = (current + 7) & 0xff;
	}
	return output;
}

/** A colour map whose entry `i` is the three bytes `i`, `i + 1`, `i + 2`. */
function plainPalette(): Buffer {
	const palette = Buffer.alloc(0x300);
	for (let i = 0; i < 0x100; i += 1) {
		palette[i * 3] = i;
		palette[i * 3 + 1] = (i + 1) & 0xff;
		palette[i * 3 + 2] = (i + 2) & 0xff;
	}
	return palette;
}

/** A file: the obfuscated header, the obfuscated colour map and the plain walk behind them. */
function xmgFile(width: number, height: number, stream: Buffer): Buffer {
	const header = Buffer.alloc(12);
	header.write("XM", 0, "latin1");
	header.writeInt16LE(width, 4);
	header.writeInt16LE(height, 6);
	return Buffer.concat([
		encrypt(header, HEADER_KEY),
		encrypt(plainPalette(), PALETTE_KEY),
		stream,
	]);
}

/** A walk of two literals and then a repeat of the last one, which fills a two by two picture. */
const TWO_BY_TWO = Buffer.from([0x02, 0x11, 0x22, 0x41]);

async function extract(data: Buffer, name = "pic.xmg"): Promise<Buffer> {
	const handle = await zyxXmgImageFormat.open(new BufferByteSource(data), name);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Zyx XMG picture", () => {
	it("gates on the extension and the obfuscated header", async () => {
		const data = xmgFile(2, 2, TWO_BY_TWO);
		expect(
			await zyxXmgImageFormat.detect(new BufferByteSource(data), "pic.xmg"),
		).toBe(true);
		// The reference only looks at a file whose name carries the extension.
		expect(
			await zyxXmgImageFormat.detect(new BufferByteSource(data), "pic.bin"),
		).toBe(false);
		// The two bytes behind the tag word have to be clear.
		const odd = Buffer.from(data);
		const header = decryptXmg(odd.subarray(0, 12), HEADER_KEY);
		header[2] = 1;
		encrypt(header, HEADER_KEY).copy(odd, 0);
		expect(
			await zyxXmgImageFormat.detect(new BufferByteSource(odd), "pic.xmg"),
		).toBe(false);
		// So do the measurements.
		const empty = xmgFile(0, 2, TWO_BY_TWO);
		expect(
			await zyxXmgImageFormat.detect(new BufferByteSource(empty), "pic.xmg"),
		).toBe(false);
	});

	it("reports the measurements of the picture", async () => {
		const data = xmgFile(2, 2, TWO_BY_TWO);
		const handle = await zyxXmgImageFormat.open(
			new BufferByteSource(data),
			"dir/pic.xmg",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 8,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "rle",
			width: 2,
			height: 2,
			bitsPerPixel: 8,
		});
	});

	it("turns the colour map through the reference's own rotation", () => {
		// The stored entry is blue, red, green, and a bitmap wants blue, green, red, nothing.
		const palette = convertXmgPalette(plainPalette());
		expect(palette.subarray(0, 8).toString("hex")).toBe("0002010001030200");
	});

	it("writes the picture out again with its colour map", async () => {
		const out = await extract(xmgFile(2, 2, TWO_BY_TWO));
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.readInt32LE(0x12)).toBe(2);
		// The walk is stored top down, which a bitmap records with a negative height.
		expect(out.readInt32LE(0x16)).toBe(-2);
		// Two rows of two pixels, each row padded to four bytes; the second row repeats the last pixel of the
		// first, because the walk keeps its place across the row edge while the column counts start over.
		expect(out.subarray(0x436).toString("hex")).toBe("1122000022220000");
		// The colours of the map are the rotated ones.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0002010001030200");
	});

	it("reads the header as the reference does", () => {
		const header = Buffer.alloc(12);
		header[2] = 0;
		header[3] = 0;
		header.writeInt16LE(320, 4);
		header.writeInt16LE(240, 6);
		expect(readXmgHeader(header)).toEqual({ width: 320, height: 240 });
		// The measurements are signed, so a negative one is declined.
		header.writeInt16LE(-1, 4);
		expect(readXmgHeader(header)).toBeUndefined();
	});
});

describe("Zyx XMG walk", () => {
	it("reads a literal run whose count of nothing stands for sixty four", () => {
		const stream = Buffer.alloc(2 + 64);
		stream[0] = 0x00;
		stream[1] = 0x00;
		for (let i = 0; i < 64; i += 1) stream[2 + i] = i;
		const out = unpackXmg(Buffer.concat([Buffer.alloc(0x30c), stream]), {
			width: 64,
			height: 1,
		});
		expect(out.length).toBe(64);
		expect(out[0]).toBe(0);
		expect(out[63]).toBe(63);
	});

	it("repeats the pixel before it, counting one more than the control says", () => {
		const stream = Buffer.from([0x02, 0x11, 0x22, 0x41]);
		const out = unpackXmg(Buffer.concat([Buffer.alloc(0x30c), stream]), {
			width: 4,
			height: 1,
		});
		expect(out.toString("hex")).toBe("11222222");
	});

	it("copies a run from behind the place it stands at, repeating as it goes", () => {
		// Two literals, then a run of fourteen from distance two, so the two pixels repeat.
		const stream = Buffer.from([0x02, 0xaa, 0xbb, 0x80, 0x01, 0x04]);
		const out = unpackXmg(Buffer.concat([Buffer.alloc(0x30c), stream]), {
			width: 16,
			height: 1,
		});
		expect(out.toString("hex")).toBe("aabbaabbaabbaabbaabbaabbaabbaabb");
	});

	it("takes the low nibble of the control as the high distance bits", () => {
		// A picture long enough that a distance past 0x100 is reachable. Its second pixel is the one the
		// copy has to find, and it stands apart from the first so a misread distance is visible.
		const fill: number[] = [0x01, 0xaa, 0x01, 0xbb];
		// Three repeats of sixty five pixels each carry the walk to place 196.
		for (let i = 0; i < 3; i += 1) fill.push(0x40, 0x00);
		// Sixty two literals of a third value carry it to place 258.
		fill.push(0x3e);
		for (let i = 0; i < 62; i += 1) fill.push(0xcc);
		// `0x81` holds 0x100 of the distance in its low nibble, so the distance is 0x101 and the run comes
		// from the second pixel of the picture, not from the third value the walk last wrote.
		fill.push(0x81, 0x00, 0x00);
		const out = unpackXmg(
			Buffer.concat([Buffer.alloc(0x30c), Buffer.from(fill)]),
			{ width: 269, height: 1 },
		);
		expect(out[2]).toBe(0xbb);
		expect(out[259]).toBe(0xbb);
		expect(out[268]).toBe(0xbb);
		expect(out[258]).toBe(0xcc);
	});

	it("refuses a stream that stops where a command or a literal is wanted", () => {
		expect(() =>
			unpackXmg(Buffer.alloc(0x30c + 1), { width: 2, height: 1 }),
		).toThrow(GarbroError);
		expect(() =>
			unpackXmg(
				Buffer.concat([Buffer.alloc(0x30c), Buffer.from([0x04, 0x01])]),
				{ width: 4, height: 1 },
			),
		).toThrow("cut short");
	});

	it("refuses a command that writes past the picture", () => {
		// Four literals for a picture of two pixels.
		expect(() =>
			unpackXmg(
				Buffer.concat([
					Buffer.alloc(0x30c),
					Buffer.from([0x04, 0x11, 0x22, 0x33, 0x44]),
				]),
				{ width: 2, height: 1 },
			),
		).toThrow("past its own end");
	});
});
