import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { MersenneTwister } from "@garbro-mcp/codecs";
import { exhibitGyuImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	readGyuLayout,
	unpackGyuPicture,
} from "../../packages/formats/src/exhibit/gyu-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEAD_SIZE = 0x24;
const NO_KEY = 0xffffffff;
const RAW_MODE = 0x0100;
const GYU_MODE = 0x0800;

interface GyuFixture {
	flags?: number;
	mode: number;
	key?: number;
	bpp: number;
	width: number;
	height: number;
	/** The places of the picture, before the obfuscation is taken away from them. */
	packet: Buffer;
	/** How many places the head names, where they differ from the places written. */
	dataSize?: number;
	palette?: Buffer;
	paletteSize?: number;
	alpha?: Buffer;
	alphaSize?: number;
}

/** A picture of the engine: the mark, the head, the colour map, the places of it and the alpha. */
function gyuFile(input: GyuFixture): Buffer {
	const head: Buffer = Buffer.alloc(HEAD_SIZE, 0x00);
	head.writeUInt32LE(0x1a555947, 0);
	head.writeUInt16LE(input.flags ?? 3, 4);
	head.writeUInt16LE(input.mode, 6);
	head.writeUInt32LE(input.key ?? NO_KEY, 8);
	head.writeInt32LE(input.bpp, 0xc);
	head.writeUInt32LE(input.width, 0x10);
	head.writeUInt32LE(input.height, 0x14);
	head.writeInt32LE(input.dataSize ?? input.packet.length, 0x18);
	head.writeInt32LE(input.alphaSize ?? input.alpha?.length ?? 0, 0x1c);
	head.writeInt32LE(input.paletteSize ?? 0, 0x20);
	const parts = [head];
	if (input.paletteSize) {
		const palette = input.palette ?? Buffer.alloc(input.paletteSize * 4, 0x00);
		parts.push(palette.subarray(0, input.paletteSize * 4));
	}
	parts.push(input.packet);
	if (input.alpha) parts.push(input.alpha);
	return Buffer.concat(parts);
}

/** The places of the engine written as runs over the places of a picture and the bytes of the file. */
class GyuWalk {
	private readonly out: number[] = [];
	private controlAt = -1;
	private mask = 0;

	bit(value: number): void {
		if (0 === this.mask) {
			this.controlAt = this.out.length;
			this.out.push(0x00);
			this.mask = 0x80;
		}
		if (value)
			this.out[this.controlAt] = (this.out[this.controlAt] ?? 0) | this.mask;
		this.mask = (this.mask >> 1) & 0xff;
	}

	byte(value: number): void {
		this.out.push(value & 0xff);
	}

	bits(value: number, count: number): void {
		for (let at = count - 1; at >= 0; at -= 1) this.bit((value >> at) & 1);
	}

	/** A place of the picture standing as it stands. */
	place(value: number): void {
		this.bit(1);
		this.byte(value);
	}

	/** A run of the places behind the place of the picture, of a count of one to four places. */
	shortRun(count: number, offset: number): void {
		this.bit(0);
		this.bit(0);
		this.bits(count - 2, 2);
		this.byte(offset & 0xff);
	}

	/** A run of the places behind the place of the picture, of more places than a short run holds. */
	longRun(offset: number, count: number): void {
		this.bit(0);
		this.bit(1);
		this.byte((offset >> 8) & 0xff);
		this.byte(offset & 0xff);
		if (0 === (offset & 7)) this.byte(count - 1);
	}

	bytes(): Buffer {
		return Buffer.from(this.out);
	}
}

/** The places of a picture whose runs stand of the places of the file itself, of the first four skipped. */
function gyuPacket(walk: GyuWalk, first: number): Buffer {
	return Buffer.concat([
		Buffer.alloc(4, 0x00),
		Buffer.from([first]),
		walk.bytes(),
	]);
}

/** The walks of the engine with every byte written as it stands. */
function literalPacket(bytes: Buffer): Buffer {
	const out: number[] = [];
	for (let at = 0; at < bytes.length; at += 8) {
		out.push(0xff, ...bytes.subarray(at, at + 8));
	}
	return Buffer.from(out);
}

/** The swaps the obfuscation makes of the places of a picture, of the key of it. */
function swapPlaces(data: Buffer, key: number, backwards: boolean): void {
	const twister = new MersenneTwister(key);
	const pairs: [number, number][] = [];
	for (let at = 0; at < 10; at += 1) {
		pairs.push([twister.rand() % data.length, twister.rand() % data.length]);
	}
	if (backwards) pairs.reverse();
	for (const [first, second] of pairs) {
		const place = data[first] ?? 0;
		data[first] = data[second] ?? 0;
		data[second] = place;
	}
}

async function pictureOf(data: Buffer) {
	const handle = await exhibitGyuImageFormat.open(
		new BufferByteSource(data),
		"cg.gyu",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no picture");
	return image;
}

const PALETTE = Buffer.from([10, 20, 30, 0, 40, 50, 60, 0, 70, 80, 90, 0]);

describe("ExHIBIT engine image", () => {
	it("reads the head of a picture of the engine", () => {
		const data = gyuFile({
			mode: RAW_MODE,
			bpp: 8,
			width: 4,
			height: 2,
			packet: Buffer.alloc(8, 0x00),
			palette: PALETTE,
			paletteSize: 3,
		});
		const layout = readGyuLayout(data);
		expect(layout).toEqual({
			flags: 3,
			compressionMode: RAW_MODE,
			key: NO_KEY,
			bitsPerPixel: 8,
			width: 4,
			height: 2,
			dataSize: 8,
			alphaSize: 0,
			paletteSize: 3,
		});
		const stray = Buffer.from(data);
		stray.writeUInt32LE(0x1a555948, 0);
		expect(readGyuLayout(stray)).toBeUndefined();
		expect(readGyuLayout(data.subarray(0, 0x23))).toBeUndefined();
	});

	it("refuses a picture that carries no key of its own", async () => {
		const data = gyuFile({
			mode: RAW_MODE,
			key: 0,
			bpp: 8,
			width: 4,
			height: 2,
			packet: Buffer.alloc(8, 0x00),
			palette: PALETTE,
			paletteSize: 3,
		});
		// The head of the picture stands of no key at all, and the reference asks the user for one.
		const handle = await exhibitGyuImageFormat.open(
			new BufferByteSource(data),
			"cg.gyu",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toMatchObject({
			code: "UNSUPPORTED_FEATURE",
		});
	});

	it("reads a picture of eight places to a place, of the colour map behind its head", async () => {
		// Two rows of four places, of the padding of a row standing behind the places of it.
		const packet = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const image = await pictureOf(
			gyuFile({
				mode: RAW_MODE,
				bpp: 8,
				width: 4,
				height: 2,
				packet,
				palette: PALETTE,
				paletteSize: 3,
			}),
		);
		expect(image.bitsPerPixel).toBe(8);
		expect([...image.pixels]).toEqual([5, 6, 7, 8, 1, 2, 3, 4]);
	});

	it("reads a picture of three places to a place, of the padding of its rows", async () => {
		const packet = Buffer.from([
			1, 2, 3, 4, 5, 6, 0, 0, 7, 8, 9, 10, 11, 12, 0, 0,
		]);
		const image = await pictureOf(
			gyuFile({ mode: RAW_MODE, bpp: 24, width: 2, height: 2, packet }),
		);
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual([7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]);
	});

	it("reads the runs of the engine over the places it has read", () => {
		const walk = new GyuWalk();
		walk.shortRun(3, 0xff);
		const packet = gyuPacket(walk, 0x20);
		const data = gyuFile({
			mode: GYU_MODE,
			bpp: 8,
			width: 4,
			height: 1,
			packet,
			palette: PALETTE,
			paletteSize: 3,
		});
		const layout = readGyuLayout(data);
		if (!layout) throw new Error("the picture stands of no head of its own");
		const image = unpackGyuPicture(data, layout);
		expect([...(readBmpImage(image)?.pixels ?? [])]).toEqual([
			0x20, 0x20, 0x20, 0x20,
		]);
	});

	it("reads a run of the engine standing of a count of places of its own", () => {
		// A picture of eight thousand three hundred and twenty places: the runs of the engine name the
		// places of it of a count of their own, which stands of a walk of the places of the file.
		const width = 64;
		const height = 130;
		const stride = width;
		const walk = new GyuWalk();
		for (let at = 0; at < 8192; at += 1) walk.place(at & 0xff);
		walk.longRun(8, 6);
		for (let at = 0; at < stride * height - 8198; at += 1) walk.place(0x7f);
		const packet = gyuPacket(walk, 0x11);
		const data = gyuFile({
			mode: GYU_MODE,
			bpp: 8,
			width,
			height,
			packet,
			palette: PALETTE,
			paletteSize: 3,
		});
		const layout = readGyuLayout(data);
		if (!layout) throw new Error("the picture stands of no head of its own");
		const picture = unpackGyuPicture(data, layout);
		const image = readBmpImage(picture);
		if (!image) throw new Error("the port handed over no picture");
		const places = image.pixels;
		// The places of the picture stand from its bottom up, of the rows of it of sixty four places.
		expect(places[0]).toBe(0x7f);
		expect(places[8256]).toBe(0x11);
		expect([...places.subarray(65, 71)]).toEqual([1, 2, 3, 4, 5, 6]);
		expect(places[44]).toBe(0x7f);
	});

	it("reads the walks of the engine standing of the places of the file", async () => {
		const indices = Buffer.from([9, 8, 7, 6]);
		const image = await pictureOf(
			gyuFile({
				mode: 0x0000,
				bpp: 8,
				width: 4,
				height: 1,
				packet: literalPacket(indices),
				palette: PALETTE,
				paletteSize: 3,
			}),
		);
		expect(image.bitsPerPixel).toBe(8);
		expect([...image.pixels]).toEqual([...indices]);
	});

	it("reads the alpha behind the colours of a picture", async () => {
		const packet = Buffer.from([0, 1, 0, 0, 1, 0, 1, 0]);
		const alpha = Buffer.from([0x00, 0x0f, 0x10, 0xff, 0x08, 0x00, 0x20, 0x01]);
		const image = await pictureOf(
			gyuFile({
				mode: RAW_MODE,
				flags: 0,
				bpp: 8,
				width: 3,
				height: 2,
				packet,
				palette: PALETTE,
				paletteSize: 3,
				alpha,
			}),
		);
		expect(image.bitsPerPixel).toBe(32);
		// The places of the picture stand from its bottom up, and every place of the alpha behind it
		// stands of the alpha of the file, of the places of it of a count of sixteen.
		expect([...image.pixels]).toEqual([
			40, 50, 60, 0x80, 10, 20, 30, 0x00, 40, 50, 60, 0xff, 10, 20, 30, 0x00,
			40, 50, 60, 0xf0, 10, 20, 30, 0xff,
		]);
	});

	it("takes the obfuscation away from the places of a picture", async () => {
		const indices = Buffer.from([0, 2, 1, 2, 2, 1, 0, 1]);
		const packet = Buffer.from(indices);
		swapPlaces(packet, 0x12345678, true);
		const image = await pictureOf(
			gyuFile({
				mode: RAW_MODE,
				key: 0x12345678,
				bpp: 8,
				width: 4,
				height: 2,
				packet,
				palette: PALETTE,
				paletteSize: 3,
			}),
		);
		expect([...image.pixels]).toEqual([2, 1, 0, 1, 0, 2, 1, 2]);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = gyuFile({
			mode: RAW_MODE,
			bpp: 8,
			width: 4,
			height: 2,
			packet: Buffer.alloc(8, 0x00),
		});
		expect(
			await exhibitGyuImageFormat.detect?.(new BufferByteSource(data)),
		).toBe(true);
		const wrong = Buffer.from(data);
		wrong.writeUInt32LE(0x1a555948, 0);
		expect(
			await exhibitGyuImageFormat.detect?.(new BufferByteSource(wrong)),
		).toBe(false);
		await expect(
			exhibitGyuImageFormat.open(new BufferByteSource(wrong), "cg.gyu"),
		).rejects.toThrow(GarbroError);
	});
});
