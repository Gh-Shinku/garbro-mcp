import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	advSysGwdImageDescriptor,
	advSysGwdImageFormat,
	composeGwd,
	decodeGwd,
	readGwdLayout,
	readGwdShapeLayout,
} from "../../packages/formats/src/advsys/gwd-image.js";

function gwdHead(
	dataSize: number,
	width: number,
	height: number,
	bitsPerPixel = 8,
): Buffer {
	const head = Buffer.alloc(0x0c, 0x00);
	head.writeUInt32LE(dataSize, 0);
	head.write("GWD", 4, "latin1");
	head.writeUInt16BE(width, 7);
	head.writeUInt16BE(height, 9);
	head[11] = bitsPerPixel;
	return head;
}

const GREY = Buffer.from("0800000047574400080002086a792a15af853050", "hex");
const GREY_PLACES = Buffer.from("030c1114141414140f0f0a0707070707", "hex");

/** A picture of four places by two of twenty four bits. */
const COLOUR = Buffer.from(
	"1600000047574400040002187b90dee437b90dee437b90dee430",
	"hex",
);
const COLOUR_PLACES = Buffer.from(
	"070707060606060606060606070707060606060606060606",
	"hex",
);

/** The same picture with a shape of its places behind it, standing as a picture of eight bits. The word at the
 * front of the file names where the shape stands, counting from four places into the file. */
const WITH_SHAPE = Buffer.from(
	"1600000047574400040002187b90dee437b90dee437b90dee430" +
		"010500000047574400040002087ac8deb230",
	"hex",
);
const WITH_SHAPE_PLACES = Buffer.from(
	"070707fa060606f5060606f5060606f5070707fa060606f5060606f5060606f5",
	"hex",
);

describe("AdvSys3 engine image format", () => {
	it("reads the head of a picture", () => {
		expect(readGwdLayout(GREY, GREY.length)).toEqual({
			dataSize: 8,
			width: 8,
			height: 2,
			bitsPerPixel: 8,
		});
		expect(readGwdLayout(COLOUR, COLOUR.length)).toEqual({
			dataSize: 22,
			width: 4,
			height: 2,
			bitsPerPixel: 24,
		});
	});

	it("turns away a file whose head does not hold its own word", () => {
		expect(readGwdLayout(Buffer.alloc(0x0c), 0x0c)).toBeUndefined();
		expect(readGwdLayout(Buffer.alloc(8), 8)).toBeUndefined();
		const wrong = Buffer.from(GREY);
		wrong.write("GWX", 4, "latin1");
		expect(readGwdLayout(wrong, wrong.length)).toBeUndefined();
	});

	it("turns away a picture of no places and one of places of a colour it does not know", () => {
		expect(readGwdLayout(gwdHead(0, 0, 2), 0x0c)).toBeUndefined();
		expect(readGwdLayout(gwdHead(0, 8, 0), 0x0c)).toBeUndefined();
		expect(readGwdLayout(gwdHead(0, 8, 2, 16), 0x0c)).toBeUndefined();
	});

	it("walks the places of a picture of eight bits", () => {
		const layout = readGwdLayout(GREY, GREY.length);
		if (!layout) throw new Error("the picture stands in the file");
		expect(decodeGwd(GREY, 0, layout)).toEqual(GREY_PLACES);
	});

	it("walks the places of a picture of twenty four bits", () => {
		const layout = readGwdLayout(COLOUR, COLOUR.length);
		if (!layout) throw new Error("the picture stands in the file");
		expect(decodeGwd(COLOUR, 0, layout)).toEqual(COLOUR_PLACES);
	});

	it("finds the shape of the places of a picture", () => {
		const layout = readGwdLayout(WITH_SHAPE, WITH_SHAPE.length);
		if (!layout) throw new Error("the picture stands in the file");
		expect(layout).toEqual({
			dataSize: 22,
			width: 4,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(readGwdShapeLayout(WITH_SHAPE, layout, WITH_SHAPE.length)).toEqual({
			dataSize: 5,
			width: 4,
			height: 2,
			bitsPerPixel: 8,
			offset: 0x1b,
		});
		const plain = readGwdLayout(GREY, GREY.length);
		if (!plain) throw new Error("the picture stands in the file");
		expect(readGwdShapeLayout(GREY, plain, GREY.length)).toBeUndefined();
	});

	it("stands the shape of the places beside the places of the picture", () => {
		const layout = readGwdLayout(WITH_SHAPE, WITH_SHAPE.length);
		if (!layout) throw new Error("the picture stands in the file");
		const shape = readGwdShapeLayout(WITH_SHAPE, layout, WITH_SHAPE.length);
		const bmp = composeGwd(WITH_SHAPE, layout, shape);
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		expect(bmp.subarray(0x36, 0x36 + 32)).toEqual(WITH_SHAPE_PLACES);
	});

	it("turns away a shape that does not stand as wide as the picture", () => {
		const head = gwdHead(22, 4, 2, 24);
		const image = Buffer.concat([
			head,
			COLOUR.subarray(12),
			Buffer.from([1]),
			gwdHead(5, 8, 2, 8),
			Buffer.from("7ac8deb230", "hex"),
		]);
		const layout = readGwdLayout(image, image.length);
		if (!layout) throw new Error("the picture stands in the file");
		expect(readGwdShapeLayout(image, layout, image.length)).toBeUndefined();
	});

	it("hands out the places of a picture as a bitmap", async () => {
		const handle = await advSysGwdImageFormat.open(
			new BufferByteSource(WITH_SHAPE),
			"scene.gwd",
		);
		expect(handle.entries.length).toBe(1);
		expect(handle.entries[0]?.path).toBe("scene.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 4,
			height: 2,
			bitsPerPixel: 32,
			shape: true,
		});
		const body = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(body.readUInt32LE(0x0a)).toBe(0x36);
		expect(body.readUInt32LE(0x12)).toBe(4);
		expect(body.readInt32LE(0x16)).toBe(-2);
		expect(body.subarray(0x36, 0x36 + 32)).toEqual(WITH_SHAPE_PLACES);
	});

	it("hands out a picture of eight bits as a bitmap of eight bits", async () => {
		const handle = await advSysGwdImageFormat.open(
			new BufferByteSource(GREY),
			"grey.gwd",
		);
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 8,
			height: 2,
			bitsPerPixel: 8,
		});
		const body = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(body.readUInt16LE(0x1c)).toBe(8);
		expect(body.subarray(0x436, 0x436 + 16)).toEqual(GREY_PLACES);
	});

	it("stands after every kind of picture that is told by a word of its own", () => {
		expect(advSysGwdImageDescriptor.id).toBe("advsys-gwd-image");
		expect(advSysGwdImageFormat.detection).toEqual({
			signatures: [],
			priority: -1,
		});
	});

	it("finds a picture of its own kind", async () => {
		await expect(
			advSysGwdImageFormat.detect(new BufferByteSource(GREY)),
		).resolves.toBe(true);
		await expect(
			advSysGwdImageFormat.detect(
				new BufferByteSource(Buffer.from("not a picture at all")),
			),
		).resolves.toBe(false);
	});
});
