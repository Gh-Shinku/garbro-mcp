import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	adobePsdImageFormat,
	decodePsd,
	readPsdLayout,
} from "../../packages/formats/src/adobe/psd-image.js";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x1a;
const BMP_BPP_FIELD = 0x1c;
const BMP_HEIGHT_FIELD = 0x16;
const BMP_PALETTE = 0x36;

interface PsdFixture {
	width: number;
	height: number;
	channels: number;
	depth?: number;
	mode?: number;
	compression?: number;
	/** The stored channels, one behind the other, as the file keeps them. */
	planes?: readonly Buffer[];
	/** The packed row lengths, one word to a row of every channel in turn. */
	rowLengths?: readonly number[];
	/** The packed rows themselves, when the compression is the run length coded one. */
	rows?: readonly Buffer[];
	colourModeData?: Buffer;
}

function psdFile(options: PsdFixture): Buffer {
	const header = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("8BPS", 0, "latin1");
	header.writeInt16BE(1, 4);
	header.writeInt16BE(options.channels, 0x0c);
	header.writeUInt32BE(options.height, 0x0e);
	header.writeUInt32BE(options.width, 0x12);
	header.writeInt16BE(options.depth ?? 8, 0x16);
	header.writeInt16BE(options.mode ?? 3, 0x18);
	const parts: Buffer[] = [header];
	// The colour mode data, then the image resources and the layer and mask information, each behind its own
	// length.
	const section = (body: Buffer): Buffer => {
		const length = Buffer.alloc(4);
		length.writeInt32BE(body.length, 0);
		return Buffer.concat([length, body]);
	};
	parts.push(section(options.colourModeData ?? Buffer.alloc(0)));
	parts.push(section(Buffer.alloc(0)));
	parts.push(section(Buffer.alloc(0)));
	const compression = Buffer.alloc(2);
	compression.writeInt16BE(options.compression ?? 0, 0);
	parts.push(compression);
	if (1 === (options.compression ?? 0)) {
		const lengths: Buffer[] = [];
		for (const length of options.rowLengths ?? []) {
			const word = Buffer.alloc(2);
			word.writeInt16BE(length, 0);
			lengths.push(word);
		}
		parts.push(Buffer.concat(lengths));
		for (const row of options.rows ?? []) parts.push(row);
	} else {
		for (const plane of options.planes ?? []) parts.push(plane);
	}
	return Buffer.concat(parts);
}

function layoutOf(file: Buffer) {
	const layout = readPsdLayout(file);
	if (!layout)
		throw new Error("the fixture does not read as a Photoshop picture");
	return layout;
}

/** The pixels of a bitmap the port produced, with the row padding taken out. */
function bmpPixels(bmp: Buffer, bitsPerPixel: number, height: number): Buffer {
	const width = bmp.readInt32LE(0x12);
	const rowBytes =
		bitsPerPixel === 1 ? (width + 7) >> 3 : width * (bitsPerPixel / 8);
	const stride = (rowBytes + 3) & ~3;
	const first = bmp.readUInt32LE(0x0a);
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		const at = first + row * stride;
		out.push(...bmp.subarray(at, at + rowBytes));
	}
	return Buffer.from(out);
}

async function bitmapOf(file: Buffer): Promise<Buffer> {
	const archive = await adobePsdImageFormat.open(
		new BufferByteSource(file),
		"picture.psd",
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

describe("Adobe Photoshop PSD image", () => {
	it("writes the three channels of a picture blue first", async () => {
		const file = psdFile({
			width: 2,
			height: 1,
			channels: 3,
			planes: [Buffer.from([1, 2]), Buffer.from([3, 4]), Buffer.from([5, 6])],
		});
		const layout = layoutOf(file);
		expect(layout.channels).toBe(3);
		expect(layout.mode).toBe(3);
		const picture = decodePsd(file, layout);
		expect(picture.kind).toBe("bgr24");
		// The file keeps red, green and blue; a bitmap keeps blue, green and red.
		expect(picture.pixels).toEqual(Buffer.from([5, 3, 1, 6, 4, 2]));
		const bmp = await bitmapOf(file);
		expect(bmp.readUInt16LE(BMP_BPP_FIELD)).toBe(24);
		// The channels run from the top row down, so the bitmap says so with a negative height.
		expect(bmp.readInt32LE(BMP_HEIGHT_FIELD)).toBe(-1);
		expect(bmpPixels(bmp, 24, 1)).toEqual(Buffer.from([5, 3, 1, 6, 4, 2]));
	});

	it("keeps the fourth channel of a picture as its alpha", () => {
		const file = psdFile({
			width: 1,
			height: 1,
			channels: 4,
			planes: [
				Buffer.from([0x11]),
				Buffer.from([0x22]),
				Buffer.from([0x33]),
				Buffer.from([0x44]),
			],
		});
		const picture = decodePsd(file, layoutOf(file));
		expect(picture.kind).toBe("bgra32");
		expect(picture.pixels).toEqual(Buffer.from([0x33, 0x22, 0x11, 0x44]));
	});

	it("reads only the first four channels of a picture that has more", () => {
		const file = psdFile({
			width: 1,
			height: 1,
			channels: 5,
			planes: [
				Buffer.from([0x11]),
				Buffer.from([0x22]),
				Buffer.from([0x33]),
				Buffer.from([0x44]),
				Buffer.from([0x55]),
			],
		});
		const layout = layoutOf(file);
		expect(layout.channels).toBe(5);
		const picture = decodePsd(file, layout);
		expect(picture.kind).toBe("bgra32");
		expect(picture.pixels).toEqual(Buffer.from([0x33, 0x22, 0x11, 0x44]));
	});

	it("hands a greyscale picture over as one byte of grey each", async () => {
		const file = psdFile({
			width: 3,
			height: 1,
			channels: 1,
			mode: 1,
			planes: [Buffer.from([0, 0x80, 0xff])],
		});
		const picture = decodePsd(file, layoutOf(file));
		expect(picture.kind).toBe("grey8");
		expect(picture.pixels).toEqual(Buffer.from([0, 0x80, 0xff]));
		const bmp = await bitmapOf(file);
		expect(bmp.readUInt16LE(BMP_BPP_FIELD)).toBe(8);
		// The colours of a picture with no palette of its own climb from nothing to white.
		expect(bmp.subarray(BMP_PALETTE, BMP_PALETTE + 8)).toEqual(
			Buffer.from([0, 0, 0, 0, 1, 1, 1, 0]),
		);
		expect(bmpPixels(bmp, 8, 1)).toEqual(Buffer.from([0, 0x80, 0xff]));
	});

	it("hands a bitmap picture over as one bit to a pixel", async () => {
		// Ten pixels a row pack into two bytes, so two rows take four.
		const file = psdFile({
			width: 10,
			height: 2,
			channels: 1,
			mode: 0,
			depth: 1,
			planes: [Buffer.from([0b10101010, 0b11000000, 0b01010101, 0b01000000])],
		});
		const picture = decodePsd(file, layoutOf(file));
		expect(picture.kind).toBe("bitmap1");
		const bmp = await bitmapOf(file);
		expect(bmp.readUInt16LE(BMP_BPP_FIELD)).toBe(1);
		// A bitmap of this kind carries two colours: nothing and white.
		expect(bmp.subarray(BMP_PALETTE, BMP_PALETTE + 8)).toEqual(
			Buffer.from([0, 0, 0, 0, 0xff, 0xff, 0xff, 0]),
		);
		expect(bmpPixels(bmp, 1, 2)).toEqual(
			Buffer.from([0b10101010, 0b11000000, 0b01010101, 0b01000000]),
		);
	});

	it("unpacks rows that are run length coded", () => {
		// Three channels of three pixels: one stored as it stands, one from a run of three, and one stored
		// as it stands again.
		const file = psdFile({
			width: 3,
			height: 1,
			channels: 3,
			compression: 1,
			rowLengths: [4, 2, 4],
			rows: [
				Buffer.from([0x02, 1, 2, 3]),
				Buffer.from([0xfe, 9]),
				Buffer.from([0x02, 7, 8, 9]),
			],
		});
		expect(decodePsd(file, layoutOf(file)).pixels).toEqual(
			Buffer.from([7, 9, 1, 8, 9, 2, 9, 9, 3]),
		);
	});

	it("lists the picture as one bitmap and reports what it holds", async () => {
		const file = psdFile({
			width: 2,
			height: 2,
			channels: 3,
			planes: [Buffer.alloc(4, 1), Buffer.alloc(4, 2), Buffer.alloc(4, 3)],
		});
		await expectArchive({
			format: adobePsdImageFormat,
			archive: file,
			sourcePath: "face.psd",
			entries: [{ path: "face.bmp", size: file.length }],
			metadata: {
				image: "bmp",
				width: 2,
				height: 2,
				bitsPerPixel: 24,
				channels: 3,
				mode: 3,
			},
		});
	});

	it("turns away a file whose header is not the one it expects", async () => {
		const good = psdFile({
			width: 2,
			height: 2,
			channels: 3,
			planes: [Buffer.alloc(4), Buffer.alloc(4), Buffer.alloc(4)],
		});
		const withField = (offset: number, value: number, width: 2 | 4): Buffer => {
			const copy = Buffer.from(good);
			if (2 === width) copy.writeInt16BE(value, offset);
			else copy.writeUInt32BE(value, offset);
			return copy;
		};
		// A picture of four hundred million pixels over three channels is more than this project will hold.
		const tooLarge = Buffer.from(good);
		tooLarge.writeUInt32BE(30000, 0x0e);
		tooLarge.writeUInt32BE(30000, 0x12);
		expect(
			await adobePsdImageFormat.detect(new BufferByteSource(good), "a.psd"),
		).toBe(true);
		for (const candidate of [
			Buffer.from("8BPT", "latin1"),
			withField(4, 2, 2),
			withField(4, 0, 2),
			withField(0x0c, 0, 2),
			withField(0x0c, 57, 2),
			withField(0x0e, 0, 4),
			withField(0x12, 0, 4),
			withField(0x12, 30001, 4),
			withField(0x16, 0, 2),
			tooLarge,
			good.subarray(0, HEADER_SIZE - 1),
		]) {
			expect(
				await adobePsdImageFormat.detect(
					new BufferByteSource(candidate),
					"a.psd",
				),
			).toBe(false);
		}
	});

	it("refuses a picture it cannot unpack", () => {
		const planes = (): readonly Buffer[] => [
			Buffer.alloc(4),
			Buffer.alloc(4),
			Buffer.alloc(4),
		];
		const unsupported: readonly Buffer[] = [
			// An indexed picture, which the reference leaves unsupported as well.
			psdFile({ width: 2, height: 2, channels: 1, mode: 2, depth: 8 }),
			// A colour mode the reference does not read.
			psdFile({ width: 2, height: 2, channels: 4, mode: 4 }),
			// A greyscale picture deeper than eight bits a channel.
			psdFile({
				width: 2,
				height: 2,
				channels: 1,
				mode: 1,
				depth: 16,
				planes: [Buffer.alloc(8)],
			}),
			// The compression the reference names and does not unpack.
			psdFile({
				width: 2,
				height: 2,
				channels: 3,
				compression: 2,
				planes: planes(),
			}),
			// A picture with fewer than three channels in colour.
			psdFile({ width: 2, height: 2, channels: 2, planes: [] }),
		];
		for (const file of unsupported) {
			const layout = layoutOf(file);
			expect(() => decodePsd(file, layout)).toThrow(GarbroError);
		}
		// A plane that does not hold all of its pixels.
		const short = psdFile({
			width: 4,
			height: 4,
			channels: 3,
			planes: [Buffer.alloc(2), Buffer.alloc(2), Buffer.alloc(2)],
		});
		expect(() => decodePsd(short, layoutOf(short))).toThrow(GarbroError);
		// A row length that carries a row past the end of the file.
		const longRow = psdFile({
			width: 3,
			height: 1,
			channels: 3,
			compression: 1,
			rowLengths: [0x100, 2, 4],
			rows: [
				Buffer.from([0x02, 1, 2, 3]),
				Buffer.from([0xfe, 9]),
				Buffer.from([0x02, 7, 8, 9]),
			],
		});
		expect(() => decodePsd(longRow, layoutOf(longRow))).toThrow(GarbroError);
		// The run the reference loops on for ever.
		const looping = psdFile({
			width: 3,
			height: 1,
			channels: 3,
			compression: 1,
			rowLengths: [2, 2, 4],
			rows: [
				Buffer.from([0x80, 0x00]),
				Buffer.from([0xfe, 9]),
				Buffer.from([0x02, 7, 8, 9]),
			],
		});
		expect(() => decodePsd(looping, layoutOf(looping))).toThrow(GarbroError);
	});
});
