import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	hexenhausImgdImageFormat,
	readImgdLayout,
} from "../../packages/formats/src/hexenhaus/imgd-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { PNG_SIGNATURE } from "../../packages/formats/src/shared/png.js";
import { pngFile } from "../helpers/png.js";

const HEAD_SIZE = 0x10;

/** The places of a portable network graphic of four and twenty places by four and twenty, which stand behind
 * the words of the head of the picture of the test. */
function png(): Buffer {
	const body = Buffer.alloc(0x30, 0x00);
	PNG_SIGNATURE.copy(body, 0);
	body.writeUInt32BE(0x0d, 8);
	body.write("IHDR", 12, "latin1");
	body.writeUInt32BE(0x18, 16);
	body.writeUInt32BE(0x18, 20);
	body[24] = 8;
	body[25] = 6;
	return body;
}

function buildPicture(withTrailer = true): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("IMGD", 0, "latin1");
	if (!withTrailer) return Buffer.concat([head, png()]);
	const trailer = Buffer.alloc(12, 0x00);
	trailer.write("CNTR", 0, "latin1");
	trailer.writeInt32LE(7, 4);
	trailer.writeInt32LE(9, 8);
	return Buffer.concat([head, png(), trailer, Buffer.alloc(2, 0x00)]);
}

/** A complete portable network graphic of the counts the caller names, of four places of a colour. */
function completePng(
	width: number,
	height: number,
	rows: readonly (readonly number[])[],
): Buffer {
	return pngFile({ width, height, colourType: 6, rows });
}

/** A picture of the game whose places stand of a complete graphic behind the words of its head. */
function buildCompletePicture(withTrailer = false): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("IMGD", 0, "latin1");
	const graphic = completePng(2, 1, [[10, 20, 30, 255, 40, 50, 60, 255]]);
	if (!withTrailer) return Buffer.concat([head, graphic]);
	const trailer = Buffer.alloc(12, 0x00);
	trailer.write("CNTR", 0, "latin1");
	trailer.writeInt32LE(3, 4);
	trailer.writeInt32LE(4, 8);
	// The words of the trailer stand twelve places before the end of the file, which the reference stands of.
	return Buffer.concat([head, graphic, trailer, Buffer.alloc(2, 0x00)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await hexenhausImgdImageFormat.open(
		new BufferByteSource(data),
		"picture.png",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("WAG archive PNG image", () => {
	it("reads the head of a picture", () => {
		expect(readImgdLayout(buildPicture(), buildPicture().length)).toEqual({
			width: 0x18,
			height: 0x18,
			bitsPerPixel: 32,
			offsetX: 7,
			offsetY: 9,
			pictureOffset: HEAD_SIZE,
		});
	});

	it("reads a picture whose places name no place within a picture of the game", () => {
		const data = buildPicture(false);
		expect(readImgdLayout(data, data.length)).toMatchObject({
			offsetX: 0,
			offsetY: 0,
		});
	});

	it("turns away a head that names no picture", () => {
		const wrongMark = Buffer.from(buildPicture());
		wrongMark.write("IMGE", 0, "latin1");
		expect(readImgdLayout(wrongMark, wrongMark.length)).toBeUndefined();
		const noPng = Buffer.from(buildPicture());
		noPng.writeUInt8(0x00, HEAD_SIZE);
		expect(readImgdLayout(noPng, noPng.length)).toBeUndefined();
		expect(readImgdLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("reads the places of the picture behind the words of its head", async () => {
		const data = buildCompletePicture();
		const out = await extract(data);
		// The places of a picture of four places of a colour stand of the same places in a bitmap of four.
		const picture = readBmpImage(out);
		expect(picture).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
		expect([...(picture?.pixels ?? [])]).toEqual([
			30, 20, 10, 255, 60, 50, 40, 255,
		]);
	});

	it("reads the places of a picture whose head names a place within a picture of the game", async () => {
		const data = buildCompletePicture(true);
		const handle = await hexenhausImgdImageFormat.open(
			new BufferByteSource(data),
			"picture.png",
		);
		expect(handle.entries[0]?.path).toBe("picture.png");
		expect(handle.metadata).toMatchObject({
			image: "png",
			width: 2,
			height: 1,
			offsetX: 3,
			offsetY: 4,
		});
		// The places of the picture stand behind the words the head names, the words of the trailer standing
		// behind the picture itself.
		expect(await extract(data)).toEqual(await extract(buildCompletePicture()));
	});

	it("turns a picture cut short of its places away", async () => {
		const cut = Buffer.from(buildPicture().subarray(0, HEAD_SIZE + 8));
		await expect(extract(cut)).rejects.toThrow(GarbroError);
	});

	it("is told by the words of the picture", async () => {
		expect(hexenhausImgdImageFormat.descriptor.id).toBe("hexenhaus-imgd-image");
		expect(hexenhausImgdImageFormat.detection).toEqual({
			signatures: [{ bytes: Buffer.from("IMGD", "latin1") }],
		});
		await expect(
			hexenhausImgdImageFormat.detect(new BufferByteSource(buildPicture())),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(buildPicture());
		wrongMark.write("IMGE", 0, "latin1");
		await expect(
			hexenhausImgdImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
