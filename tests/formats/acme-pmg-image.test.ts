import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	acmePmgImageFormat,
	readPmgLayout,
	unpackPmg,
} from "../../packages/formats/src/acme/pmg-image.js";

const PICTURE = Buffer.from(
	"0100000001000000010000000200000002000000c0011122" +
		"0100000001000000010000000200000002000000c0013344" +
		"0100000001000000010000000200000004000000c00155667788",
	"hex",
);
const PIXELS = Buffer.from("113355224466113377224488", "hex");

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await acmePmgImageFormat.open(
		new BufferByteSource(data),
		"picture.pmg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Acme image format", () => {
	it("reads the head of a picture", () => {
		expect(readPmgLayout(PICTURE, PICTURE.length)).toEqual({
			blocks: 1,
			width: 4,
			height: 1,
			bitsSize: 1,
			codeSize: 2,
			dataSize: 2,
		});
	});

	it("turns away a head that names no picture", () => {
		const wrongMark = Buffer.from(PICTURE);
		wrongMark.writeUInt32LE(2, 0x18);
		expect(readPmgLayout(wrongMark, wrongMark.length)).toBeUndefined();
		// How many blocks a row of the picture stands in: none of them, and more of them than a picture may
		// stand in.
		for (const blocks of [0, 0x801]) {
			const data = Buffer.from(PICTURE);
			data.writeUInt32LE(blocks, 0);
			expect(readPmgLayout(data, data.length)).toBeUndefined();
		}
		for (const [field, value] of [
			[0x08, 0],
			[0x0c, 1],
			[0x10, 0],
		] as Array<[number, number]>) {
			const data = Buffer.from(PICTURE);
			data.writeInt32LE(value, field);
			expect(readPmgLayout(data, data.length)).toBeUndefined();
		}
		expect(readPmgLayout(Buffer.alloc(4), 4)).toBeUndefined();
	});

	it("stands the places of the picture beside the places of the walk that name them", () => {
		const layout = readPmgLayout(PICTURE, PICTURE.length);
		if (!layout) throw new Error("the head stands in the picture");
		const { planes, pixels } = unpackPmg(PICTURE, layout);
		expect([...planes]).toEqual([
			0x2211, 0x2211, 0x4433, 0x4433, 0x6655, 0x8877,
		]);
		expect(pixels).toEqual(PIXELS);
	});

	it("hands the places of the picture to a bitmap", async () => {
		const out = await extract(PICTURE);
		expect(out.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(out.readUInt32LE(0x12)).toBe(4);
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.subarray(0x36)).toEqual(PIXELS);
	});

	it("turns a picture cut short of the places of its walk away", async () => {
		const short = Buffer.from(PICTURE.subarray(0, PICTURE.length - 2));
		await expect(extract(short)).rejects.toThrow(GarbroError);
		await expect(extract(short)).rejects.toThrow(
			"Acme picture is cut short of a place of its walk",
		);
	});

	it("reads the places of the picture as the words of its own head say", async () => {
		const handle = await acmePmgImageFormat.open(
			new BufferByteSource(PICTURE),
			"picture.pmg",
		);
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 4,
			height: 1,
			bitsPerPixel: 24,
		});
		expect(handle.entries[0]?.path).toBe("picture.bmp");
	});

	it("is told by the head of the picture rather than by a word of its own", async () => {
		expect(acmePmgImageFormat.descriptor.id).toBe("acme-pmg-image");
		expect(acmePmgImageFormat.detection).toEqual({ signatures: [] });
		await expect(
			acmePmgImageFormat.detect(new BufferByteSource(PICTURE)),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(PICTURE);
		wrongMark.writeUInt32LE(2, 0x18);
		await expect(
			acmePmgImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
		await expect(
			acmePmgImageFormat.detect(new BufferByteSource(Buffer.alloc(1))),
		).resolves.toBe(false);
	});
});
