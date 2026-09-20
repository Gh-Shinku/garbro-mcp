import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodeTsz,
	ponytailTszImageFormat,
	readTszLayout,
	readTszPalette,
} from "../../packages/formats/src/ponytail/tsz-image.js";

/** A Ponytail Soft picture: its head, its colours, and the run of places in front of every step of its walk
 * with the places themselves standing behind them. */
function tszFile(input: {
	width: number;
	height: number;
	/** The places of the line buffer, one word apiece, one step of the walk apiece. */
	words: number[];
	/** The way of a step, three places apiece: `[1, 1, 0]` stands for a word read out of the file. */
	steps?: number[][];
	colors?: number[][];
	version?: string;
	body?: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x40, 0x00);
	head.write("NMI ", 0, "latin1");
	head.write(input.version ?? "2.05", 4, "latin1");
	head.writeUInt16LE(input.width >> 2, 0x0c);
	head.writeUInt16LE(input.height, 0x0e);
	for (let entry = 0; entry < 16; entry += 1) {
		const color = input.colors?.[entry] ?? [0, 0, 0];
		head[0x10 + entry * 3] = color[0] ?? 0;
		head[0x10 + entry * 3 + 1] = color[1] ?? 0;
		head[0x10 + entry * 3 + 2] = color[2] ?? 0;
	}
	const steps: number[][] =
		input.steps ??
		input.words.map(() => {
			return [1, 1, 0];
		});
	const places = steps.flat();
	const first = Buffer.alloc(2, 0x00);
	let word = 0;
	for (let at = 0; at < 16; at += 1) {
		word = ((word << 1) | (places[at] ?? 0)) & 0xffff;
	}
	first.writeUInt16LE(word, 0);
	const words = Buffer.alloc(input.words.length * 2, 0x00);
	for (let at = 0; at < input.words.length; at += 1) {
		words.writeUInt16LE(input.words[at] ?? 0, at * 2);
	}
	return Buffer.concat([head, first, words, input.body ?? Buffer.alloc(0)]);
}

const COLORS: number[][] = Array.from({ length: 16 }, (_, entry) => {
	return [entry, entry, entry];
});
COLORS[3] = [0x0f, 0x08, 0x04];

/** The picture the walk of the tests stands in: four words of the line buffer. */
const PICTURE = {
	width: 8,
	height: 2,
	words: [0x1234, 0x5678, 0x9abc, 0xdef0],
	colors: COLORS,
};

/** The places the walk of the tests gathers, worked out with an independent transcription of the reference's
 * own walk: the line buffer holds the two columns of a pair half a buffer apart, and the places of a pair of
 * columns stand in the four bytes of a row. */
const GATHERED = Buffer.from("016af16a1e6aee6a", "hex");

describe("Ponytail Soft NMI picture", () => {
	it("reads the head of a picture", () => {
		const file = tszFile(PICTURE);
		const layout = readTszLayout(file);
		expect(layout).toEqual({
			width: 8,
			height: 2,
			stride: 4,
			groups: 2,
		});
	});

	it("turns away a file whose head does not hold its word", () => {
		expect(
			readTszLayout(tszFile({ ...PICTURE, version: "2.5\0" })),
		).toBeUndefined();
		expect(
			readTszLayout(Buffer.concat([Buffer.from("XYZ "), Buffer.alloc(0x20)])),
		).toBeUndefined();
		expect(readTszLayout(Buffer.alloc(8))).toBeUndefined();
	});

	it("turns away a picture of no places", () => {
		expect(readTszLayout(tszFile({ ...PICTURE, width: 0 }))).toBeUndefined();
		expect(readTszLayout(tszFile({ ...PICTURE, height: 0 }))).toBeUndefined();
	});

	it("reads the colours of a picture", () => {
		const palette = readTszPalette(tszFile(PICTURE));
		expect([...palette.subarray(0, 12)]).toEqual([
			0x00, 0x00, 0x00, 0x11, 0x11, 0x11, 0x22, 0x22, 0x22, 0xff, 0x88, 0x44,
		]);
		expect(palette.length).toBe(48);
	});

	it("gathers the places of a picture out of its line buffer", () => {
		const file = tszFile(PICTURE);
		const layout = readTszLayout(file);
		if (!layout) throw new Error("the picture stands in the file");
		expect(decodeTsz(file, layout).subarray(0x76, 0x7e)).toEqual(GATHERED);
	});

	/** A picture whose walk takes every way it knows, with the places behind the ways an independent
	 * transcription of the reference's own walk is made to stand over. */
	const COMPOSED = Buffer.from(
		"4e4d4920322e30350000000002000800000000111111222222333333444444555555" +
			"666666777777888888999999aaaaaabbbbbbccccccddddddeeeeeeffffff76db0f0f" +
			"3333ff002375e9d45a8000b87f7f",
		"hex",
	);
	const COMPOSED_PLACES = Buffer.from(
		"5555555500ff00ff33333a3a5555555500ff00ff33333a3a5555555500ff5fff",
		"hex",
	);

	it("takes every way its walk knows", () => {
		const layout = readTszLayout(COMPOSED);
		if (!layout) throw new Error("the picture stands in the file");
		expect(layout).toEqual({
			width: 8,
			height: 8,
			stride: 4,
			groups: 2,
		});
		expect(decodeTsz(COMPOSED, layout).subarray(0x76, 0x76 + 64)).toEqual(
			COMPOSED_PLACES,
		);
	});

	it("takes the picture an archive hands out", async () => {
		const file = tszFile(PICTURE);
		const handle = await ponytailTszImageFormat.open(
			new BufferByteSource(file),
			"picture.nmi",
		);
		expect(handle.entries.length).toBe(1);
		expect(handle.entries[0]?.path).toBe("picture.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 8,
			height: 2,
			bitsPerPixel: 4,
		});
		const body = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(body.readUInt32LE(0x0a)).toBe(0x76);
		expect(body.readUInt32LE(0x12)).toBe(8);
		expect(body.readInt32LE(0x16)).toBe(-2);
		expect(body.readUInt16LE(0x1c)).toBe(4);
		expect(body.readUInt32LE(0x2e)).toBe(16);
		expect(body.subarray(0x76, 0x7e)).toEqual(GATHERED);
	});

	it("registers a picture of four bits", () => {
		expect(ponytailTszImageFormat.descriptor.id).toBe("ponytail-tsz-image");
		expect(ponytailTszImageFormat.descriptor.capabilities.extract).toBe(true);
	});

	it("turns away a file that does not hold a picture", async () => {
		const source = new BufferByteSource(Buffer.from("not a picture at all"));
		await expect(
			ponytailTszImageFormat.open(source, "picture.nmi"),
		).rejects.toThrow();
	});
});
