import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeAg,
	masysAgImageFormat,
	readAgLayout,
} from "../../packages/formats/src/masys/ag-image.js";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x40;
const SECTION_TABLE = 0x0c;
const SECTION_COUNT = 6;
const FIRST_PIXEL_FIELD = 0x3c;
const BMP_PIXELS = 0x36;
const BMP_HEIGHT_FIELD = 0x16;
const BMP_BPP_FIELD = 0x1c;

/** A stream of single bits: the reference reads the low bit of each byte first. */
function bitStream(bits: readonly number[]): Buffer {
	const out = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		if (!bit) continue;
		const at = index >> 3;
		out[at] = (out[at] ?? 0) | (1 << (index & 7));
	}
	return out;
}

/** A stream of nibbles: two to a byte, the low one read first. */
function nibbleStream(values: readonly number[]): Buffer {
	const out = Buffer.alloc(Math.ceil(values.length / 2));
	for (const [index, value] of values.entries()) {
		const at = index >> 1;
		const shift = index % 2 === 0 ? 0 : 4;
		out[at] = (out[at] ?? 0) | ((value & 0xf) << shift);
	}
	return out;
}

function zeros(count: number): number[] {
	return new Array<number>(count).fill(0);
}

function ones(count: number): number[] {
	return new Array<number>(count).fill(1);
}

interface AgFixture {
	width: number;
	height: number;
	/** The six stored streams, the ones the picture does not use left out. */
	sections: readonly (Buffer | undefined)[];
	firstPixel?: readonly [number, number, number];
}

function agFile(options: AgFixture): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("AGd\0", 0, "latin1");
	header.writeUInt32LE(options.width, 4);
	header.writeUInt32LE(options.height, 8);
	const seed = options.firstPixel ?? [0, 0, 0];
	header[FIRST_PIXEL_FIELD] = seed[0];
	header[FIRST_PIXEL_FIELD + 1] = seed[1];
	header[FIRST_PIXEL_FIELD + 2] = seed[2];
	const payloads: Buffer[] = [];
	let offset = HEADER_SIZE;
	for (let index = 0; index < SECTION_COUNT; index += 1) {
		const at = SECTION_TABLE + index * 8;
		const section = options.sections[index];
		if (!section) {
			header.writeUInt32LE(0, at);
			header.writeInt32LE(0, at + 4);
			continue;
		}
		header.writeUInt32LE(offset, at);
		header.writeInt32LE(section.length, at + 4);
		payloads.push(section);
		offset += section.length;
	}
	return Buffer.concat([header, ...payloads]);
}

function layoutOf(file: Buffer) {
	const layout = readAgLayout(file);
	if (!layout) throw new Error("the fixture does not read as a Masys picture");
	return layout;
}

function pixelsOf(file: Buffer): Buffer {
	return decodeAg(file, layoutOf(file));
}

/** The pixels of a bitmap the port produced, with the row padding of a twenty four bit one taken out. */
function bmpPixels(bmp: Buffer, pixelSize: number, height: number): Buffer {
	const width = bmp.readInt32LE(0x12);
	const stride =
		pixelSize === 3 ? (width * pixelSize + 3) & ~3 : width * pixelSize;
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		const at = BMP_PIXELS + row * stride;
		out.push(...bmp.subarray(at, at + width * pixelSize));
	}
	return Buffer.from(out);
}

async function firstOf(file: Buffer): Promise<Buffer> {
	const archive = await masysAgImageFormat.open(
		new BufferByteSource(file),
		"picture.ag",
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

describe("Masys ACG image", () => {
	it("reads every channel as the literal byte of its own stream", () => {
		const body = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
		]);
		const file = agFile({
			width: 2,
			height: 2,
			sections: [
				bitStream(ones(12)),
				bitStream(zeros(12)),
				bitStream(zeros(12)),
				nibbleStream(zeros(12)),
				body,
			],
		});
		expect(pixelsOf(file)).toEqual(body);
	});

	it("keeps a channel from the pixel before it, and a row's first from the row above", () => {
		// Four pixels: two read as they stand, one repeated from the first pixel of its row, one more read.
		const file = agFile({
			width: 2,
			height: 2,
			sections: [
				bitStream([1, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1]),
				bitStream(zeros(12)),
				bitStream([1, 1, 1]),
				nibbleStream(zeros(12)),
				Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80, 0x90]),
			],
			firstPixel: [0x01, 0x02, 0x03],
		});
		expect(pixelsOf(file)).toEqual(
			Buffer.from([
				0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x10, 0x20, 0x30, 0x70, 0x80, 0x90,
			]),
		);
	});

	it("builds a channel as a difference of at most sixteen from the pixel before it", () => {
		const file = agFile({
			width: 2,
			height: 1,
			sections: [
				bitStream(zeros(6)),
				bitStream([0, 0, 1, 1, 1, 1]),
				bitStream(zeros(6)),
				nibbleStream([0, 4, 9, 1, 2, 3]),
				Buffer.alloc(0),
			],
			firstPixel: [0x80, 0x80, 0x80],
		});
		// The first pixel climbs by one, five and ten, and the third of those is a subtraction; the second
		// pixel then steps back from the first.
		expect(pixelsOf(file)).toEqual(
			Buffer.from([0x81, 0x85, 0x76, 0x7f, 0x82, 0x72]),
		);
	});

	it("lets a difference wrap around the ends of a byte", () => {
		const file = agFile({
			width: 1,
			height: 1,
			sections: [
				bitStream(zeros(3)),
				bitStream([1, 1, 1]),
				bitStream(zeros(3)),
				nibbleStream([4, 4, 4]),
				Buffer.alloc(0),
			],
			firstPixel: [0x02, 0x02, 0x02],
		});
		expect(pixelsOf(file)).toEqual(Buffer.from([0xfd, 0xfd, 0xfd]));
	});

	it("scales the run length coded alpha plane and hands over four byte pixels", async () => {
		const file = agFile({
			width: 4,
			height: 1,
			sections: [
				bitStream(ones(12)),
				bitStream(zeros(12)),
				bitStream(zeros(12)),
				nibbleStream(zeros(12)),
				Buffer.from([
					0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
					0x0b,
				]),
				// A byte of its own, then a run of two, then one more whose value is clamped.
				Buffer.from([0x20, 0xbf, 0x02, 0x00, 0x41]),
			],
		});
		const layout = layoutOf(file);
		expect(layout.alpha).toBe(true);
		expect(layout.width * layout.height).toBe(4);
		const bmp = await firstOf(file);
		expect(bmp.readUInt16LE(BMP_BPP_FIELD)).toBe(32);
		expect(bmpPixels(bmp, 4, 1)).toEqual(
			Buffer.from([
				0x00, 0x01, 0x02, 127, 0x03, 0x04, 0x05, 251, 0x06, 0x07, 0x08, 251,
				0x09, 0x0a, 0x0b, 255,
			]),
		);
	});

	it("hands a picture with no alpha plane over as a twenty four bit bitmap", async () => {
		const file = agFile({
			width: 2,
			height: 2,
			sections: [
				bitStream(ones(12)),
				bitStream(zeros(12)),
				bitStream(zeros(12)),
				nibbleStream(zeros(12)),
				Buffer.from([
					0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b,
					0x0c,
				]),
			],
		});
		const bmp = await firstOf(file);
		expect(bmp.readUInt16LE(BMP_BPP_FIELD)).toBe(24);
		// A top down bitmap records its height as a negative one.
		expect(bmp.readInt32LE(BMP_HEIGHT_FIELD)).toBe(-2);
		expect(bmpPixels(bmp, 3, 2)).toEqual(
			Buffer.from([
				0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
			]),
		);
	});

	it("lists the picture as one bitmap and reports what it holds", async () => {
		const file = agFile({
			width: 1,
			height: 1,
			sections: [
				bitStream(ones(3)),
				bitStream(zeros(3)),
				bitStream(zeros(3)),
				nibbleStream(zeros(3)),
				Buffer.from([0x0a, 0x0b, 0x0c]),
			],
		});
		await expectArchive({
			format: masysAgImageFormat,
			archive: file,
			sourcePath: "face.ag",
			entries: [{ path: "face.bmp", size: file.length }],
			metadata: {
				image: "bmp",
				width: 1,
				height: 1,
				bitsPerPixel: 24,
				alpha: false,
			},
		});
	});

	it("turns away a file whose header is not the one it expects", async () => {
		const good = agFile({
			width: 1,
			height: 1,
			sections: [
				bitStream(ones(3)),
				bitStream(zeros(3)),
				bitStream(zeros(3)),
				nibbleStream(zeros(3)),
				Buffer.from([0x0a, 0x0b, 0x0c]),
			],
		});
		const badMagic = Buffer.from(good);
		badMagic.write("AGe\0", 0, "latin1");
		const noWidth = Buffer.from(good);
		noWidth.writeUInt32LE(0, 4);
		const noHeight = Buffer.from(good);
		noHeight.writeUInt32LE(0, 8);
		const beyondEnd = Buffer.from(good);
		beyondEnd.writeUInt32LE(good.length - 1, SECTION_TABLE);
		beyondEnd.writeInt32LE(4, SECTION_TABLE + 4);
		const negativeSize = Buffer.from(good);
		negativeSize.writeInt32LE(-1, SECTION_TABLE + 4);
		const tooWide = Buffer.from(good);
		tooWide.writeUInt32LE(0x10000, 4);
		tooWide.writeUInt32LE(0x10000, 8);
		expect(
			await masysAgImageFormat.detect(new BufferByteSource(good), "a.ag"),
		).toBe(true);
		for (const candidate of [
			good.subarray(0, 0x3e),
			badMagic,
			noWidth,
			noHeight,
			beyondEnd,
			negativeSize,
			tooWide,
		]) {
			expect(
				await masysAgImageFormat.detect(
					new BufferByteSource(candidate),
					"a.ag",
				),
			).toBe(false);
		}
	});

	it("stops where a stream the picture needs does not hold", () => {
		// The pixels ask for a control stream the file does not carry.
		const noControl = agFile({
			width: 1,
			height: 1,
			sections: [undefined, undefined, undefined, undefined, Buffer.alloc(0)],
		});
		expect(() => pixelsOf(noControl)).toThrow(GarbroError);
		// The alpha plane ends before it fills the picture.
		const shortAlpha = agFile({
			width: 2,
			height: 1,
			sections: [
				bitStream(ones(6)),
				bitStream(zeros(6)),
				bitStream(zeros(6)),
				nibbleStream(zeros(6)),
				Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]),
				Buffer.from([0x20]),
			],
		});
		expect(() => pixelsOf(shortAlpha)).toThrow(GarbroError);
		// A run of the alpha plane that outgrows the picture.
		const longRun = agFile({
			width: 1,
			height: 1,
			sections: [
				bitStream(ones(3)),
				bitStream(zeros(3)),
				bitStream(zeros(3)),
				nibbleStream(zeros(3)),
				Buffer.from([0x01, 0x02, 0x03]),
				Buffer.from([0xbf, 0x02, 0x00]),
			],
		});
		expect(() => pixelsOf(longRun)).toThrow(GarbroError);
	});
});
