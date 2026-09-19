import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	brunsEencImageFormat,
	decryptEenc,
	readEencLayout,
	readEencPicture,
} from "../../packages/formats/src/bruns/eenc-image.js";

const EENC_KEY = 0xdeadbeef;

/** A Bruns picture: the word, the word it stands over and the picture behind the walk of bytes. */
function eencFile(input: {
	payload: Buffer;
	key: number;
	compressed?: boolean;
	word?: string;
}): Buffer {
	const head = Buffer.alloc(8, 0x00);
	head.write(input.word ?? (input.compressed ? "EENZ" : "EENC"), 0, "latin1");
	head.writeUInt32LE((input.key ^ EENC_KEY) >>> 0, 4);
	return Buffer.concat([head, decryptEenc(input.payload, input.key)]);
}

/** A bitmap of two places of width and two of height, one byte a place, with its rows padded. */
function bitmap(): Buffer {
	const stride = 4;
	const rows = 2;
	const file = Buffer.alloc(54 + stride * rows, 0x00);
	file.write("BM", 0, "latin1");
	file.writeUInt32LE(file.length, 2);
	file.writeUInt32LE(54, 0x0a);
	file.writeUInt32LE(40, 0x0e);
	file.writeInt32LE(2, 0x12);
	file.writeInt32LE(2, 0x16);
	file.writeUInt16LE(1, 0x1a);
	file.writeUInt16LE(8, 0x1c);
	file.writeUInt32LE(stride * rows, 0x22);
	file[54] = 0x01;
	file[58] = 0x02;
	return file;
}

/** A portable network graphic of four places of width and three of height. */
function pngImage(): Buffer {
	const file = Buffer.alloc(16 + 13 + 4, 0x00);
	file.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
	file.writeUInt32BE(13, 8);
	file.write("IHDR", 12, "latin1");
	file.writeUInt32BE(4, 16);
	file.writeUInt32BE(3, 20);
	file[24] = 8;
	file[25] = 2;
	return file;
}

async function open(source: Buffer, sourcePath = "picture.png") {
	const handle = await brunsEencImageFormat.open(
		new BufferByteSource(source),
		sourcePath,
	);
	return handle;
}

describe("Bruns system encrypted image", () => {
	it("reads the word and the key of a picture", () => {
		expect(
			readEencLayout(eencFile({ payload: bitmap(), key: 0x12345678 })),
		).toMatchObject({ compressed: false, key: 0x12345678 });
		expect(
			readEencLayout(
				eencFile({ payload: bitmap(), key: 0x12345678, compressed: true }),
			),
		).toMatchObject({ compressed: true, key: 0x12345678 });
		const other = eencFile({ payload: bitmap(), key: 1, word: "EEND" });
		expect(readEencLayout(other)).toBeUndefined();
		expect(readEencLayout(Buffer.alloc(4, 0x00))).toBeUndefined();
	});

	it("stands every byte over a byte of its key", () => {
		// The four bytes of the key stand over and over from the lowest of them.
		expect(decryptEenc(Buffer.alloc(6, 0x00), 0x11223344).toString("hex")).toBe(
			hex([0x44, 0x33, 0x22, 0x11, 0x44, 0x33]),
		);
		// The walk is a walk of bytes over the key alone, so it undoes itself.
		const payload = bitmap();
		expect(decryptEenc(decryptEenc(payload, 0x99), 0x99).equals(payload)).toBe(
			true,
		);
	});

	it("reads the picture behind the walk of bytes", () => {
		expect(readEencPicture(bitmap())).toEqual({
			extension: "bmp",
			width: 2,
			height: 2,
			bitsPerPixel: 8,
		});
		expect(readEencPicture(pngImage())).toEqual({
			extension: "png",
			width: 4,
			height: 3,
			bitsPerPixel: 24,
		});
		expect(readEencPicture(Buffer.from("neither"))).toBeUndefined();
	});

	it("unwraps a bitmap", async () => {
		const bmp = bitmap();
		const data = eencFile({ payload: bmp, key: 0x0badf00d });
		const handle = await open(data, "picture.brs");
		expect(handle.entries).toHaveLength(1);
		expect(handle.entries[0]).toMatchObject({
			path: "picture.bmp",
			size: BigInt(data.length - 8),
			compressed: true,
			encrypted: true,
			metadata: { type: "image", width: 2, height: 2, bitsPerPixel: 8 },
		});
		expect(handle.metadata).toEqual({ image: "bmp", bitsPerPixel: 8 });
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(
			(await consumeBuffer(await handle.openEntry(entry.id))).equals(bmp),
		).toBe(true);
	});

	it("unwraps a packet of the zlib kind", async () => {
		const bmp = bitmap();
		const data = eencFile({
			payload: deflateSync(bmp),
			key: 0x0badf00d,
			compressed: true,
		});
		const handle = await open(data, "picture.brs");
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(
			(await consumeBuffer(await handle.openEntry(entry.id))).equals(bmp),
		).toBe(true);
	});

	it("unwraps a portable network graphic", async () => {
		const png = pngImage();
		const data = eencFile({ payload: png, key: 7 });
		const handle = await open(data, "picture.brs");
		expect(handle.entries[0]).toMatchObject({
			path: "picture.png",
			metadata: { width: 4, height: 3, bitsPerPixel: 24 },
		});
		expect(handle.metadata).toEqual({ image: "png", bitsPerPixel: 24 });
	});

	it("declines a file that holds no picture this project reads", async () => {
		const data = eencFile({ payload: Buffer.from("neither"), key: 7 });
		expect(
			await brunsEencImageFormat.detect(
				new BufferByteSource(data),
				"picture.brs",
			),
		).toBe(false);
		await expect(
			brunsEencImageFormat.open(new BufferByteSource(data), "picture.brs"),
		).rejects.toThrow(GarbroError);
		await expect(
			brunsEencImageFormat.open(new BufferByteSource(data), "picture.brs"),
		).rejects.toThrow("Not a Bruns picture");
	});

	it("declines a file of the wrong word", async () => {
		const data = eencFile({ payload: bitmap(), key: 7, word: "EEND" });
		expect(
			await brunsEencImageFormat.detect(
				new BufferByteSource(data),
				"picture.brs",
			),
		).toBe(false);
	});
});

/** The bytes of a picture, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
