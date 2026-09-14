import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { tigermanChrImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
const TYPE_BGR = 0x1803;
const TYPE_BGRA = 0x2084;
const TYPE_PALETTE = 0x8803;
/** The word the reference also registers, which is the offset its own files keep their picture at. */
const HINT_OFFSET = 0x1b1;

function buildZit(
	type: number,
	width: number,
	height: number,
	body: Buffer,
	colors = 0,
): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("ZT", 0, "latin1");
	header.writeUInt16LE(type, 2);
	header.writeUInt16LE(colors, 4);
	header.writeUInt16LE(width, 8);
	header.writeUInt16LE(height, 10);
	return Buffer.concat([header, body]);
}

/** A compound file: the offsets of the picture, filler, and the picture itself. */
function buildChr(zit: Buffer, baseOffset = 8, length?: number): Buffer {
	const header: Buffer = Buffer.alloc(8, 0x00);
	header.writeUInt32LE(baseOffset, 0);
	header.writeUInt32LE(length ?? zit.length, 4);
	const filler = Buffer.alloc(Math.max(0, baseOffset - 8), 0xee);
	return Buffer.concat([header, filler, zit]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function render(file: Buffer, name = "CG01.chr"): Promise<Buffer> {
	const archive = await tigermanChrImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Tigerman Project compound image", () => {
	it("finds its files by their extension or by the word it registers", async () => {
		const file = buildChr(
			buildZit(TYPE_BGR, 1, 1, Buffer.from([0x10, 0x20, 0x30])),
		);
		for (const name of ["CG01.chr", "CG01.CLS", "EV05.ev"]) {
			expect(await tigermanChrImageFormat.detect(sourceOf(file), name)).toBe(
				true,
			);
		}
		// A file without the extension is offered all the same when it begins with the word the reference
		// registers, which is the offset its own files keep the picture at.
		const hinted = buildChr(
			buildZit(TYPE_BGR, 1, 1, Buffer.from([0x10, 0x20, 0x30])),
			HINT_OFFSET,
		);
		expect(hinted.readUInt32LE(0)).toBe(HINT_OFFSET);
		expect(
			await tigermanChrImageFormat.detect(sourceOf(hinted), "data.bin"),
		).toBe(true);
		// A file of another extension whose picture is elsewhere is not offered at all.
		const plain = buildChr(
			buildZit(TYPE_BGR, 1, 1, Buffer.from([0x10, 0x20, 0x30])),
			0x40,
		);
		expect(
			await tigermanChrImageFormat.detect(sourceOf(plain), "data.bin"),
		).toBe(false);
		// The picture behind the offsets has to be one the other reader knows.
		expect(
			await tigermanChrImageFormat.detect(
				sourceOf(Buffer.alloc(0x40)),
				"CG01.chr",
			),
		).toBe(false);
	});

	it("holds both of its offsets to the size of the file", async () => {
		const many = buildChr(
			buildZit(TYPE_BGR, 1, 1, Buffer.from([0x10, 0x20, 0x30])),
		);
		// An offset at the very end of the file is no offset.
		const atEnd = Buffer.from(many);
		atEnd.writeUInt32LE(many.length, 0);
		expect(await tigermanChrImageFormat.detect(sourceOf(atEnd), "a.chr")).toBe(
			false,
		);
		// A length reaching past the file is refused, in full rather than in the arithmetic the reference's
		// own thirty-two bit sum would wrap around.
		const overflowing = Buffer.from(many);
		overflowing.writeUInt32LE(0xfffffff0, 0);
		overflowing.writeUInt32LE(0x20, 4);
		expect(
			await tigermanChrImageFormat.detect(sourceOf(overflowing), "a.chr"),
		).toBe(false);
	});

	it("reads the picture the offsets point at, and nothing in front of it", async () => {
		const body = Buffer.from([0x10, 0x20, 0x30, 0x00, 0xff, 0x00]);
		const file = buildChr(buildZit(TYPE_BGR, 2, 1, body), 0x40);
		const archive = await tigermanChrImageFormat.open(
			sourceOf(file),
			"CG01.chr",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 1,
				bitsPerPixel: 32,
				imageType: TYPE_BGR,
				colors: 0,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 2,
				height: 1,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
		const output = await render(file);
		expect(output.readUInt16LE(28)).toBe(32);
		// `ImageData.Create` with no flip, so the height is negative.
		expect(output.readInt32LE(22)).toBe(-1);
		expect(output.subarray(54, 58)).toEqual(
			Buffer.from([0x10, 0x20, 0x30, 0xff]),
		);
		expect(output.subarray(58, 62)).toEqual(
			Buffer.from([0xff, 0xff, 0x00, 0x00]),
		);
	});

	it("carries a picture of the two other kinds as well", async () => {
		// Four byte pixels are copied as they stand.
		const straight = buildChr(
			buildZit(TYPE_BGRA, 1, 1, Buffer.from([1, 2, 3, 4])),
		);
		expect((await render(straight)).subarray(54, 58)).toEqual(
			Buffer.from([1, 2, 3, 4]),
		);
		// A palette picture takes its colours from the table in the picture and packs its own key word.
		const palette = buildZit(
			TYPE_PALETTE,
			2,
			1,
			Buffer.concat([
				Buffer.from([0x10, 0x20, 0x30, 0x00, 0xff, 0x00]),
				Buffer.from([0, 1]),
			]),
			2,
		);
		const output = await render(buildChr(palette));
		expect(output.subarray(54, 58)).toEqual(
			Buffer.from([0x10, 0x20, 0x30, 0xff]),
		);
		expect(output.subarray(58, 62)).toEqual(
			Buffer.from([0x00, 0xff, 0x00, 0x00]),
		);
	});

	it("stops when the picture the offsets name is cut short", async () => {
		const zit = buildZit(TYPE_BGR, 2, 2, Buffer.alloc(12, 0x11));
		// The header of the picture fits in the region, but the pixels behind it do not.
		const file = buildChr(zit, 8, HEADER_SIZE + 4);
		const archive = await tigermanChrImageFormat.open(
			sourceOf(file),
			"CG01.chr",
		);
		try {
			expect(archive.entries[0]?.size).toBe(BigInt(HEADER_SIZE + 4));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Silky's image is truncated",
			});
		} finally {
			await archive.close();
		}
	});
});
