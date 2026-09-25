import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	gpImageFormat,
	readGpLayout,
	unpackGpPicture,
} from "../../packages/formats/src/eushully/gp-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEAD_SIZE = 0xd;

interface Wanted {
	method: number;
	bits: number;
	elementSize?: number;
	elementsPerSlice?: number;
	paletteSize?: number;
	alpha?: boolean;
	width: number;
	height: number;
	body: Buffer;
}

/** A picture of this engine: its head, then whatever the way of it stands on. */
function gpFile(wanted: Wanted): Buffer {
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head[0] = wanted.alpha ? 1 : 0;
	head[1] = wanted.method;
	head[2] = wanted.elementSize ?? 0;
	head[3] = wanted.elementsPerSlice ?? 0;
	head[4] = wanted.bits;
	head.writeInt32LE(wanted.paletteSize ?? 1, 5);
	head.writeUInt16LE(wanted.width, 9);
	head.writeUInt16LE(wanted.height, 0xb);
	return Buffer.concat([head, wanted.body]);
}

function tableOf(...colors: number[][]): Buffer {
	const parts: Buffer[] = [];
	for (const color of colors) {
		const place = Buffer.alloc(3, 0x00);
		(place as Buffer).set(color, 0);
		parts.push(place);
	}
	return Buffer.concat(parts);
}

async function extract(data: Buffer) {
	const handle = await gpImageFormat.open(
		new BufferByteSource(data),
		"picture.gp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("no picture");
	return image;
}

describe("Old Eushully graphic", () => {
	it("reads the head of a picture and turns away the ones that stand no head", () => {
		const data = gpFile({
			method: 0,
			bits: 24,
			width: 2,
			height: 1,
			body: Buffer.alloc(6),
		});
		const layout = readGpLayout(data);
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(1);
		expect(layout?.bitsPerPixel).toBe(24);
		expect(layout?.method).toBe(0);
		const deep = Buffer.from(data);
		deep[1] = 3;
		expect(readGpLayout(deep)).toBeUndefined();
		const wide = Buffer.from(data);
		wide[2] = 5;
		expect(readGpLayout(wide)).toBeUndefined();
		const odd = Buffer.from(data);
		odd[4] = 20;
		expect(readGpLayout(odd)).toBeUndefined();
		const short = Buffer.from(data);
		short.writeInt32LE(0, 5);
		expect(readGpLayout(short)).toBeUndefined();
	});

	it("draws the places of a picture that stand as they are", async () => {
		const body = Buffer.from([0x01, 0x02, 0x03, 0x11, 0x12, 0x13]);
		const drawn = unpackGpPicture(
			gpFile({ method: 0, bits: 24, width: 2, height: 1, body }),
			{
				width: 2,
				height: 1,
				method: 0,
				bitsPerPixel: 24,
				elementSize: 0,
				elementsPerSlice: 0,
				paletteSize: 1,
				hasAlpha: false,
			},
		);
		expect(drawn.kind).toBe("bgr32");
		expect([...drawn.pixels]).toEqual([3, 2, 1, 0, 0x13, 0x12, 0x11, 0]);
		const image = await extract(
			gpFile({ method: 0, bits: 24, width: 2, height: 1, body }),
		);
		expect([...image.pixels]).toEqual([3, 2, 1, 0, 0x13, 0x12, 0x11, 0]);
	});

	it("draws the places of a picture out of elements of many places", () => {
		// An element holds as many places as its own head names, of as many bits as the depth of the picture.
		const colors = tableOf(
			[0x11, 0x22, 0x33],
			[0x44, 0x55, 0x66],
			[0x77, 0x88, 0x99],
			[0xaa, 0xbb, 0xcc],
		);
		const element = Buffer.alloc(2, 0x00);
		element.writeUInt16LE(0x0123, 0);
		const data = gpFile({
			method: 1,
			bits: 4,
			elementSize: 2,
			elementsPerSlice: 2,
			paletteSize: 4,
			width: 2,
			height: 1,
			body: Buffer.concat([colors, element]),
		});
		const layout = readGpLayout(data);
		if (!layout) throw new Error("the head of the fixture stands");
		expect(layout.method).toBe(1);
		const drawn = unpackGpPicture(data, layout);
		// The places of the colour map stand the other way round from the ones the viewer holds: the third
		// place of a colour comes first.
		expect([...drawn.pixels]).toEqual([
			0xcc, 0xbb, 0xaa, 0, 0x99, 0x88, 0x77, 0,
		]);
	});

	it("draws a picture the slices of which name the places behind and in front of them", () => {
		const colors = tableOf(
			[0x11, 0x22, 0x33],
			[0x44, 0x55, 0x66],
			[0x77, 0x88, 0x99],
		);
		const slice = Buffer.alloc(12, 0x00);
		slice.writeInt32LE(0, 0); // the colour behind the places of a slice
		slice.writeInt32LE(-1, 4); // the colour beside it, counted from the end of the colour map
		slice.writeInt32LE(0x1c, 8); // the length of the slices themselves
		const body = Buffer.alloc(colors.length + 12 + 4 + 1, 0x00);
		colors.copy(body, 0);
		slice.copy(body, colors.length);
		body.writeUInt16LE(0x8000 | 2, colors.length + 12); // two places behind, of the colour beside
		body.writeUInt16LE(1, colors.length + 14); // one place in front
		body[colors.length + 16] = 0x00;
		const layout = {
			width: 3,
			height: 1,
			method: 2,
			bitsPerPixel: 8,
			elementSize: 1,
			elementsPerSlice: 1,
			paletteSize: 3,
			hasAlpha: false,
		};
		const data = gpFile({
			method: 2,
			bits: 8,
			elementSize: 1,
			elementsPerSlice: 1,
			paletteSize: 3,
			width: 3,
			height: 1,
			body,
		});
		const head = readGpLayout(data);
		if (!head) throw new Error("the head of the fixture stands");
		expect(head.method).toBe(2);
		const drawn = unpackGpPicture(data, layout);
		expect([...drawn.pixels]).toEqual([
			0x99, 0x88, 0x77, 0, 0x99, 0x88, 0x77, 0, 0x33, 0x22, 0x11, 0,
		]);
	});

	it("tells a picture of its own by the shape of its head", async () => {
		const good = gpFile({
			method: 0,
			bits: 24,
			width: 1,
			height: 1,
			body: Buffer.alloc(3),
		});
		expect(await gpImageFormat.detect?.(new BufferByteSource(good))).toBe(true);
		const bad = Buffer.from(good);
		bad[1] = 7;
		expect(await gpImageFormat.detect?.(new BufferByteSource(bad))).toBe(false);
	});
});
