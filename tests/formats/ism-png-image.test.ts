// The pictures of the engine of ISM (GARbro "ArcFormats/Ism/ImagePNG.cs", class PngIsmFormat), against
// pictures built in the test: a picture of the name `.png` stands of the places of the colours of a place of
// the file of it turned over, wherever it stands of thirty two places of a colour.
import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { ismPngFormat, readPngIsmPicture } from "@garbro-mcp/formats";
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
