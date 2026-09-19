import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	arkCmpImageFormat,
	buildCmpTree,
	decodeCmp,
	readCmpLayout,
} from "../../packages/formats/src/ark/cmp-image.js";

/**
 * An Ark picture: the head of five bytes, the words of the shape of the picture where it carries one, the
 * weights of the thirty two places and the size of the walk, and the walk of codes behind them.
 */
function cmpFile(input: {
	width: number;
	height: number;
	alpha?: [number, number];
	weights?: number[];
	body: Buffer;
	packedLength?: number;
}): Buffer {
	const head = Buffer.alloc(5, 0x00);
	head.writeUInt16LE(input.width, 0);
	head.writeUInt16LE(input.height, 2);
	const parts: Buffer[] = [head];
	if (input.alpha) {
		head[4] = 1;
		const shape = Buffer.alloc(4, 0x00);
		shape.writeUInt16LE(input.alpha[0], 0);
		shape.writeUInt16LE(input.alpha[1], 2);
		parts.push(shape);
	}
	const weights = Buffer.alloc(32 * 4, 0x00);
	for (let index = 0; index < 32; index += 1) {
		weights.writeUInt32LE(input.weights?.[index] ?? 0, index * 4);
	}
	parts.push(weights);
	const size = Buffer.alloc(4, 0x00);
	size.writeInt32LE(input.packedLength ?? input.body.length, 0);
	parts.push(size);
	parts.push(input.body);
	return Buffer.concat(parts);
}

/** The weights that make the place thirty one the one place of the tree that stands one bit away. */
function lastPlaceWeights(): number[] {
	const weights = new Array<number>(32).fill(0);
	weights[31] = 0xffff;
	return weights;
}

describe("Ark image format", () => {
	it("reads the head of a picture", () => {
		const data = cmpFile({
			width: 2,
			height: 1,
			weights: lastPlaceWeights(),
			body: Buffer.from([0x00]),
		});
		expect(readCmpLayout(data)).toMatchObject({
			width: 2,
			height: 1,
			hasAlpha: false,
			dataOffset: 5 + 32 * 4 + 4,
			packedLength: 1,
		});
	});

	it("reads the shape of a picture behind the head", () => {
		const data = cmpFile({
			width: 2,
			height: 1,
			alpha: [4, 8],
			weights: lastPlaceWeights(),
			body: Buffer.from([0x00]),
		});
		expect(readCmpLayout(data)).toMatchObject({
			hasAlpha: true,
			alphaWidth: 4,
			alphaHeight: 8,
			dataOffset: 9 + 32 * 4 + 4,
		});
		// The walk of codes has to reach to the end of the file.
		const other = cmpFile({
			width: 2,
			height: 1,
			weights: lastPlaceWeights(),
			body: Buffer.from([0x00]),
			packedLength: 2,
		});
		expect(readCmpLayout(other)).toBeUndefined();
		expect(readCmpLayout(Buffer.alloc(4, 0x00))).toBeUndefined();
	});

	it("builds the tree of codes of the weights of the head", () => {
		// Every place but the thirty first weighs nought, so every one of them joins into one branch and the
		// thirty first place stands one bit away from the root.
		const root = buildCmpTree(new Uint32Array(lastPlaceWeights()));
		expect(root.symbol).toBe(0xff);
		expect(root.right?.symbol).toBe(31);
		expect(root.left?.symbol).toBe(0xff);
	});

	it("walks the places of a picture out of its tree of codes", () => {
		// Every place of the walk stands nought, which the walk of codes takes to the right, where the
		// thirty first place of the tree stands one bit away, so the places descend from it: the red plane
		// takes 31 and 30, the green 29 and 28 and the blue 27 and 26.
		const data = cmpFile({
			width: 2,
			height: 1,
			weights: lastPlaceWeights(),
			body: Buffer.from([0x00]),
		});
		const layout = readCmpLayout(data);
		if (!layout) throw new Error("no layout");
		const bmp = decodeCmp(data, layout);
		expect(bmp.readUInt32LE(0x12)).toBe(2);
		expect(bmp.readInt32LE(0x16)).toBe(1);
		expect(bmp.readUInt16LE(0x1c)).toBe(16);
		expect(bmp.readUInt32LE(0x1e)).toBe(3);
		// Five places of blue stand in the highest places of a colour, then five of green and five of red.
		expect(bmp.readUInt32LE(0x36)).toBe(0x7c00);
		expect(bmp.readUInt32LE(0x3a)).toBe(0x03e0);
		expect(bmp.readUInt32LE(0x3e)).toBe(0x001f);
		expect(bmp.subarray(0x42, 0x46).toString("hex")).toBe(
			hex([0xbf, 0x6f, 0x9e, 0x6b]),
		);
	});

	it("writes a picture out as a bitmap of sixteen bits", async () => {
		const data = cmpFile({
			width: 2,
			height: 1,
			weights: lastPlaceWeights(),
			body: Buffer.from([0x00]),
		});
		const handle = await arkCmpImageFormat.open(
			new BufferByteSource(data),
			"picture.cmp",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry).toMatchObject({
			path: "picture.bmp",
			metadata: { type: "image", width: 2, height: 1, bitsPerPixel: 16 },
		});
		expect(handle.metadata).toEqual({ image: "bmp", bitsPerPixel: 16 });
	});

	it("reads a picture only by the name of its file", async () => {
		const data = cmpFile({
			width: 2,
			height: 1,
			weights: lastPlaceWeights(),
			body: Buffer.from([0x00]),
		});
		expect(
			await arkCmpImageFormat.detect(new BufferByteSource(data), "picture.cmp"),
		).toBe(true);
		expect(
			await arkCmpImageFormat.detect(new BufferByteSource(data), "picture.bin"),
		).toBe(false);
	});

	it("declines a file that does not hold a picture", async () => {
		const other = cmpFile({
			width: 2,
			height: 1,
			weights: lastPlaceWeights(),
			body: Buffer.from([0x00]),
			packedLength: 2,
		});
		await expect(
			arkCmpImageFormat.open(new BufferByteSource(other), "picture.cmp"),
		).rejects.toThrow(GarbroError);
		await expect(
			arkCmpImageFormat.open(new BufferByteSource(other), "picture.cmp"),
		).rejects.toThrow("Not an Ark picture");
	});
});

/** The bytes of a picture, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
