import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodeTcz,
	ponytailTczImageFormat,
	readTczLayout,
} from "../../packages/formats/src/ponytail/tcz-image.js";
import { ponytailTszImageFormat } from "../../packages/formats/src/ponytail/tsz-image.js";

const COLORS: number[][] = Array.from({ length: 16 }, (_, entry) => {
	return [entry * 0x11, entry * 0x11, entry * 0x11];
});
COLORS[0] = [0, 0, 0];

/** A picture of the second kind: its head, its colours, and the walk of its places. */
function tczFile(input: {
	width: number;
	height: number;
	version?: string;
	colors?: number[][];
	body?: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x40, 0x00);
	head.write("NMI ", 0, "latin1");
	head.write(input.version ?? "2.5\0", 4, "latin1");
	head.writeUInt16LE(input.width, 0x0c);
	head.writeUInt16LE(input.height, 0x0e);
	for (let entry = 0; entry < 16; entry += 1) {
		const color = input.colors?.[entry] ?? [0, 0, 0];
		head[0x10 + entry * 3] = color[0] ?? 0;
		head[0x10 + entry * 3 + 1] = color[1] ?? 0;
		head[0x10 + entry * 3 + 2] = color[2] ?? 0;
	}
	return Buffer.concat([head, input.body ?? Buffer.alloc(0)]);
}

/** A picture of sixteen places by eight, whose walk takes every way it knows: the places behind the ways of
 * the walk stand over an independent transcription of the reference's own walk. */
const COMPOSED = Buffer.from(
	"4e4d4920322e35000000000010000800000000111111222222333333444444555555666666" +
		"777777888888999999aaaaaabbbbbbccccccddddddeeeeeeffffff2d2fa6905b9ad3d60fac" +
		"bea50ac1bf98513d741a844d77a5b816ea07a35421b2f9219a1f",
	"hex",
);
const COMPOSED_PLACES = Buffer.from(
	"07a000000022ac0d00000000000000000000d000a000ac000000000f000000000000002b" +
		"0000000000000f002b00000f00002b7c000000004a0000007c000000",
	"hex",
);

describe("Ponytail Soft NMI 2.5 picture", () => {
	it("reads the head of a picture", () => {
		const layout = readTczLayout(tczFile({ width: 16, height: 8 }));
		expect(layout).toEqual({
			width: 16,
			height: 8,
			stride: 8,
			originX: 0,
			originY: 0,
		});
	});

	it("turns away the word of the first kind of its pictures", () => {
		expect(
			readTczLayout(tczFile({ width: 16, height: 8, version: "2.05" })),
		).toBeUndefined();
		expect(
			readTczLayout(tczFile({ width: 16, height: 8, version: "3.00" })),
		).toBeUndefined();
		expect(readTczLayout(Buffer.alloc(0x10))).toBeUndefined();
		expect(readTczLayout(Buffer.alloc(8))).toBeUndefined();
	});

	it("turns away a picture of no places and one that stands too high", () => {
		expect(readTczLayout(tczFile({ width: 0, height: 8 }))).toBeUndefined();
		expect(readTczLayout(tczFile({ width: 16, height: 0 }))).toBeUndefined();
		expect(
			readTczLayout(tczFile({ width: 16, height: 0x191 })),
		).toBeUndefined();
	});

	it("takes the picture an archive hands out", async () => {
		const file = tczFile({
			width: 16,
			height: 8,
			body: COMPOSED.subarray(0x40),
		});
		const handle = await ponytailTczImageFormat.open(
			new BufferByteSource(file),
			"picture.nmi",
		);
		expect(handle.entries.length).toBe(1);
		expect(handle.entries[0]?.path).toBe("picture.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 16,
			height: 8,
			bitsPerPixel: 4,
		});
		const body = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(body.readUInt32LE(0x0a)).toBe(0x76);
		expect(body.readUInt32LE(0x12)).toBe(16);
		expect(body.readInt32LE(0x16)).toBe(-8);
		expect(body.readUInt16LE(0x1c)).toBe(4);
		expect(body.subarray(0x76, 0x76 + 64)).toEqual(COMPOSED_PLACES);
	});

	it("takes the picture of a file that stands apart from the first kind", () => {
		const layout = readTczLayout(COMPOSED);
		if (!layout) throw new Error("the picture stands in the file");
		expect(layout).toEqual({
			width: 16,
			height: 8,
			stride: 8,
			originX: 0,
			originY: 0,
		});
		expect(decodeTcz(COMPOSED, layout).subarray(0x76, 0x76 + 64)).toEqual(
			COMPOSED_PLACES,
		);
	});

	it("stands apart from the first kind of its pictures", async () => {
		const file = new BufferByteSource(tczFile({ width: 16, height: 8 }));
		await expect(ponytailTczImageFormat.detect(file)).resolves.toBe(true);
		await expect(ponytailTszImageFormat.detect(file)).resolves.toBe(false);
	});

	it("takes no picture out of a file that does not hold one", async () => {
		const source = new BufferByteSource(Buffer.from("not a picture at all"));
		await expect(
			ponytailTczImageFormat.open(source, "picture.nmi"),
		).rejects.toThrow();
	});
});
