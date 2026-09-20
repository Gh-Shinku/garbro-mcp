import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	extractMg2,
	readMg2Layout,
	readMg2Payload,
	unmaskMg2,
	valkyriaMg2ImageDescriptor,
	valkyriaMg2ImageFormat,
} from "../../packages/formats/src/valkyria/mg2-image.js";

/** A portable network graphic of the shape the reference's own reader takes: its signature, the length of its
 * header chunk and the header itself. */
function png(width: number, height: number, depth = 8, colour = 2): Buffer {
	const header = Buffer.alloc(29, 0x00);
	header.write("\x89PNG\r\n\x1a\n", 0, "latin1");
	header.writeUInt32BE(13, 8);
	header.write("IHDR", 12, "latin1");
	header.writeUInt32BE(width, 16);
	header.writeUInt32BE(height, 20);
	header[24] = depth;
	header[25] = colour;
	return header;
}

/** A JPEG of the shape the reference's own reader takes: the start of the picture, a table behind it, and a
 * frame naming the width, the height and the places of a colour. */
function jpeg(width: number, height: number, components = 1): Buffer {
	const app0 = Buffer.alloc(18, 0x00);
	app0[0] = 0xff;
	app0[1] = 0xe0;
	app0.writeUInt16BE(0x10, 2);
	app0.write("JFIF\0", 4, "latin1");
	const frame = Buffer.alloc(13, 0x00);
	frame[0] = 0xff;
	frame[1] = 0xc0;
	frame.writeUInt16BE(11, 2);
	frame[4] = 8;
	frame.writeUInt16BE(height, 5);
	frame.writeUInt16BE(width, 7);
	frame[9] = components;
	return Buffer.concat([Buffer.from([0xff, 0xd8]), app0, frame]);
}

/** The mask the reference stands the first places of a region under: the places of the first way stand under a
 * mask as long as a fifth of the region, the places of the second way under one as long as the region names, up
 * to twenty five places. */
function mask(input: Buffer, scheme: string): Buffer {
	const places =
		scheme === "v1" ? Math.floor(input.length / 5) : Math.min(25, input.length);
	const key = scheme === "v1" ? 0 : input.length & 0xff;
	const out = Buffer.from(input);
	for (let at = 0; at < places && at < out.length; at += 1) {
		out[at] = ((out[at] ?? 0) ^ ((key + at) & 0xff)) & 0xff;
	}
	return out;
}

/** A Valkyria picture: the head, the places of the picture under their mask, and the shape of them behind. */
function mg2File(input: {
	image: Buffer;
	scheme?: string;
	alpha?: Buffer;
	word?: string;
	imageLength?: number;
	alphaLength?: number;
}): Buffer {
	const head = Buffer.alloc(0x10, 0x00);
	head.write("MICO", 0, "latin1");
	head.write(input.word ?? "CG01", 4, "latin1");
	const places = mask(input.image, input.scheme ?? "v1");
	head.writeInt32LE(input.imageLength ?? places.length, 0x08);
	head.writeInt32LE(input.alphaLength ?? input.alpha?.length ?? 0, 0x0c);
	return Buffer.concat([head, places, input.alpha ?? Buffer.alloc(0)]);
}

describe("Valkyria image format", () => {
	it("reads the head of a picture", () => {
		const file = mg2File({ image: png(4, 2) });
		expect(readMg2Layout(file)).toEqual({
			imageLength: 29,
			alphaLength: 0,
		});
	});

	it("turns away a file whose head does not hold its own words", () => {
		expect(
			readMg2Layout(mg2File({ image: png(4, 2), word: "CG02" })),
		).toBeUndefined();
		expect(
			readMg2Layout(Buffer.concat([Buffer.from("NOPE"), Buffer.alloc(0x20)])),
		).toBeUndefined();
		expect(readMg2Layout(Buffer.alloc(8))).toBeUndefined();
	});

	it("turns away a picture whose places do not stand in the file", () => {
		expect(
			readMg2Layout(mg2File({ image: png(4, 2), imageLength: 0x100 })),
		).toBeUndefined();
		expect(
			readMg2Layout(mg2File({ image: png(4, 2), alphaLength: 0x100 })),
		).toBeUndefined();
		expect(
			readMg2Layout(mg2File({ image: png(4, 2), imageLength: 0 })),
		).toBeUndefined();
	});

	it("stands the first places of a region under the mask of the first way", () => {
		const places = Buffer.from(Array.from({ length: 100 }, (_, at) => at));
		const masked = unmaskMg2(
			Buffer.concat([Buffer.alloc(2, 0xaa), places]),
			2,
			100,
			"v1",
		);
		for (let at = 0; at < 100; at += 1) {
			const expected = at < 20 ? at ^ at : at;
			expect(masked[at]).toBe(expected);
		}
	});

	it("stands as many places under the mask of the second way as name it", () => {
		const places = Buffer.from(Array.from({ length: 100 }, (_, at) => at));
		const masked = unmaskMg2(places, 0, 100, "v2");
		for (let at = 0; at < 100; at += 1) {
			const expected = at < 25 ? at ^ ((100 + at) & 0xff) : at;
			expect(masked[at]).toBe(expected);
		}
		const short = unmaskMg2(places.subarray(0, 10), 0, 10, "v2");
		expect([...short]).toEqual(
			Array.from({ length: 10 }, (_, at) => at ^ ((10 + at) & 0xff)),
		);
	});

	it("reads the places of a picture that stand under the mask of the first way", () => {
		const file = mg2File({ image: png(4, 2), scheme: "v1" });
		const layout = readMg2Layout(file);
		if (!layout) throw new Error("the picture stands in the file");
		expect(readMg2Payload(file, layout)).toEqual({
			scheme: "v1",
			kind: "png",
			width: 4,
			height: 2,
			bitsPerPixel: 24,
		});
	});

	it("reads the places of a picture that stand under the mask of the second way", () => {
		const image = png(0x1234, 0x5678);
		const file = mg2File({ image, scheme: "v2" });
		const layout = readMg2Layout(file);
		if (!layout) throw new Error("the picture stands in the file");
		expect(readMg2Payload(file, layout)).toEqual({
			scheme: "v2",
			kind: "png",
			width: 0x1234,
			height: 0x5678,
			bitsPerPixel: 24,
		});
	});

	it("reads the places of a picture that stand as a JPEG", () => {
		const image = jpeg(0x20, 0x10, 3);
		const file = mg2File({ image, scheme: "v2" });
		const layout = readMg2Layout(file);
		if (!layout) throw new Error("the picture stands in the file");
		expect(readMg2Payload(file, layout)).toEqual({
			scheme: "v2",
			kind: "jpeg",
			width: 0x20,
			height: 0x10,
			bitsPerPixel: 24,
		});
	});

	it("turns away a picture whose places are neither", () => {
		const file = mg2File({ image: Buffer.alloc(0x30, 0x5a), scheme: "v1" });
		const layout = readMg2Layout(file);
		if (!layout) throw new Error("the picture stands in the file");
		expect(readMg2Payload(file, layout)).toBeUndefined();
	});

	it("hands out the places of a picture as they stand", async () => {
		const image = png(0x40, 0x20);
		const file = mg2File({ image, scheme: "v1" });
		const handle = await valkyriaMg2ImageFormat.open(
			new BufferByteSource(file),
			"scene#0001.MG2",
		);
		expect(handle.entries.length).toBe(1);
		expect(handle.entries[0]?.path).toBe("scene#0001.png");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 0x40,
			height: 0x20,
			bitsPerPixel: 24,
			scheme: "v1",
		});
		const body = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(body).toEqual(image);
	});

	it("turns away a picture that carries a shape of its own", () => {
		const image = png(4, 2);
		const file = mg2File({ image, scheme: "v1", alpha: Buffer.alloc(8, 0x7f) });
		const layout = readMg2Layout(file);
		if (!layout) throw new Error("the picture stands in the file");
		const payload = readMg2Payload(file, layout);
		if (!payload) throw new Error("the picture stands in the file");
		expect(() => extractMg2(file, layout, payload)).toThrow(GarbroError);
	});

	it("finds a picture of its own kind", async () => {
		const source = new BufferByteSource(
			mg2File({ image: png(4, 2), scheme: "v1" }),
		);
		await expect(valkyriaMg2ImageFormat.detect(source)).resolves.toBe(true);
		expect(valkyriaMg2ImageDescriptor.id).toBe("valkyria-mg2-image");
		expect(valkyriaMg2ImageDescriptor.extensions).toEqual(["mg2"]);
		await expect(
			valkyriaMg2ImageFormat.detect(
				new BufferByteSource(Buffer.from("not a picture at all")),
			),
		).resolves.toBe(false);
	});

	it("takes no picture out of a file that does not hold one", async () => {
		await expect(
			valkyriaMg2ImageFormat.open(
				new BufferByteSource(Buffer.from("not a picture at all")),
				"scene.mg2",
			),
		).rejects.toThrow();
	});
});
