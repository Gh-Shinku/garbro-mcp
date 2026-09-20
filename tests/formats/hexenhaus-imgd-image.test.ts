import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	hexenhausImgdImageFormat,
	readImgdLayout,
} from "../../packages/formats/src/hexenhaus/imgd-image.js";
import {
	PNG_SIGNATURE,
	readPngHeaderFields,
} from "../../packages/formats/src/shared/png.js";

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

	it("hands the places of the picture out as they stand", async () => {
		const data = buildPicture();
		const out = await extract(data);
		// The reference hands the places behind the words of its own head to the reader of the pictures of the
		// kind this one stands as, which this project reads no places of.
		expect(out.subarray(0, 8)).toEqual(PNG_SIGNATURE);
		expect(readPngHeaderFields(out)).toEqual({
			width: 0x18,
			height: 0x18,
			bitsPerPixel: 32,
		});
		const handle = await hexenhausImgdImageFormat.open(
			new BufferByteSource(data),
			"picture.png",
		);
		expect(handle.entries[0]?.path).toBe("picture.png");
		expect(handle.metadata).toMatchObject({
			image: "png",
			width: 0x18,
			height: 0x18,
			offsetX: 7,
			offsetY: 9,
		});
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
