import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeIpf,
	readIpfLayout,
	technoBrainIpfImageFormat,
} from "../../packages/formats/src/techno-brain/ipf-image.js";
import { expectArchive } from "../helpers/archive.js";

// The chunks behind the format chunk stand at twice the twenty byte header plus its size.
const FORMAT_END = 0x28 + 0x24;
const BITMAP_BODY = 0x20;
const BMP_BPP_FIELD = 0x1c;
/** The dimensions stand eight bytes into the bitmap chunk, which follows the format chunk. */
const BMP_WIDTH_IN_FILE = FORMAT_END + 8;
const BMP_HEIGHT_IN_FILE = FORMAT_END + 10;
const BMP_HEIGHT_FIELD = 0x16;

interface IpfFixture {
	width: number;
	height: number;
	compressed?: boolean;
	/** The presence bitmap and the colours behind it, when the picture carries a palette. */
	palette?: { presence: Buffer; colours: Buffer };
	body: Buffer;
	bitmapFlag?: number;
	formatName?: string;
}

function ipfFile(options: IpfFixture): Buffer {
	const head = Buffer.alloc(FORMAT_END, 0x00);
	head.write("RIFF", 0, "latin1");
	head.write("fmt ", 0x0c, "latin1");
	head.writeUInt32LE(0x24, 0x10);
	head.write(options.formatName ?? "IPF fmt ", 0x1c, "latin1");
	head.writeUInt32LE(options.palette ? 1 : 0, 0x2c);
	head.writeUInt32LE(options.bitmapFlag ?? 1, 0x3c);
	const parts: Buffer[] = [head];
	if (options.palette) {
		// The palette chunk: the tag, its size, four bytes the reader steps over, then the bitmap of which
		// colours are stored and the colours themselves.
		const chunk = Buffer.alloc(
			8 + 4 + 0x20 + options.palette.colours.length,
			0x00,
		);
		chunk.write("pal ", 0, "latin1");
		chunk.writeUInt32LE(chunk.length - 8, 4);
		options.palette.presence.copy(chunk, 8 + 4);
		options.palette.colours.copy(chunk, 8 + 4 + 0x20);
		parts.push(chunk);
	}
	const bitmap = Buffer.alloc(8 + BITMAP_BODY + options.body.length, 0x00);
	bitmap.write("bmp ", 0, "latin1");
	bitmap.writeUInt32LE(bitmap.length - 8, 4);
	bitmap.writeUInt16LE(options.width, 8);
	bitmap.writeUInt16LE(options.height, 10);
	bitmap.writeInt16LE(7, 16);
	bitmap.writeInt16LE(9, 18);
	bitmap[0x1a] = options.compressed ? 1 : 0;
	options.body.copy(bitmap, BITMAP_BODY);
	parts.push(bitmap);
	return Buffer.concat(parts);
}

function layoutOf(file: Buffer) {
	const layout = readIpfLayout(file);
	if (!layout) throw new Error("the fixture does not read as an IPF picture");
	return layout;
}

/** The pixels of an eight bit bitmap, with the row padding taken out. */
function bmpPixels(bmp: Buffer, width: number, height: number): Buffer {
	const stride = (width + 3) & ~3;
	const first = bmp.readUInt32LE(0x0a);
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		const at = first + row * stride;
		out.push(...bmp.subarray(at, at + width));
	}
	return Buffer.from(out);
}

async function bitmapOf(file: Buffer): Promise<Buffer> {
	const archive = await technoBrainIpfImageFormat.open(
		new BufferByteSource(file),
		"picture.ipf",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("the picture has no entry");
		const chunks: Buffer[] = [];
		for await (const chunk of await archive.openEntry(entry.id)) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks);
	} finally {
		await archive.close();
	}
}

describe("TechnoBrain IPF image", () => {
	it("reads a picture with no palette as one byte of grey each", async () => {
		const values = [0, 1, 2, 3, 4, 5];
		const file = ipfFile({
			width: 3,
			height: 2,
			body: Buffer.from(values),
		});
		const layout = layoutOf(file);
		expect(layout.bitsPerPixel).toBe(8);
		expect(layout.hasPalette).toBe(false);
		expect(layout.offsetX).toBe(7);
		expect(layout.offsetY).toBe(9);
		const { pixels, palette } = decodeIpf(file, layout);
		expect(pixels).toEqual(Buffer.from(values));
		// The colours of a picture without a palette climb from nothing to white.
		expect(palette.subarray(0, 8)).toEqual(
			Buffer.from([0, 0, 0, 0, 1, 1, 1, 0]),
		);
		expect(palette.subarray(0xff * 4, 0xff * 4 + 4)).toEqual(
			Buffer.from([0xff, 0xff, 0xff, 0]),
		);
		const bmp = await bitmapOf(file);
		expect(bmp.readUInt16LE(BMP_BPP_FIELD)).toBe(8);
		// The rows are read from the top down, so the bitmap says so with a negative height.
		expect(bmp.readInt32LE(BMP_HEIGHT_FIELD)).toBe(-2);
		expect(bmpPixels(bmp, 3, 2)).toEqual(Buffer.from(values));
	});

	it("reads the colours a picture carries and leaves the rest black", () => {
		// Colours ten and eleven are stored, the whole range below them is not, and one beyond the last
		// colour is marked without being kept.
		const presence = Buffer.alloc(0x20, 0x00);
		presence[0] = 0xff;
		presence[1] = 0x30;
		presence[0x1f] = 0x01;
		const file = ipfFile({
			width: 2,
			height: 1,
			body: Buffer.from([10, 11]),
			palette: {
				presence,
				colours: Buffer.from([
					0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0xaa, 0xbb, 0xcc,
				]),
			},
		});
		const layout = layoutOf(file);
		expect(layout.hasPalette).toBe(true);
		const { pixels, palette } = decodeIpf(file, layout);
		expect(pixels).toEqual(Buffer.from([10, 11]));
		// A bitmap keeps its colours blue first, and the first ten of them are never stored.
		expect(palette.subarray(0, 4)).toEqual(Buffer.from([0, 0, 0, 0]));
		expect(palette.subarray(10 * 4, 12 * 4)).toEqual(
			Buffer.from([0x33, 0x22, 0x11, 0x00, 0x66, 0x55, 0x44, 0x00]),
		);
		expect(palette.subarray(0xff * 4, 0xff * 4 + 4)).toEqual(
			Buffer.from([0, 0, 0, 0]),
		);
	});

	it("unpacks a compressed picture through all of its control bytes", () => {
		// A byte of its own, the escape, a run of four, a copy of three taken from behind, and an end that
		// leaves the rest of the picture as it stands.
		const file = ipfFile({
			width: 8,
			height: 2,
			compressed: true,
			body: Buffer.from([0x30, 0x0e, 0x00, 0x03, 0xab, 0x10, 0x02, 0x02, 0x0f]),
		});
		expect(decodeIpf(file, layoutOf(file)).pixels).toEqual(
			Buffer.from([
				0x20, 0x0e, 0xab, 0xab, 0xab, 0xab, 0xab, 0xab, 0xab, 0, 0, 0, 0, 0, 0,
				0,
			]),
		);
	});

	it("reads a run whose length is twelve bits wide", () => {
		// Three hundred pixels from one run of a byte, which needs both halves of the length.
		const file = ipfFile({
			width: 300,
			height: 1,
			compressed: true,
			body: Buffer.from([0x01, 0x2b, 0x5a, 0x0f]),
		});
		const pixels = decodeIpf(file, layoutOf(file)).pixels;
		expect(pixels.length).toBe(300);
		expect(pixels.subarray(0, 3)).toEqual(Buffer.from([0x5a, 0x5a, 0x5a]));
		expect(pixels.subarray(297)).toEqual(Buffer.from([0x5a, 0x5a, 0x5a]));
	});

	it("lists the picture as one bitmap and reports what it holds", async () => {
		const file = ipfFile({
			width: 2,
			height: 2,
			body: Buffer.from([1, 2, 3, 4]),
		});
		await expectArchive({
			format: technoBrainIpfImageFormat,
			archive: file,
			sourcePath: "face.ipf",
			entries: [{ path: "face.bmp", size: file.length }],
			metadata: {
				image: "bmp",
				width: 2,
				height: 2,
				bitsPerPixel: 8,
				palette: false,
				compressed: false,
				offsetX: 7,
				offsetY: 9,
			},
		});
	});

	it("turns away a file whose header is not the one it expects", async () => {
		const good = ipfFile({
			width: 2,
			height: 1,
			body: Buffer.from([1, 2]),
		});
		const withField = (offset: number, value: number, width: 2 | 4): Buffer => {
			const copy = Buffer.from(good);
			if (width === 2) copy.writeUInt16LE(value, offset);
			else copy.writeUInt32LE(value, offset);
			return copy;
		};
		const withText = (offset: number, text: string): Buffer => {
			const copy = Buffer.from(good);
			copy.write(text, offset, "latin1");
			return copy;
		};
		// A wave file opens with RIFF and carries a fmt chunk as well, which is what the format string behind
		// that chunk is there to tell apart.
		// A picture of four gigabytes worth of pixels is more than this project will hold.
		const tooLargeHeader = Buffer.from(good);
		tooLargeHeader.writeUInt16LE(0x8000, BMP_WIDTH_IN_FILE);
		tooLargeHeader.writeUInt16LE(0x8000, BMP_HEIGHT_IN_FILE);
		const wave = Buffer.from(good);
		wave.write("WAVE", 8, "latin1");
		wave.write("fact", 0x1c, "latin1");
		expect(
			await technoBrainIpfImageFormat.detect(
				new BufferByteSource(good),
				"a.ipf",
			),
		).toBe(true);
		for (const candidate of [
			Buffer.from("NOPE", "latin1"),
			wave,
			withText(0x0c, "fact"),
			withText(0x1c, "IPF frm "),
			withField(0x3c, 0, 4),
			withField(0x10, 0x10, 4),
			withField(0x10, 0x1000, 4),
			withField(BMP_WIDTH_IN_FILE, 0, 2),
			withField(BMP_HEIGHT_IN_FILE, 0, 2),
			tooLargeHeader,
			good.subarray(0, FORMAT_END - 1),
		]) {
			expect(
				await technoBrainIpfImageFormat.detect(
					new BufferByteSource(candidate),
					"a.ipf",
				),
			).toBe(false);
		}
		// A picture that claims a palette but carries no palette chunk.
		const noPalette = Buffer.from(good);
		noPalette.writeUInt32LE(1, 0x2c);
		expect(
			await technoBrainIpfImageFormat.detect(
				new BufferByteSource(noPalette),
				"a.ipf",
			),
		).toBe(false);
	});

	it("refuses a stream whose pixels do not hold", () => {
		// An uncompressed picture with fewer pixels than it declares.
		const short = ipfFile({
			width: 4,
			height: 4,
			body: Buffer.from([1, 2, 3]),
		});
		expect(() => decodeIpf(short, layoutOf(short))).toThrow(GarbroError);
		// A copy that reaches before the start of the picture.
		const backwards = ipfFile({
			width: 4,
			height: 1,
			compressed: true,
			body: Buffer.from([0x30, 0x11, 0x02, 0x02, 0x0f]),
		});
		expect(() => decodeIpf(backwards, layoutOf(backwards))).toThrow(
			GarbroError,
		);
		// A run that outgrows the picture.
		const overrun = ipfFile({
			width: 2,
			height: 1,
			compressed: true,
			body: Buffer.from([0x00, 0x10, 0xab]),
		});
		expect(() => decodeIpf(overrun, layoutOf(overrun))).toThrow(GarbroError);
		// A compressed stream that stops in the middle of a control byte.
		const cutShort = ipfFile({
			width: 4,
			height: 1,
			compressed: true,
			body: Buffer.from([0x00]),
		});
		expect(() => decodeIpf(cutShort, layoutOf(cutShort))).toThrow(GarbroError);
	});
});
