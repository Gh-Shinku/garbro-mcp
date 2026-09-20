import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	advizBizImageFormat,
	readBizLayout,
	unpackBizPicture,
} from "../../packages/formats/src/adviz/biz-image.js";
import { readAdvizPalette } from "../../packages/formats/src/adviz/palette.js";
import { withCompanionFiles } from "../helpers/companion.js";

const HEAD_SIZE = 4;
const WALK_START = 0x39;
const PALETTE_SIZE = 0x300;
const PALETTE_PLACES = 0x100;

const PLACES = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0xff, 0x7f, 0x10]);

function storePlaces(places: Buffer): Buffer {
	const stored = Buffer.alloc(places.length);
	let walk = WALK_START;
	for (let at = 0; at < places.length; at += 1) {
		const place = places[at] ?? 0;
		stored[at] = place ^ walk;
		walk = (walk + place) & 0xff;
	}
	return stored;
}

function buildPicture(width = 4, height = 2, places = PLACES): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.writeUInt16LE(width, 0);
	head.writeUInt16LE(height, 2);
	return Buffer.concat([head, storePlaces(places)]);
}

function groupTable(nameWordField: string, extension: string): Buffer {
	const record = Buffer.alloc(12, 0x00);
	record.write(nameWordField, 0, "latin1");
	record.write(extension, 8, "latin1");
	return record;
}

/** The table of palettes: one palette of two hundred and fifty-six places of three places each. */
function paletteTable(): Buffer {
	const palettes = Buffer.alloc(PALETTE_SIZE);
	for (let at = 0; at < PALETTE_PLACES; at += 1) {
		palettes[at * 3] = at;
		palettes[at * 3 + 1] = 0x11;
		palettes[at * 3 + 2] = 0x22;
	}
	return palettes;
}

describe("ADVIZ engine image format", () => {
	it("reads the head of a picture", () => {
		expect(readBizLayout(buildPicture(), HEAD_SIZE + PLACES.length)).toEqual({
			width: 4,
			height: 2,
		});
	});

	it("turns away a picture whose places do not stand for it", () => {
		const short = Buffer.concat([
			buildPicture().subarray(0, HEAD_SIZE),
			Buffer.alloc(7),
		]);
		expect(readBizLayout(short, short.length)).toBeUndefined();
		const wide = buildPicture(4, 3);
		expect(readBizLayout(wide, wide.length)).toBeUndefined();
		expect(readBizLayout(Buffer.alloc(2), 2)).toBeUndefined();
	});

	it("walks the places of a picture with the place of the walk of it", () => {
		expect(unpackBizPicture(buildPicture(), { width: 4, height: 2 })).toEqual(
			PLACES,
		);
	});

	it("reads the palette of a picture from the table of palettes of the engine", async () => {
		await withCompanionFiles(
			"pictures/pic.biz",
			{
				"GRP_TBL.SYS": groupTable("PIC ", "BIZ"),
				"PLT_TBL.SYS": paletteTable(),
			},
			async (mainPath) => {
				const palette = await readAdvizPalette(
					mainPath,
					PALETTE_SIZE,
					(data, offset) => data.subarray(offset, offset + PALETTE_SIZE),
				);
				expect(palette?.index).toBe(0);
				expect(palette?.colors.readUInt8(0)).toBe(0x00);
			},
		);
	});

	it("stands the places of a picture out with the palette of the game it stands in", async () => {
		await withCompanionFiles(
			"pictures/pic.biz",
			{
				"GRP_TBL.SYS": groupTable("PIC ", "BIZ"),
				"PLT_TBL.SYS": paletteTable(),
			},
			async (mainPath) => {
				const data = buildPicture();
				const handle = await advizBizImageFormat.open(
					new BufferByteSource(data),
					mainPath,
				);
				const entry = handle.entries[0];
				if (!entry) throw new Error("no entry");
				const bmp = await consumeBuffer(await handle.openEntry(entry.id));
				expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
				expect(bmp.readUInt16LE(0x1c)).toBe(8);
				expect(bmp.readInt32LE(0x12)).toBe(4);
				expect(bmp.readInt32LE(0x16)).toBe(2);
				expect(bmp.readUInt32LE(0x2e)).toBe(PALETTE_PLACES);
				expect(bmp.readUInt8(0x36)).toBe(0x22);
				expect(bmp.readUInt8(0x37)).toBe(0x11);
				expect(bmp.readUInt8(0x38)).toBe(0x00);
				// The place of the third place of the palette: a place of the palette stands in four places.
				expect(bmp.readUInt8(0x36 + 12)).toBe(0x22);
				expect(bmp.readUInt8(0x36 + 13)).toBe(0x11);
				expect(bmp.readUInt8(0x36 + 14)).toBe(0x03);
				expect(bmp.subarray(0x436)).toEqual(PLACES);
			},
		);
	});

	it("turns a picture away where no palette of the game it stands in stands beside it", async () => {
		await withCompanionFiles("pictures/pic.biz", {}, async (mainPath) => {
			const data = buildPicture();
			const handle = await advizBizImageFormat.open(
				new BufferByteSource(data),
				mainPath,
			);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			await expect(handle.openEntry(entry.id)).rejects.toThrow(GarbroError);
		});
	});

	it("is told by the words of the file it stands in", async () => {
		expect(advizBizImageFormat.descriptor.id).toBe("adviz-biz-image");
		await expect(
			advizBizImageFormat.detect(
				new BufferByteSource(buildPicture()),
				"pictures/pic.biz",
			),
		).resolves.toBe(true);
		await expect(
			advizBizImageFormat.detect(
				new BufferByteSource(buildPicture()),
				"pictures/pic.bin",
			),
		).resolves.toBe(false);
	});
});
