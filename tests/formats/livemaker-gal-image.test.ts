// The picture of the LiveMaker engine, against pictures built in the test: the head of the two shapes of it,
// the counts of the frame of it, the counts of the places of it (the walk of the engine of every count and
// the walk of the places of the picture itself), the walk of the counts of the places of the picture of the
// engine (`TpRandom`) and the refusal of the places of a picture of the kind of the engine itself.
import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import {
	livemakerGalImageFormat,
	readGalHeader,
	readGalPicture,
	readGalSequence,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEAD_SIZE = 0x28;
const GREETING_SIZE = 11;
const OLD_HEAD_SIZE = 0x10;

interface LayerInput {
	pixels: Buffer;
	alpha?: Buffer;
}

interface GalInput {
	version?: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	compression?: number;
	blockWidth?: number;
	blockHeight?: number;
	shuffled?: boolean;
	palette?: Buffer;
	frameCount?: number;
	layers?: LayerInput[];
}

function word(value: number): Buffer {
	const out = Buffer.alloc(4, 0);
	out.writeInt32LE(value, 0);
	return out;
}

function head(input: GalInput): Buffer {
	const version = input.version ?? 107;
	const digits = Buffer.from(String(version), "latin1");
	if (version <= 102) {
		const out = Buffer.alloc(OLD_HEAD_SIZE, 0);
		out.write("Gale", 0, "latin1");
		digits.copy(out, 4);
		return out;
	}
	const greeting = Buffer.alloc(GREETING_SIZE, 0);
	greeting.write("Gale", 0, "latin1");
	digits.copy(greeting, 4);
	greeting.writeInt32LE(HEAD_SIZE, 7);
	const body = Buffer.alloc(HEAD_SIZE, 0);
	body.writeInt32LE(version, 0);
	body.writeUInt32LE(input.width, 4);
	body.writeUInt32LE(input.height, 8);
	body.writeInt32LE(input.bitsPerPixel, 0xc);
	body.writeInt32LE(input.frameCount ?? 1, 0x10);
	body[0x15] = input.shuffled ? 1 : 0;
	body[0x16] = input.compression ?? 1;
	body.writeInt32LE(input.blockWidth ?? 0, 0x1c);
	body.writeInt32LE(input.blockHeight ?? 0, 0x20);
	return Buffer.concat([greeting, body]);
}

function body(input: GalInput): Buffer {
	const layers = input.layers ?? [];
	const parts: Buffer[] = [
		word(0),
		word(0),
		Buffer.alloc(9, 0),
		word(layers.length),
		word(input.width),
		word(input.height),
		word(input.bitsPerPixel),
	];
	if (input.palette) parts.push(input.palette);
	const version = input.version ?? 107;
	for (const layer of layers) {
		parts.push(
			word(0),
			word(0),
			Buffer.from([1]),
			word(-1),
			word(0xff),
			Buffer.from([0]),
			word(0),
		);
		if (version >= 107) parts.push(Buffer.from([0]));
		parts.push(word(layer.pixels.length), layer.pixels);
		parts.push(word(layer.alpha?.length ?? 0));
		if (layer.alpha) parts.push(layer.alpha);
	}
	return Buffer.concat(parts);
}

function galFile(input: GalInput): Buffer {
	return Buffer.concat([head(input), body(input)]);
}

function rawLayer(input: GalInput, pixels: Buffer): Buffer {
	return galFile({ ...input, layers: [{ pixels }] });
}

/** The places of a picture of the engine of the counts of the walk of the engine of the places of it. */
function placesOf(
	width: number,
	height: number,
	bitsPerPixel: number,
	place: (x: number, y: number, channel: number) => number,
): Buffer {
	let stride = Math.trunc((width * bitsPerPixel + 7) / 8);
	if (bitsPerPixel >= 8) stride = (stride + 3) & ~3;
	const out = Buffer.alloc(stride * height);
	for (let y = 0; y < height; y += 1) {
		for (let x = 0; x < width; x += 1) {
			for (let channel = 0; channel < bitsPerPixel / 8; channel += 1) {
				out[y * stride + x * (bitsPerPixel / 8) + channel] = place(
					x,
					y,
					channel,
				);
			}
		}
	}
	return out;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await livemakerGalImageFormat.open(
		new BufferByteSource(data),
		"picture.gal",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("LiveMaker engine picture", () => {
	it("reads the head of the picture and the counts of the frame of it", async () => {
		const pixels = placesOf(5, 2, 24, (x, y) => 0x10 + x + y * 0x20);
		const data = rawLayer(
			{ width: 5, height: 2, bitsPerPixel: 24, frameCount: 3 },
			pixels,
		);
		expect(
			await livemakerGalImageFormat.detect(new BufferByteSource(data), "p.gal"),
		).toBe(true);
		const header = readGalHeader(data);
		expect(header).toMatchObject({
			version: 107,
			// The word of the head of the engine, the letters of the version and the count of the places of
			// the head of it, and then the head itself.
			dataOffset: GREETING_SIZE + HEAD_SIZE,
			width: 5,
			height: 2,
			bitsPerPixel: 24,
			frameCount: 3,
			shuffled: false,
			compression: 1,
		});
		expect(readGalPicture(data)?.head.layerCount).toBe(1);
		const handle = await livemakerGalImageFormat.open(
			new BufferByteSource(data),
			"picture.gal",
		);
		try {
			expect(handle.metadata).toMatchObject({
				image: "bmp",
				width: 5,
				height: 2,
				bitsPerPixel: 24,
				version: 107,
				layers: 1,
			});
			expect(handle.entries[0]?.path).toBe("picture.bmp");
		} finally {
			await handle.close();
		}
		// The places of the picture of the engine stand of the counts of the places of the picture of the
		// engine itself: the rows of the places of the picture stand of four places of the count of the
		// engine of the picture of the engine, which the bitmap of this project does not carry.
		const image = readBmpImage(await extract(data));
		if (!image) throw new Error("no bitmap");
		expect(image).toMatchObject({ width: 5, height: 2, bitsPerPixel: 24 });
		const expected: number[] = [];
		for (let y = 0; y < 2; y += 1) {
			for (let x = 0; x < 5; x += 1) {
				for (let channel = 0; channel < 3; channel += 1) {
					expected.push(pixels[y * 16 + x * 3 + channel] ?? 0);
				}
			}
		}
		expect([...image.pixels]).toEqual(expected);
	});

	it("reads the head of the older count of the engine", async () => {
		// The head of the older counts of the engine stands of the counts of the picture of the engine alone,
		// at the places of the head of it, and the places of the picture stand of the counts of the picture
		// itself.
		const palette = Buffer.alloc(256 * 4, 0);
		for (let index = 0; index < 4; index += 1) {
			palette[index * 4] = index;
			palette[index * 4 + 1] = index + 1;
			palette[index * 4 + 2] = index + 2;
		}
		const pixels = placesOf(4, 2, 8, (x, y) => (x + y * 2) % 4);
		const data = rawLayer(
			{ version: 102, width: 4, height: 2, bitsPerPixel: 8, palette },
			pixels,
		);
		const header = readGalHeader(data);
		expect(header).toMatchObject({
			version: 102,
			dataOffset: OLD_HEAD_SIZE,
			shuffled: false,
		});
		const image = readBmpImage(await extract(data));
		if (!image) throw new Error("no bitmap");
		expect(image).toMatchObject({ width: 4, height: 2, bitsPerPixel: 8 });
		expect([...image.pixels]).toEqual([0, 1, 2, 3, 2, 3, 0, 1]);
		// The palette of the picture stands of the places of the head of it, four places of a colour.
		expect([...image.palette.subarray(0, 4)]).toEqual([0, 1, 2, 0]);
	});

	it("stands of the counts of the walk of the places of a picture of the engine", async () => {
		// A count of the places of a picture of the engine of no name at all stands of a place of a count of
		// the places of the picture itself, of the counts of the frame of the picture of the engine itself.
		const left = placesOf(
			2,
			2,
			24,
			(x, y, channel) => 0x40 + x * 8 + y * 2 + channel,
		);
		const payload = Buffer.concat([
			word(-1),
			word(0),
			word(-2),
			word(0),
			left.subarray(0, 6),
			left.subarray(8, 14),
		]);
		const data = rawLayer(
			{
				width: 4,
				height: 2,
				bitsPerPixel: 24,
				blockWidth: 2,
				blockHeight: 2,
			},
			payload,
		);
		const image = readBmpImage(await extract(data));
		if (!image) throw new Error("no bitmap");
		const expected: number[] = [];
		for (const row of [left.subarray(0, 6), left.subarray(8, 14)]) {
			// The count of the places of the picture of the engine of the count of the places of the second
			// count of the places of the picture stands of the places of the count of the places of the
			// picture of the engine itself.
			for (const half of [row, row]) {
				for (const place of half) expected.push(place);
			}
		}
		expect([...image.pixels]).toEqual(expected);
	});

	it("stands of the count of the counts of the walk of the engine of the places of a picture", () => {
		// The count of the counts of the engine stands of a generator of its own (`TpRandom`), which stands
		// of the count of the places of the picture: the count of the places of the first count of them
		// stands of the count of the generator of it, and the counts behind it stand of the counts of the
		// places that stand behind them. A count of no places of the walk of the engine at all stands of no
		// count of the counts of it.
		expect(readGalSequence(3, 0)).toEqual([0, 1, 2]);
		expect(readGalSequence(3, 1)).toEqual([1, 0, 2]);
		expect(readGalSequence(4, 1)).toEqual([1, 0, 3, 2]);
		expect(readGalSequence(0, 1)).toEqual([]);
		// A sound of no counts of the places of a picture of the engine at all stands of the counts of the
		// places of the picture itself, which stand of the counts of the walk of the engine of the picture.
		const pixels = placesOf(
			4,
			2,
			24,
			(x, y, channel) => 0x20 + x + y * 0x10 + channel,
		);
		const plain = rawLayer({ width: 4, height: 2, bitsPerPixel: 24 }, pixels);
		const shuffled = rawLayer(
			{ width: 4, height: 2, bitsPerPixel: 24, shuffled: true },
			pixels,
		);
		expect(readGalHeader(shuffled)?.shuffled).toBe(true);
		return Promise.all([extract(plain), extract(shuffled)]).then(
			([first, second]) => {
				expect([...second]).toEqual([...first]);
			},
		);
	});

	it("turns away a head of the counts of the walk of the engine of no picture at all", async () => {
		const pixels = placesOf(4, 2, 24, () => 0);
		const input = {
			width: 4,
			height: 2,
			bitsPerPixel: 24,
			layers: [{ pixels }],
		};
		expect(readGalHeader(Buffer.alloc(11, 0))).toBeUndefined();
		expect(readGalHeader(galFile(input))).toBeDefined();
		expect(readGalHeader(galFile({ ...input, version: 108 }))).toBeUndefined();
		expect(readGalHeader(galFile({ ...input, version: 99 }))).toBeUndefined();
		// The count of the places of the head of the picture of the engine stands of the word of the version
		// of the picture itself as well.
		const wrong = galFile(input);
		wrong.writeInt32LE(106, GREETING_SIZE);
		expect(readGalHeader(wrong)).toBeUndefined();
		expect(
			await livemakerGalImageFormat.detect(
				new BufferByteSource(Buffer.from("NotA", "latin1")),
				"p.gal",
			),
		).toBe(false);
		// A picture of no count of the places of the picture of the engine at all stands of no frame.
		const noLayer = galFile({ ...input, layers: [] });
		expect(readGalPicture(noLayer)).toBeUndefined();
	});

	it("stands of the places of a picture of the engine of the kind of the engine itself unported", async () => {
		const pixels = Buffer.from([1, 2, 3, 4]);
		const data = rawLayer(
			{ width: 4, height: 2, bitsPerPixel: 24, compression: 2 },
			pixels,
		);
		// The reference reads the counts of the head and of the frame of the picture before it stands of the
		// places of it, so a picture of a kind it has not taken stands detected all the same.
		expect(
			await livemakerGalImageFormat.detect(new BufferByteSource(data), "p.gal"),
		).toBe(true);
		const handle = await livemakerGalImageFormat.open(
			new BufferByteSource(data),
			"picture.gal",
		);
		try {
			expect(handle.entries).toHaveLength(1);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			await expect(handle.openEntry(entry.id)).rejects.toThrowError(
				GarbroError,
			);
			await expect(handle.openEntry(entry.id)).rejects.toMatchObject({
				code: "UNSUPPORTED_FEATURE",
			});
		} finally {
			await handle.close();
		}
	});

	it("reads the counts of the places of a picture of the engine of the walk of the engine itself", async () => {
		// The places of the picture of the engine stand of the counts of the walk of the engine of the places
		// of the picture, which stand of the count of the places of the picture of the engine of the engine
		// itself.
		const pixels = placesOf(
			4,
			2,
			24,
			(x, y, channel) => 0x30 + x + y + channel,
		);
		const plain = rawLayer({ width: 4, height: 2, bitsPerPixel: 24 }, pixels);
		const compressed = rawLayer(
			{ width: 4, height: 2, bitsPerPixel: 24, compression: 0 },
			deflateSync(pixels),
		);
		const [first, second] = await Promise.all([
			extract(plain),
			extract(compressed),
		]);
		expect([...second]).toEqual([...first]);
	});
});
