// The pictures of the engine of ISM (GARbro "ArcFormats/Ism/ImagePNG.cs", class PngIsmFormat), against
// pictures built in the test: a picture of the name `.png` stands of the places of the colours of a place of
// the file of it turned over, wherever it stands of thirty two places of a colour.
import { Buffer } from "node:buffer";
import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import {
	isaFormat,
	ismPngFormat,
	readPngIsmPicture,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { pngFile } from "../helpers/png.js";
import { buffer as consumeBuffer } from "node:stream/consumers";

describe("ISM engine PNG picture", () => {
	it("reads the places of a picture of thirty two places of a colour, of the place of its colour turned over", async () => {
		// Two places of the picture: the places of the colours stand in the order of the file of a picture
		// of that name (red, green, blue, colour), and the places of the colours of the bitmap stand blue
		// first.
		const file = pngFile({
			width: 2,
			height: 1,
			colourType: 6,
			rows: [[10, 20, 30, 40, 200, 210, 220, 230]],
		});
		const picture = await readPngIsmPicture(file);
		if (!picture) throw new Error("no picture");
		expect(picture.toString("latin1", 0, 2)).toBe("BM");
		expect(picture.readUInt16LE(28)).toBe(32);
		// The place of the colour of every place of the picture stands of the count of the places of a
		// colour of the reference: `40 ^ 0xFF` stands of `215`, and `230 ^ 0xFF` stands of `25`.
		expect([...picture.subarray(54, 62)]).toEqual([
			30, 20, 10, 215, 220, 210, 200, 25,
		]);
	});

	it("reads the places of a picture of twenty four places of a colour as they stand", async () => {
		const file = pngFile({
			width: 2,
			height: 1,
			colourType: 2,
			rows: [[10, 20, 30, 200, 210, 220]],
		});
		const picture = await readPngIsmPicture(file);
		if (!picture) throw new Error("no picture");
		expect(picture.readUInt16LE(28)).toBe(24);
		expect([...picture.subarray(54, 60)]).toEqual([30, 20, 10, 220, 210, 200]);
		// A file of no picture of the name `.png` at all stands of no picture of this format.
		expect(await readPngIsmPicture(Buffer.alloc(0x40, 0x00))).toBeUndefined();
	});

	it("reads the pictures of the name `.png` of an archive of the engine", async () => {
		// An archive of the engine of ISM, of the first layout, with a picture of the name `.png` and a file
		// of another name behind it.
		const picture = pngFile({
			width: 1,
			height: 1,
			colourType: 6,
			rows: [[10, 20, 30, 40]],
		});
		const other = Buffer.from("ISM ", "latin1");
		const nameLength = 0x0c;
		const recordLength = 0x14;
		const recordSize = nameLength + recordLength;
		const dataOffset = 0x10 + recordSize * 2;
		const archive = Buffer.alloc(
			dataOffset + picture.length + other.length,
			0x00,
		);
		archive.write("ISM ", 0, "ascii");
		archive.write("ARCHIVED", 4, "ascii");
		archive.writeInt16LE(2, 0x0c);
		archive.writeUInt16LE(2, 0x0e);
		encodeCp932("picture.png").copy(archive, 0x10);
		archive.writeUInt32LE(dataOffset, 0x10 + nameLength + 4);
		archive.writeUInt32LE(picture.length, 0x10 + nameLength + 8);
		encodeCp932("plain.txt").copy(archive, 0x10 + recordSize);
		archive.writeUInt32LE(
			dataOffset + picture.length,
			0x10 + recordSize + nameLength + 4,
		);
		archive.writeUInt32LE(other.length, 0x10 + recordSize + nameLength + 8);
		picture.copy(archive, dataOffset);
		other.copy(archive, dataOffset + picture.length);
		const source = new BufferByteSource(archive);
		expect(await isaFormat.detect(source, "/tmp/sample.isa")).toBe(true);
		const handle = await isaFormat.open(source, "/tmp/sample.isa");
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"picture.png",
				"plain.txt",
			]);
			// The picture of the name `.png` stands of the walk of that name, of the place of its colour
			// turned over (`40 ^ 0xFF` stands of `215`).
			const drawn = await consumeBuffer(
				await handle.openEntry(handle.entries[0]?.id ?? "0"),
			);
			expect(drawn.toString("latin1", 0, 2)).toBe("BM");
			expect([...drawn.subarray(54, 58)]).toEqual([30, 20, 10, 215]);
			// Every other file of the archive stands as its places stand.
			const plain = await consumeBuffer(
				await handle.openEntry(handle.entries[1]?.id ?? "1"),
			);
			expect(plain.equals(other)).toBe(true);
		} finally {
			await handle.close();
		}
	});

	it("reads the picture of a file of the name `.png` through the format itself", async () => {
		const file = pngFile({
			width: 1,
			height: 1,
			colourType: 6,
			rows: [[1, 2, 3, 4]],
		});
		const source = new BufferByteSource(file);
		expect(await ismPngFormat.detect(source, "/tmp/picture.png")).toBe(true);
		const handle = await ismPngFormat.open(source, "/tmp/picture.png");
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"picture.bmp",
			]);
			const picture = await consumeBuffer(
				await handle.openEntry(handle.entries[0]?.id ?? "0"),
			);
			expect(picture.toString("latin1", 0, 2)).toBe("BM");
		} finally {
			await handle.close();
		}
		const other = new BufferByteSource(Buffer.from("not a picture", "latin1"));
		expect(await ismPngFormat.detect(other, "/tmp/other.png")).toBe(false);
	});
});
