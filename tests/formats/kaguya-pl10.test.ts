import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { kaguyaPl10Format } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { expectArchive } from "../helpers/archive.js";

const FIRST_FRAME_OFFSET = 0x16;
const FRAME_HEADER_SIZE = 0x14;
const WIDTH = 8;
const HEIGHT = 1;
const DEPTH = 1;
const IMAGE_SIZE = WIDTH * HEIGHT * DEPTH;
const RLE_STEP = 2;

interface PackedFrame {
	rleStep: number;
	stream: Buffer;
	expected: Buffer;
}

/** Builds the head, a raw first frame, and packed frames behind a step byte and a packed size. */
function buildPl10(
	raw: Buffer,
	packed: readonly PackedFrame[],
	depth = DEPTH,
	height = HEIGHT,
): Buffer {
	const parts: Buffer[] = [];
	const head = Buffer.alloc(FIRST_FRAME_OFFSET + FRAME_HEADER_SIZE);
	head.write("PL10", 0, "ascii");
	head.writeInt16LE(1 + packed.length, 4);
	head.writeUInt32LE(WIDTH, FIRST_FRAME_OFFSET + 8);
	head.writeUInt32LE(height, FIRST_FRAME_OFFSET + 0x0c);
	head.writeUInt32LE(depth, FIRST_FRAME_OFFSET + 0x10);
	parts.push(head, raw);
	for (const frame of packed) {
		const header = Buffer.alloc(5);
		header.writeUInt8(frame.rleStep, 0);
		header.writeUInt32LE(frame.stream.length, 1);
		parts.push(header, frame.stream);
	}
	return Buffer.concat(parts);
}

/** A simple run fills the rest of its lane; an extended run always claims at least 128 bytes. */
const SIMPLE_RUN: PackedFrame = {
	rleStep: RLE_STEP,
	stream: Buffer.from([0x11, 0x11, 0x02, 0x22, 0x33, 0x44, 0x55]),
	expected: Buffer.from([0x11, 0x22, 0x11, 0x33, 0x11, 0x44, 0x11, 0x55]),
};

const EXTENDED_RUN: PackedFrame = {
	rleStep: RLE_STEP,
	stream: Buffer.from([0xaa, 0xaa, 0x80, 0x00, 0x11, 0x22, 0x33, 0x44]),
	expected: Buffer.from([0xaa, 0x11, 0xaa, 0x22, 0xaa, 0x33, 0xaa, 0x44]),
};

/** The bitmap a frame of a picture stands of, read back through the matching reader of this project. */
async function placesOfFrame(
	archive: Buffer,
	path: string,
): Promise<{
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: number[];
}> {
	const handle = await kaguyaPl10Format.open(
		new BufferByteSource(archive),
		"anim.plt",
	);
	const entry = handle.entries.find((item) => item.path === path);
	if (!entry) throw new Error(`no frame ${path}`);
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("no bitmap");
	return {
		width: image.width,
		height: image.height,
		bitsPerPixel: image.bitsPerPixel,
		pixels: [...image.pixels],
	};
}

/** The places of a frame of the walk, of the places of the frame before it over the places of its own. */
function accumulated(...deltas: readonly Buffer[]): number[] {
	const sum: number[] = [];
	for (const delta of deltas) {
		for (const [at, place] of [...delta].entries()) {
			sum[at] = ((sum[at] ?? 0) + place) & 0xff;
		}
	}
	return sum;
}

describe("KaGuYa PL10 animation resource", () => {
	it("reads a raw first frame and an RLE packed frame", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildPl10(raw, [SIMPLE_RUN]);
		const handle = await kaguyaPl10Format.open(
			new BufferByteSource(archive),
			"anim.plt",
		);
		expect(
			handle.entries.map((entry) => ({
				path: entry.path,
				size: entry.size,
				compressed: entry.compressed,
			})),
		).toEqual([
			{ path: "anim#00", size: BigInt(IMAGE_SIZE), compressed: false },
			{ path: "anim#01", size: BigInt(IMAGE_SIZE), compressed: true },
		]);
		// The second frame stands of the places of the first frame over the places of its own picture.
		expect(await placesOfFrame(archive, "anim#00")).toMatchObject({
			width: WIDTH,
			height: HEIGHT,
			bitsPerPixel: 8,
			pixels: new Array(IMAGE_SIZE).fill(0x77),
		});
		expect(await placesOfFrame(archive, "anim#01")).toMatchObject({
			pixels: accumulated(raw, SIMPLE_RUN.expected),
		});
	});

	it("decodes an extended run length", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildPl10(raw, [SIMPLE_RUN, EXTENDED_RUN]);
		expect(await placesOfFrame(archive, "anim#02")).toMatchObject({
			pixels: accumulated(raw, SIMPLE_RUN.expected, EXTENDED_RUN.expected),
		});
	});

	it("turns away a frame of a count of places of a colour the engine knows not", async () => {
		// A frame of two places of a colour stands of sixteen places of the file.
		const raw = Buffer.alloc(2 * IMAGE_SIZE, 0x77);
		const archive = buildPl10(raw, [], 2);
		const handle = await kaguyaPl10Format.open(
			new BufferByteSource(archive),
			"anim.plt",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(
			/stands of 2 places of a colour/,
		);
	});

	it("rejects a zero run step", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildPl10(raw, [{ ...SIMPLE_RUN, rleStep: 0 }]);
		await expectArchive({
			format: kaguyaPl10Format,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});

	it("rejects the sibling PL00 signature", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildPl10(raw, []);
		archive.write("PL00", 0, "ascii");
		await expectArchive({
			format: kaguyaPl10Format,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});

	it("rejects a packed frame that runs past the file", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildPl10(raw, [SIMPLE_RUN]);
		// The packed size word sits behind the step byte of the first packed frame.
		const packedSizeOffset =
			FIRST_FRAME_OFFSET + FRAME_HEADER_SIZE + IMAGE_SIZE + 1;
		archive.writeUInt32LE(0x100, packedSizeOffset);
		await expectArchive({
			format: kaguyaPl10Format,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});
});
