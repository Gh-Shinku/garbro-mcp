import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	cadathCgfImageFormat,
	decryptCgf,
	readCgfLayout,
	unpackCgf,
} from "../../packages/formats/src/cadath/cgf-image.js";

/** A picture: the head and then a piece for every plane. */
function cgfFile(input: {
	width: number;
	height: number;
	bpp: number;
	method: number;
	planes: Buffer[];
}): Buffer {
	const head = Buffer.alloc(0x0a, 0x00);
	Buffer.from([0x43, 0x47, 0x46, 0x1a]).copy(head, 0);
	head.writeUInt8(input.method, 4);
	head.writeUInt8(input.bpp, 5);
	head.writeUInt16LE(input.width, 6);
	head.writeUInt16LE(input.height, 8);
	const parts: Buffer[] = [head];
	for (const plane of input.planes) {
		const size = Buffer.alloc(4, 0x00);
		size.writeInt32LE(plane.length, 0);
		parts.push(size, plane);
	}
	return Buffer.concat(parts);
}

/** A plane of runs: the size of the plane as a word and then the runs themselves. */
function runs(size: number, body: Buffer): Buffer {
	const head = Buffer.alloc(4, 0x00);
	head.writeInt32LE(size, 0);
	return Buffer.concat([head, body]);
}

/** A plane that is a byte a pixel, every one of them the same. */
function flat(size: number, value: number): Buffer {
	return runs(size, Buffer.from([value, value, 0x00]));
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await cadathCgfImageFormat.open(
		new BufferByteSource(data),
		"pic.cgf",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Cadath image", () => {
	it("reads the head as the reference does", () => {
		const data = cgfFile({
			width: 2,
			height: 1,
			bpp: 24,
			method: 2,
			planes: [flat(2, 0x11), flat(2, 0x22), flat(2, 0x33)],
		});
		expect(readCgfLayout(data)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			method: 2,
		});
	});

	it("gates on the mark, the walk and the depth", () => {
		const good = cgfFile({
			width: 2,
			height: 1,
			bpp: 24,
			method: 2,
			planes: [flat(2, 0x11), flat(2, 0x22), flat(2, 0x33)],
		});
		expect(readCgfLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.writeUInt8(0x44, 3);
		expect(readCgfLayout(mark)).toBeUndefined();
		// Only the walks one, two and three are read.
		const method = Buffer.from(good);
		method.writeUInt8(4, 4);
		expect(readCgfLayout(method)).toBeUndefined();
		const depth = Buffer.from(good);
		depth.writeUInt8(16, 5);
		expect(readCgfLayout(depth)).toBeUndefined();
	});

	it("scrambles a stream and unscrambles it again", () => {
		// The walk the first method takes is its own inverse: the key never looks at the bytes it writes.
		const plain = Buffer.from(
			Array.from({ length: 16 }, (_, index) => index * 3),
		);
		const scrambled = Buffer.from(plain);
		decryptCgf(scrambled, scrambled.length);
		expect(scrambled.equals(plain)).toBe(false);
		const restored = Buffer.from(scrambled);
		decryptCgf(restored, restored.length);
		expect(restored.toString("hex")).toBe(plain.toString("hex"));
	});

	it("unfolds runs of a byte and the byte before it", () => {
		const data = cgfFile({
			width: 2,
			height: 1,
			bpp: 24,
			method: 2,
			planes: [flat(2, 0x11), flat(2, 0x22), flat(2, 0x33)],
		});
		const layout = readCgfLayout(data);
		if (!layout) throw new Error("no layout");
		return unpackCgf(data, layout).then((pixels) => {
			// The planes are woven together a pixel at a time.
			expect(pixels.toString("hex")).toBe("112233112233");
		});
	});

	it("writes a twenty four bit picture out again", async () => {
		const out = await extract(
			cgfFile({
				width: 2,
				height: 1,
				bpp: 24,
				method: 2,
				planes: [flat(2, 0x11), flat(2, 0x22), flat(2, 0x33)],
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `ImageData.Create` keeps the stored order top down.
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("1122331122330000");
	});

	it("unfolds a plane of a zlib stream that stands scrambled", async () => {
		const plane = Buffer.from([0x01, 0x02, 0x03, 0x04]);
		// Every plane of this walk stands scrambled, the word of its size included.
		const data = cgfFile({
			width: 4,
			height: 1,
			bpp: 24,
			method: 1,
			planes: [0, 1, 2].map(() => {
				const body = Buffer.concat([Buffer.alloc(4, 0x00), deflateSync(plane)]);
				decryptCgf(body, body.length);
				return body;
			}),
		});
		const out = await extract(data);
		// Every plane carries the same bytes, so every pixel does too.
		expect(out.subarray(0x36, 0x48).toString("hex")).toBe(
			"010101020202030303040404",
		);
	});

	it("unfolds a plane whose bytes are exclusive ored one after another", async () => {
		const plane = Buffer.from([0x11, 0x22, 0x33, 0x44]);
		// The reader exclusive ors every byte with the running one, so the stream holds the steps between
		// them, the first of which stands as it is.
		const steps = Buffer.alloc(plane.length, 0x00);
		steps[0] = plane[0] ?? 0;
		for (let index = 1; index < plane.length; index += 1) {
			steps[index] = (plane[index - 1] ?? 0) ^ (plane[index] ?? 0);
		}
		const data = cgfFile({
			width: 4,
			height: 1,
			bpp: 24,
			method: 3,
			planes: [0, 1, 2].map(() =>
				Buffer.concat([Buffer.alloc(4, 0x00), deflateSync(steps)]),
			),
		});
		const out = await extract(data);
		expect(out.subarray(0x36, 0x48).toString("hex")).toBe(
			"111111222222333333444444",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = cgfFile({
			width: 2,
			height: 1,
			bpp: 24,
			method: 2,
			planes: [flat(2, 0x11), flat(2, 0x22), flat(2, 0x33)],
		});
		data.writeUInt8(4, 4);
		await expect(
			cadathCgfImageFormat.open(new BufferByteSource(data), "pic.cgf"),
		).rejects.toThrow(GarbroError);
		await expect(
			cadathCgfImageFormat.open(new BufferByteSource(data), "pic.cgf"),
		).rejects.toThrow("Not a Cadath picture");
	});
});
