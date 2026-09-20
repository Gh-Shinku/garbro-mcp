import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	advizGiz2ImageFormat,
	readGiz2Layout,
} from "../../packages/formats/src/adviz/giz2-image.js";
import { unpackGiz2Picture } from "../../packages/formats/src/adviz/giz2-reader.js";
import { withCompanionFiles } from "../helpers/companion.js";

const HEADER_SIZE = 0x10;
const PALETTE_SIZE = 0x30;
const PLACES_PER_STRIP = 8;

/** The places of the walk of the picture of the test, one strip of eight places by two:
 *  the first record stands as the places of the picture stand them, the second record stands as a run of
 *  places of one value, the third record stands unwalked, and the fourth stands as a run of places of two
 *  values that stand beside each other. */
const WALK = Buffer.from([0x80, 0x40, 0x00, 0x02, 0x06, 0xf0, 0x0f, 0x01]);

/** The places of the picture of the test as they stand behind the head of it. */
function buildPicture(options?: {
	position?: number;
	rleCode?: number;
	planeMap?: number;
	walk?: Buffer;
	widthWords?: number;
	height?: number;
}): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	head.write("GIZ2", 0, "latin1");
	head.writeUInt16LE(options?.position ?? 0, 4);
	head.writeUInt16LE(options?.widthWords ?? 1, 6);
	head.writeUInt16LE(options?.height ?? 2, 8);
	head[0xc] = options?.rleCode ?? 0x00;
	head[0xe] = options?.planeMap ?? 0b0100;
	return Buffer.concat([head, options?.walk ?? WALK]);
}

function groupTable(nameWordField: string, extension: string): Buffer {
	const record = Buffer.alloc(12, 0x00);
	record.write(nameWordField, 0, "latin1");
	record.write(extension, 8, "latin1");
	return record;
}

function paletteTable(): Buffer {
	const palettes = Buffer.alloc(PALETTE_SIZE, 0x00);
	for (let at = 0; at < 16; at += 1) {
		// A place of a palette of this kind stands as one of sixteen of the places of a picture, so the
		// places of the palette of the test stand within the places of a picture of four places.
		palettes[at * 3] = 0x01;
		palettes[at * 3 + 1] = 0x02;
		palettes[at * 3 + 2] = 0x03;
	}
	return palettes;
}

describe("ADVIZ engine image format (GIZ2)", () => {
	it("reads the head of a picture", () => {
		expect(readGiz2Layout(buildPicture(), HEADER_SIZE + WALK.length)).toEqual({
			width: 8,
			height: 2,
			offsetX: 0,
			offsetY: 0,
			rleCode: 0x00,
			planeMap: 0b0100,
		});
	});

	it("reads where a picture stands within a picture of the places of a picture", () => {
		// The words of the head of a picture of this kind name the place of the picture within a picture of
		// the places of a picture of the game, of the places of a picture of eighty places by each of its rows.
		const layout = readGiz2Layout(buildPicture({ position: 0x53 }), 0x20);
		expect(layout?.offsetX).toBe((0x53 % 0x50) * PLACES_PER_STRIP);
		expect(layout?.offsetY).toBe(1);
		expect(
			readGiz2Layout(buildPicture({ position: 0x50 }), 0x20),
		).toMatchObject({
			offsetX: 0,
			offsetY: 1,
		});
	});

	it("turns away a head that names no picture of this kind", () => {
		const wrongMark = Buffer.from(buildPicture());
		wrongMark.write("GIZ3", 0, "latin1");
		expect(readGiz2Layout(wrongMark, wrongMark.length)).toBeUndefined();
		const noPlaces = buildPicture({ widthWords: 0 });
		expect(readGiz2Layout(noPlaces, noPlaces.length)).toBeUndefined();
		expect(readGiz2Layout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("walks the places of a picture into places of a picture of four places", () => {
		// Every place of eight places of a strip of the picture stands as four records of the places of the
		// picture, one after another at the places of the picture that stand above the places behind them.
		expect(
			unpackGiz2Picture(
				buildPicture(),
				readGiz2Layout(buildPicture(), 0x20) ?? ({} as never),
			),
		).toEqual(Buffer.from([0x98, 0x88, 0x00, 0x00, 0x01, 0x00, 0x88, 0x88]));
	});

	it("stands the places of a picture out with the palette of the game it stands in", async () => {
		await withCompanionFiles(
			"pictures/pic.giz",
			{
				"GRP_TBL.SYS": groupTable("PIC ", "GIZ"),
				"PLT_TBL.SYS": paletteTable(),
			},
			async (mainPath) => {
				const handle = await advizGiz2ImageFormat.open(
					new BufferByteSource(buildPicture()),
					mainPath,
				);
				const entry = handle.entries[0];
				if (!entry) throw new Error("no entry");
				const bmp = await consumeBuffer(await handle.openEntry(entry.id));
				expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
				expect(bmp.readUInt16LE(0x1c)).toBe(4);
				expect(bmp.readInt32LE(0x12)).toBe(8);
				// The reference stands the places of a picture of this kind from the first place of it rather
				// than from the last, so the places of the picture stand from the head of it downwards.
				expect(bmp.readInt32LE(0x16)).toBe(-2);
				expect(bmp.readUInt32LE(0x2e)).toBe(16);
				// The first place of a place of the palette stands for the places behind the places of the
				// picture, and every place of the palette stands as one of sixteen of the places of a picture.
				expect(bmp.readUInt8(0x36)).toBe(0x11);
				expect(bmp.readUInt8(0x37)).toBe(0x33);
				expect(bmp.readUInt8(0x38)).toBe(0x22);
				expect(bmp.subarray(0x76)).toEqual(
					Buffer.from([0x98, 0x88, 0x00, 0x00, 0x01, 0x00, 0x88, 0x88]),
				);
			},
		);
	});

	it("turns a picture away where no palette of the game it stands in stands beside it", async () => {
		await withCompanionFiles("pictures/pic.giz", {}, async (mainPath) => {
			const handle = await advizGiz2ImageFormat.open(
				new BufferByteSource(buildPicture()),
				mainPath,
			);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			await expect(handle.openEntry(entry.id)).rejects.toThrow(GarbroError);
		});
	});

	it("is told by the words of the picture", async () => {
		expect(advizGiz2ImageFormat.descriptor.id).toBe("adviz-giz2-image");
		await expect(
			advizGiz2ImageFormat.detect(new BufferByteSource(buildPicture())),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(buildPicture());
		wrongMark.write("GIZ3", 0, "latin1");
		await expect(
			advizGiz2ImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
