import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	composeSpeed,
	decodeSpeed,
	readSpeedLayout,
	studioJikkenshitsuSpeedImageDescriptor,
	studioJikkenshitsuSpeedImageFormat,
	unpackSpeedRuns,
} from "../../packages/formats/src/studio-jikkenshitsu/speed-image.js";

function speedFile(input: {
	flags?: number;
	width?: number;
	height?: number;
	colors?: number;
	zero?: number;
	place?: number;
	body?: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x22, 0x00);
	head.writeUInt16LE(input.flags ?? 0, 0);
	head[2] = input.place ?? 1;
	head.writeInt32LE(input.zero ?? 0, 4);
	head.writeUInt16LE(input.width ?? 2, 0x16);
	head.writeUInt16LE(input.height ?? 2, 0x18);
	head.writeUInt16LE(input.colors ?? 0x10, 0x1e);
	return Buffer.concat([head, input.body ?? Buffer.alloc(0)]);
}

/** How many colours stand beside a picture, four places a colour: its blue, its green, its red and a place
 * that counts for nothing. */
function palette(colors: number): Buffer {
	const out: Buffer = Buffer.alloc(colors * 4, 0x00);
	for (let entry = 0; entry < colors; entry += 1) {
		out[entry * 4] = entry & 0xff;
		out[entry * 4 + 1] = (entry * 3) & 0xff;
		out[entry * 4 + 2] = (entry * 7) & 0xff;
	}
	return out;
}

function places(size: number): Buffer {
	return Buffer.from(Array.from({ length: size }, (_, at) => at + 1));
}

describe("Studio Jikkenshitsu picture of the kind its own files stand as", () => {
	it("reads the head of a picture", () => {
		expect(
			readSpeedLayout(speedFile({ flags: 4, colors: 0x100 }), 0x22),
		).toEqual({
			flags: 4,
			width: 2,
			height: 2,
			colors: 0x100,
		});
	});

	it("turns away a file whose head does not hold its own words", () => {
		expect(readSpeedLayout(speedFile({ zero: 1 }), 0x22)).toBeUndefined();
		expect(readSpeedLayout(speedFile({ place: 2 }), 0x22)).toBeUndefined();
		expect(readSpeedLayout(speedFile({ flags: 0x100 }), 0x22)).toBeUndefined();
		expect(readSpeedLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("turns away a picture of places beyond what a picture holds", () => {
		expect(readSpeedLayout(speedFile({ width: 0 }), 0x22)).toBeUndefined();
		expect(readSpeedLayout(speedFile({ width: 0x2001 }), 0x22)).toBeUndefined();
		expect(readSpeedLayout(speedFile({ height: 0 }), 0x22)).toBeUndefined();
		expect(readSpeedLayout(speedFile({ colors: 0x101 }), 0x22)).toBeUndefined();
	});

	it("turns away a picture whose places stand under a key of its own", () => {
		// The key of such a picture stands in the reference's own settings, which this project does not carry.
		expect(readSpeedLayout(speedFile({ flags: 8 }), 0x22)).toBeUndefined();
		expect(readSpeedLayout(speedFile({ flags: 0x0c }), 0x22)).toBeUndefined();
	});

	it("stands a run of places the way the walk of runs names it", () => {
		// The place behind a place that stands the same way names how many places stand the same way, counting
		// the two that stand before it.
		expect([...unpackSpeedRuns(Buffer.from([0x11, 0x11, 0x05]), 5)]).toEqual([
			0x11, 0x11, 0x11, 0x11, 0x11,
		]);
		expect([...unpackSpeedRuns(Buffer.from([1, 2, 3, 4]), 4)]).toEqual([
			1, 2, 3, 4,
		]);
		expect([...unpackSpeedRuns(Buffer.from([7, 7, 4, 9, 9, 3]), 7)]).toEqual([
			7, 7, 7, 7, 9, 9, 9,
		]);
	});

	it("reads the places of a picture that stand as they stand", () => {
		const body = Buffer.concat([
			Buffer.alloc(4, 0x00),
			palette(0x10),
			places(4),
		]);
		const file = speedFile({ colors: 0x10, body });
		const layout = readSpeedLayout(file, file.length);
		if (!layout) throw new Error("the picture stands in the file");
		const picture = decodeSpeed(file, layout);
		expect(picture.palette?.length).toBe(0x10 * 3);
		expect([...picture.pixels]).toEqual([1, 2, 3, 4]);
		expect(picture.alpha).toBeUndefined();
	});

	it("reads the places of a picture that stand behind a walk of runs", () => {
		const walk = Buffer.from([5, 5, 4]);
		const body = Buffer.concat([
			Buffer.from([walk.length, 0, 0, 0]),
			palette(0x10),
			walk,
		]);
		const file = speedFile({ colors: 0x10, body });
		const layout = readSpeedLayout(file, file.length);
		if (!layout) throw new Error("the picture stands in the file");
		expect([...decodeSpeed(file, layout).pixels]).toEqual([5, 5, 5, 5]);
	});

	it("reads the places of a shape of a picture", () => {
		const shape = Buffer.from([0x0a, 0x0a, 0x04]);
		const body = Buffer.concat([
			Buffer.from([4, 0, 0, 0]),
			palette(0x10),
			places(4),
			Buffer.from([shape.length, 0, 0, 0]),
			shape,
		]);
		const file = speedFile({ flags: 4, colors: 0x10, body });
		const layout = readSpeedLayout(file, file.length);
		if (!layout) throw new Error("the picture stands in the file");
		const picture = decodeSpeed(file, layout);
		expect([...picture.pixels]).toEqual([1, 2, 3, 4]);
		expect([...(picture.alpha ?? [])]).toEqual([0x0a, 0x0a]);
	});

	it("hands out the places of a picture as a bitmap of eight bits", async () => {
		const body = Buffer.concat([
			Buffer.from([0, 0, 0, 0]),
			palette(0x10),
			places(4),
		]);
		const file = speedFile({ colors: 0x10, body });
		const handle = await studioJikkenshitsuSpeedImageFormat.open(
			new BufferByteSource(file),
			"scene.dat",
		);
		expect(handle.entries[0]?.path).toBe("scene.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 8,
		});
		const bmp = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(bmp.readUInt16LE(0x1c)).toBe(8);
		expect(bmp.readInt32LE(0x16)).toBe(2);
		expect(bmp.subarray(0x436, 0x43e)).toEqual(
			Buffer.from([1, 2, 0, 0, 3, 4, 0, 0]),
		);
	});

	it("stands the places of a shape in the places of a picture", () => {
		const body = Buffer.concat([
			Buffer.from([0, 0, 0, 0]),
			palette(0x10),
			places(4),
			Buffer.from([2, 0, 0, 0]),
			Buffer.from([0xa5, 0x5a]),
		]);
		const file = speedFile({ flags: 4, colors: 0x10, body });
		const layout = readSpeedLayout(file, file.length);
		if (!layout) throw new Error("the picture stands in the file");
		const bmp = composeSpeed(decodeSpeed(file, layout), layout);
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		expect(bmp.readInt32LE(0x16)).toBe(2);
		// The highest places of a byte of the shape stand for the place of the picture that stands first.
		expect(bmp.subarray(0x36, 0x46)).toEqual(
			Buffer.from("010307aa" + "02060e55" + "03091555" + "040c1caa", "hex"),
		);
	});

	it("stands after every kind of picture that is told by a word of its own", () => {
		expect(studioJikkenshitsuSpeedImageDescriptor.id).toBe(
			"studio-jikkenshitsu-speed-image",
		);
		expect(studioJikkenshitsuSpeedImageFormat.detection).toEqual({
			signatures: [],
			priority: -1,
		});
	});

	it("finds a picture of its own kind", async () => {
		await expect(
			studioJikkenshitsuSpeedImageFormat.detect(
				new BufferByteSource(speedFile({})),
			),
		).resolves.toBe(true);
		await expect(
			studioJikkenshitsuSpeedImageFormat.detect(
				new BufferByteSource(Buffer.from("not a picture at all")),
			),
		).resolves.toBe(false);
	});
});
