import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { kaguyaAn21Format } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { expectArchive } from "../helpers/archive.js";

const WIDTH = 8;
const HEIGHT = 1;
const CHANNELS = 1;
const IMAGE_SIZE = WIDTH * HEIGHT * CHANNELS;
const RLE_STEP = 2;
const MARKER = "[PIC]10";
const FRAME_COUNT_GAP = 0x12;
const FRAME_HEADER_SIZE = 0x14;

interface Table {
	type: number;
	payload: number;
}

interface Options {
	tables?: readonly Table[];
	marker?: string;
	rleStep?: number;
	/** How many frames the picture stands of; a picture of one frame stands of no packed frame. */
	frames?: number;
	width?: number;
	height?: number;
	channels?: number;
}

/**
 * Builds the preamble (tables, a counted name table and the marker), the frame count with its gap, the
 * information block, a raw first frame and one packed frame.
 */
function buildAn21(raw: Buffer, stream: Buffer, options: Options = {}): Buffer {
	const tables = options.tables ?? [
		{ type: 1, payload: 8 },
		{ type: 3, payload: 4 },
	];
	const parts: Buffer[] = [];
	parts.push(Buffer.from("AN21", "ascii"));
	const count = Buffer.alloc(2);
	count.writeUInt16LE(tables.length, 0);
	// The table records start at 8, so two bytes sit between the count and the first record.
	parts.push(count, Buffer.alloc(2));
	for (const table of tables) {
		parts.push(Buffer.from([table.type]), Buffer.alloc(table.payload));
	}
	const names = Buffer.alloc(2);
	parts.push(names);
	parts.push(Buffer.from(options.marker ?? MARKER, "latin1"));
	const frameCount = Buffer.alloc(2);
	frameCount.writeInt16LE(options.frames ?? 2, 0);
	// The reference steps 0x12 past the frame count's own position, so its two bytes are part of that gap.
	parts.push(frameCount, Buffer.alloc(FRAME_COUNT_GAP - 2));
	const info = Buffer.alloc(FRAME_HEADER_SIZE);
	info.writeUInt32LE(options.width ?? WIDTH, 8);
	info.writeUInt32LE(options.height ?? HEIGHT, 0x0c);
	info.writeInt32LE(options.channels ?? CHANNELS, 0x10);
	parts.push(info, raw);
	if (1 === (options.frames ?? 2)) return Buffer.concat(parts);
	const header = Buffer.alloc(5);
	header.writeUInt8(options.rleStep ?? RLE_STEP, 0);
	header.writeUInt32LE(stream.length, 1);
	parts.push(header, stream);
	return Buffer.concat(parts);
}

const STREAM = Buffer.from([0x11, 0x11, 0x02, 0x22, 0x33, 0x44, 0x55]);
const EXPECTED = Buffer.from([0x11, 0x22, 0x11, 0x33, 0x11, 0x44, 0x11, 0x55]);

/** The bitmap a frame of a picture stands of, read back through the matching reader of this project. */
async function placesOfFrame(
	archive: Buffer,
	path: string,
): Promise<{
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: number[];
	palette: number[];
}> {
	const handle = await kaguyaAn21Format.open(
		new BufferByteSource(archive),
		"anim.anm",
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
		palette: [...image.palette],
	};
}

describe("KaGuYa AN21 animation resource", () => {
	it("walks the preamble tables and reads a raw and a packed frame", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildAn21(raw, STREAM);
		const handle = await kaguyaAn21Format.open(
			new BufferByteSource(archive),
			"anim.anm",
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
		const second = [...EXPECTED].map((place) => (place + 0x77) & 0xff);
		expect(await placesOfFrame(archive, "anim#01")).toMatchObject({
			pixels: second,
		});
	});

	it("reads the picture of a frame of three places of a colour, of the rows of it turned over", async () => {
		// Two rows of eight pixels of three places of a colour, the last row of the file standing first.
		const raw = Buffer.alloc(48);
		for (let place = 0; place < 48; place += 1) raw[place] = place & 0xff;
		const archive = buildAn21(raw, Buffer.alloc(0), {
			frames: 1,
			width: 8,
			height: 2,
			channels: 3,
		});
		const picture = await placesOfFrame(archive, "anim#00");
		expect(picture).toMatchObject({
			width: 8,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(picture.pixels.slice(0, 24)).toEqual([...raw.subarray(24, 48)]);
		expect(picture.pixels.slice(24, 48)).toEqual([...raw.subarray(0, 24)]);
	});

	it("turns away a frame whose places of the file stand of a different count", async () => {
		// The unpacked count of a packed frame stands of the place of the picture of the file itself, so a
		// picture whose place stands of a count stands of frames of different counts.
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildAn21(raw, STREAM);
		// The place of the picture of the file itself stands at the head of the information block, which
		// begins behind the marker, the frame count and its gap.
		const infoOffset =
			archive.indexOf(Buffer.from(MARKER, "latin1")) +
			MARKER.length +
			2 +
			FRAME_COUNT_GAP;
		archive.writeInt32LE(4, infoOffset);
		const handle = await kaguyaAn21Format.open(
			new BufferByteSource(archive),
			"anim.anm",
		);
		const entry = handle.entries[1];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(
			/places of the file/,
		);
	});

	it("rejects an unknown table type", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildAn21(raw, STREAM, {
			tables: [{ type: 6, payload: 4 }],
		});
		await expectArchive({
			format: kaguyaAn21Format,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});

	it("rejects a missing marker", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildAn21(raw, STREAM, { marker: "[PIC]11" });
		await expectArchive({
			format: kaguyaAn21Format,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});

	it("rejects a zero run step", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildAn21(raw, STREAM, { rleStep: 0 });
		await expectArchive({
			format: kaguyaAn21Format,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});

	it("rejects a foreign signature", async () => {
		const raw = Buffer.alloc(IMAGE_SIZE, 0x77);
		const archive = buildAn21(raw, STREAM);
		archive.write("AN20", 0, "ascii");
		await expectArchive({
			format: kaguyaAn21Format,
			archive,
			sourcePath: "anim.anm",
			detected: false,
			entries: [],
		});
	});
});
