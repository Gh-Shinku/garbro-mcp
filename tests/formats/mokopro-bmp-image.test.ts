import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { mokoProBmpImageFormat } from "../../packages/formats/src/moko-pro/bmp-image.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { encryptMoko } from "../helpers/moko.js";

/** Wraps an encrypted payload in the head of the container. */
function buildNnnn(stream: Buffer, unpackedSize: number): Buffer {
	const header = Buffer.alloc(8, 0x00);
	header.write("NNNN", 0, "latin1");
	header.writeInt32LE(unpackedSize, 4);
	return Buffer.concat([header, encryptMoko(stream)]);
}

/** A bitmap of two places of width and two of height, three places of a colour a place, with padded rows. */
function bitmap(): Buffer {
	const stride = 8;
	const rows = 2;
	const file = Buffer.alloc(54 + stride * rows, 0x00);
	file.write("BM", 0, "latin1");
	file.writeUInt32LE(file.length, 2);
	file.writeUInt32LE(54, 0x0a);
	file.writeUInt32LE(40, 0x0e);
	file.writeInt32LE(2, 0x12);
	file.writeInt32LE(2, 0x16);
	file.writeUInt16LE(1, 0x1a);
	file.writeUInt16LE(24, 0x1c);
	file.writeUInt32LE(0, 0x1e);
	file.writeUInt32LE(stride * rows, 0x22);
	// The first row of the file stands of the last row of the picture.
	const row0 = [0x11, 0x12, 0x13, 0x21, 0x22, 0x23];
	const row1 = [0x31, 0x32, 0x33, 0x41, 0x42, 0x43];
	row0.forEach((byte, at) => {
		file[54 + at] = byte;
	});
	row1.forEach((byte, at) => {
		file[54 + stride + at] = byte;
	});
	return file;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await mokoProBmpImageFormat.open(
		new BufferByteSource(data),
		"picture.dat",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Mokopro compressed bitmap", () => {
	it("unwraps the bitmap behind the walk of runs", async () => {
		const bmp = bitmap();
		const data = buildNnnn(literalLzssStream(bmp), bmp.length);
		const handle = await mokoProBmpImageFormat.open(
			new BufferByteSource(data),
			"picture.dat",
		);
		expect(handle.entries).toHaveLength(1);
		expect(handle.entries[0]).toMatchObject({
			path: "picture.bmp",
			size: BigInt(bmp.length),
			packedSize: BigInt(data.length),
			compressed: true,
			encrypted: true,
			metadata: { type: "image", width: 2, height: 2, bitsPerPixel: 24 },
		});
		expect(handle.metadata).toEqual({ image: "bmp", bitsPerPixel: 24 });
		// The places of the picture stand read and handed over again: an eight bit picture of four colours
		// stands of a bitmap of grey, whose rows stand of the file in the order a bitmap of a whole count
		// names.
		const picture = readBmpImage(await extract(data));
		expect(picture).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
		});
		expect([...(picture?.pixels ?? [])]).toEqual([
			0x31, 0x32, 0x33, 0x41, 0x42, 0x43, 0x11, 0x12, 0x13, 0x21, 0x22, 0x23,
		]);
	});

	it("declines a payload that is not a bitmap", async () => {
		const payload = Buffer.from("not a bitmap at all");
		const data = buildNnnn(literalLzssStream(payload), payload.length);
		expect(
			await mokoProBmpImageFormat.detect(
				new BufferByteSource(data),
				"picture.dat",
			),
		).toBe(false);
		await expect(
			mokoProBmpImageFormat.open(new BufferByteSource(data), "picture.dat"),
		).rejects.toThrow(GarbroError);
		await expect(
			mokoProBmpImageFormat.open(new BufferByteSource(data), "picture.dat"),
		).rejects.toThrow("Not a Mokopro bitmap");
	});

	it("declines a file without the head of the container", async () => {
		const bmp = bitmap();
		const data = buildNnnn(literalLzssStream(bmp), bmp.length);
		data.write("NOPE", 0, "latin1");
		expect(
			await mokoProBmpImageFormat.detect(
				new BufferByteSource(data),
				"picture.dat",
			),
		).toBe(false);
	});

	it("declines a file too short to hold the head", async () => {
		expect(
			await mokoProBmpImageFormat.detect(
				new BufferByteSource(Buffer.alloc(4, 0x00)),
				"picture.dat",
			),
		).toBe(false);
	});
});
