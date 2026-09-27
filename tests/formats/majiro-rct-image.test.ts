import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import {
	BufferByteSource,
	FileByteSource,
	GarbroError,
} from "@garbro-mcp/core";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { afterEach } from "vitest";
import { rctImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readRctLayout } from "../../packages/formats/src/majiro/rct-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** The head of a picture of the engine: the places of the head of it, then the walk of its places. */
function rctFile(
	width: number,
	height: number,
	body: Buffer,
	options: { kind?: string; version?: number; base?: number } = {},
): Buffer {
	const version = options.version ?? 0;
	const head: Buffer = Buffer.alloc(1 === version ? 0x16 : 0x14, 0x00);
	head.writeUInt32LE(0x9a925a98, 0);
	head.write("T", 4, "latin1");
	head.write(options.kind ?? "C", 5, "latin1");
	head.write("0", 6, "latin1");
	head.write(String(version), 7, "latin1");
	head.writeUInt32LE(width, 8);
	head.writeUInt32LE(height, 12);
	head.writeInt32LE(body.length, 16);
	if (1 === version) head.writeUInt16LE(options.base ?? 0, 0x14);
	return Buffer.concat([head, body]);
}

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

/** A directory of its own for a picture and the picture of its own name beside it. */
async function temporaryDirectory(): Promise<string> {
	const directory = await mkdtemp(resolve(tmpdir(), "garbro-rct-test-"));
	temporaryDirectories.push(directory);
	return directory;
}

/** A walk of the picture that stands of the places of the file itself alone, three of them to a run. */
function plainWalk(pixels: Buffer): Buffer {
	const parts: number[] = [];
	for (let at = 0; at < 3 && at < pixels.length; at += 1) {
		parts.push(pixels[at] ?? 0);
	}
	for (let at = 3; at < pixels.length; at += 3) {
		// A count of nought stands of the three places of the file behind the run of its own.
		parts.push(0x00);
		for (let index = at; index < at + 3 && index < pixels.length; index += 1) {
			parts.push(pixels[index] ?? 0);
		}
	}
	return Buffer.from(parts);
}

/** The places of the colour of every pixel of a picture of four by three. */
function placesOfColour(
	colour: readonly [number, number, number],
	width: number,
	height: number,
): Buffer {
	const pixels = Buffer.alloc(width * height * 3, 0x00);
	for (let at = 0; at < pixels.length; at += 3) {
		pixels[at] = colour[0];
		pixels[at + 1] = colour[1];
		pixels[at + 2] = colour[2];
	}
	return pixels;
}

async function bmpOf(data: Buffer): Promise<Buffer> {
	const handle = await rctImageFormat.open(
		new BufferByteSource(data),
		"cg.rct",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/** The places of the colours of a bitmap, of the rows of it from the top of the picture down. */
function pixelsOf(bytes: Buffer, width: number, height: number): number[] {
	const stride = (width * 3 + 3) & ~3;
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		for (let at = 0; at < width * 3; at += 1) {
			out.push(bytes[0x36 + row * stride + at] ?? 0);
		}
	}
	return out;
}

async function placesOf(data: Buffer, width: number, height: number) {
	return pixelsOf(await bmpOf(data), width, height);
}

describe("Majiro game engine RGB image", () => {
	it("reads a picture standing over a picture of its own name beside it", async () => {
		const width = 4;
		const height = 3;
		const base = placesOfColour([0x01, 0x02, 0x03], width, height);
		// Every fourth place of the picture stands of the key of no place of its own, of the other places of
		// the picture of its own colours.
		const overlay = Buffer.from(base);
		const key = (at: number): void => {
			overlay[at] = 0x00;
			overlay[at + 1] = 0x00;
			overlay[at + 2] = 0xff;
		};
		overlay[0] = 0x11;
		overlay[1] = 0x12;
		overlay[2] = 0x13;
		key(3);
		overlay[6] = 0x21;
		overlay[7] = 0x22;
		overlay[8] = 0x23;
		key(9);
		for (let at = 12; at < overlay.length; at += 3) {
			overlay[at] = 0x31;
			overlay[at + 1] = 0x32;
			overlay[at + 2] = 0x33;
		}
		const directory = await temporaryDirectory();
		await writeFile(
			resolve(directory, "base.rct"),
			rctFile(width, height, plainWalk(base)),
		);
		const name = Buffer.from("base.rct\u0000", "latin1");
		const overPath = resolve(directory, "over.rct");
		await writeFile(
			overPath,
			rctFile(width, height, Buffer.concat([name, plainWalk(overlay)]), {
				version: 1,
				base: name.length,
			}),
		);
		const handle = await rctImageFormat.open(
			await FileByteSource.open(overPath),
			overPath,
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const places = pixelsOf(
			await consumeBuffer(await handle.openEntry(entry.id)),
			width,
			height,
		);
		// The places of the key stand of the picture beneath, of every other place of the picture itself.
		expect(places).toEqual([
			0x11, 0x12, 0x13, 0x01, 0x02, 0x03, 0x21, 0x22, 0x23, 0x01, 0x02, 0x03,
			0x31, 0x32, 0x33, 0x31, 0x32, 0x33, 0x31, 0x32, 0x33, 0x31, 0x32, 0x33,
			0x31, 0x32, 0x33, 0x31, 0x32, 0x33, 0x31, 0x32, 0x33, 0x31, 0x32, 0x33,
		]);
	});

	it("reads a picture of its own name that stands nowhere as it stands", async () => {
		const width = 2;
		const height = 2;
		const overlay = placesOfColour([0x41, 0x42, 0x43], width, height);
		const directory = await temporaryDirectory();
		const name = Buffer.from("nowhere.rct\u0000", "latin1");
		const overPath = resolve(directory, "over.rct");
		await writeFile(
			overPath,
			rctFile(width, height, Buffer.concat([name, plainWalk(overlay)]), {
				version: 1,
				base: name.length,
			}),
		);
		const handle = await rctImageFormat.open(
			await FileByteSource.open(overPath),
			overPath,
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(
			pixelsOf(
				await consumeBuffer(await handle.openEntry(entry.id)),
				width,
				height,
			),
		).toEqual([...overlay]);
	});

	it("reads a picture of its own name of no count of the picture itself as it stands", async () => {
		const width = 2;
		const height = 2;
		const overlay = placesOfColour([0x51, 0x52, 0x53], width, height);
		const directory = await temporaryDirectory();
		// The picture beside it stands of another count of pixels, so the reference leaves it out.
		await writeFile(
			resolve(directory, "base.rct"),
			rctFile(1, 1, plainWalk(Buffer.from([0x61, 0x62, 0x63]))),
		);
		const name = Buffer.from("base.rct\u0000", "latin1");
		const overPath = resolve(directory, "over.rct");
		await writeFile(
			overPath,
			rctFile(width, height, Buffer.concat([name, plainWalk(overlay)]), {
				version: 1,
				base: name.length,
			}),
		);
		const handle = await rctImageFormat.open(
			await FileByteSource.open(overPath),
			overPath,
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(
			pixelsOf(
				await consumeBuffer(await handle.openEntry(entry.id)),
				width,
				height,
			),
		).toEqual([...overlay]);
	});

	it("reads a picture standing of the mask of its own name beside it", async () => {
		const width = 2;
		const height = 2;
		const pixels = placesOfColour([0x11, 0x12, 0x13], width, height);
		const directory = await temporaryDirectory();
		const picturePath = resolve(directory, "cg.rct");
		await writeFile(picturePath, rctFile(width, height, plainWalk(pixels)));
		// A mask of the engine beside the picture: a colour map whose entry of a place of the file stands of
		// that count three times over, and the places of the file of the mask of four pixels.
		const head = Buffer.alloc(0x14, 0x00);
		head.writeUInt32LE(0x9a925a98, 0);
		head.write("8_00", 4, "latin1");
		head.writeUInt32LE(width, 8);
		head.writeUInt32LE(height, 12);
		const palette = Buffer.alloc(0x300, 0x00);
		for (let entry = 0; entry < 0x100; entry += 1) {
			palette[entry * 3] = entry;
			palette[entry * 3 + 1] = entry;
			palette[entry * 3 + 2] = entry;
		}
		const indices = Buffer.from([0, 51, 102, 153]);
		const walk: number[] = [];
		for (let at = 0; at < indices.length; at += 1) {
			walk.push(indices[at] ?? 0);
			if (at + 1 < indices.length) walk.push(0x00);
		}
		await writeFile(
			resolve(directory, "cg_.rc8"),
			Buffer.concat([head, palette, Buffer.from(walk)]),
		);
		const handle = await rctImageFormat.open(
			await FileByteSource.open(picturePath),
			picturePath,
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const image = readBmpImage(
			await consumeBuffer(await handle.openEntry(entry.id)),
		);
		expect(image).toMatchObject({ width, height, bitsPerPixel: 32 });
		// The covering place of a pixel stands of the colour the colour map of the mask holds at the place of
		// the file of the mask of that pixel, taken off the whole of the places of a colour of it.
		expect([...(image?.pixels ?? [])]).toEqual([
			0x11, 0x12, 0x13, 0xff, 0x11, 0x12, 0x13, 0xcc, 0x11, 0x12, 0x13, 0x99,
			0x11, 0x12, 0x13, 0x66,
		]);
	});

	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const good = rctFile(2, 2, Buffer.alloc(3, 0x00));
		const layout = readRctLayout(good);
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(2);
		expect(layout?.version).toBe(0);
		expect(layout?.encrypted).toBe(false);
		// The places of the walk of the picture stand behind the head of it.
		expect(layout?.dataOffset).toBe(0x14);
		const second = rctFile(2, 2, Buffer.alloc(3, 0x00), {
			version: 1,
			base: 4,
		});
		expect(readRctLayout(second)?.dataOffset).toBe(0x16);
		expect(readRctLayout(second)?.baseNameLength).toBe(4);
		// The head of a picture of a key stands of the places of the file of it alone.
		const key = rctFile(2, 2, Buffer.alloc(3, 0x00), { kind: "S" });
		expect(readRctLayout(key)?.encrypted).toBe(true);
		const wrongMark = Buffer.from(good);
		wrongMark.writeUInt32LE(0, 0);
		expect(readRctLayout(wrongMark)).toBeUndefined();
		const wrongKind = Buffer.from(good);
		wrongKind[4] = 0x53;
		expect(readRctLayout(wrongKind)).toBeUndefined();
		const wrongNumber = Buffer.from(good);
		wrongNumber[6] = 0x31;
		expect(readRctLayout(wrongNumber)).toBeUndefined();
		const wrongVersion = Buffer.from(good);
		wrongVersion[7] = 0x32;
		expect(readRctLayout(wrongVersion)).toBeUndefined();
		expect(readRctLayout(good.subarray(0, 0x13))).toBeUndefined();
		expect(readRctLayout(Buffer.alloc(0x20, 0x00))).toBeUndefined();
	});

	it("reads a picture of a place of the file of its own", async () => {
		const data = rctFile(1, 1, Buffer.from([0x11, 0x22, 0x33]));
		expect(await placesOf(data, 1, 1)).toEqual([0x11, 0x22, 0x33]);
	});

	it("reads the places of a picture of the places of the pixel before them", async () => {
		// The walk of the engine stands of the places of a pixel of the picture before the place of it:
		// the place of the walk of the second pixel names the places of the file of the first of them.
		const data = rctFile(2, 1, Buffer.from([0x11, 0x22, 0x33, 0x80]));
		expect(await placesOf(data, 2, 1)).toEqual([
			0x11, 0x22, 0x33, 0x11, 0x22, 0x33,
		]);
	});

	it("reads the places of a picture of the run of the second kind", async () => {
		// The places behind the count of a run of the walk of the second kind stand of the count of the
		// places of the file behind it, of no more than three places of a pixel of the picture: the run of
		// this walk stands of four places of the pixel before it.
		const data = rctFile(
			5,
			1,
			Buffer.from([0x11, 0x22, 0x33, 0x83, 0x00, 0x00]),
		);
		expect(await placesOf(data, 5, 1)).toEqual([
			0x11, 0x22, 0x33, 0x11, 0x22, 0x33, 0x11, 0x22, 0x33, 0x11, 0x22, 0x33,
			0x11, 0x22, 0x33,
		]);
	});

	it("reads the places of a picture of the places of the row of it", async () => {
		// The places of the table of the walk of the engine stand of the places of the picture of the run
		// behind a count of the places of a row of it and of the places of a pixel of it to either side:
		// the run of this walk stands of the place of the picture five places behind it, of the first
		// pixel of the picture.
		const data = rctFile(
			6,
			1,
			Buffer.concat([
				Buffer.from([0x11, 0x22, 0x33]),
				Buffer.from([0x01, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99]),
				Buffer.from([0x01, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]),
				Buffer.from([0x90]),
			]),
		);
		expect(await placesOf(data, 6, 1)).toEqual([
			0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc,
			0xdd, 0xee, 0xff, 0x11, 0x22, 0x33,
		]);
	});

	it("reads the places of a picture of the chunks of the file of it and of the row of it", async () => {
		// The places of the file of the walk of the engine stand of the places of the picture of the
		// chunks of it: of the places of the file of the picture of the walk of the row of the picture
		// before the walk of the engine itself (of the places of the file of the table of the walk of the
		// engine of the places of the file of the picture of it of no more than the places of the picture
		// of four of them) and of the places of the file of the count of the walk of the engine of the
		// places of the file of the picture of the row behind it.
		const data = rctFile(
			4,
			3,
			Buffer.concat([
				// The places of the file of the picture of the first row of the walk of the engine: of the
				// places of the file of a pixel of it and of the run of the three places of the file of the
				// pixel before it.
				Buffer.from([0x11, 0x22, 0x33]),
				Buffer.from([0x82]),
				// The places of the file of the picture of the second row of the walk of the engine: of the
				// places of the file of a pixel of it of its own and of the run of the three places of the
				// file of the row before it.
				Buffer.from([0x00, 0x44, 0x55, 0x66]),
				Buffer.from([0x8e]),
				// The places of the file of the picture of the third row of the walk of the engine.
				Buffer.from([0x00, 0x77, 0x88, 0x99]),
				Buffer.from([0x82]),
			]),
		);
		expect(await placesOf(data, 4, 3)).toEqual([
			0x11, 0x22, 0x33, 0x11, 0x22, 0x33, 0x11, 0x22, 0x33, 0x11, 0x22, 0x33,
			0x44, 0x55, 0x66, 0x11, 0x22, 0x33, 0x11, 0x22, 0x33, 0x11, 0x22, 0x33,
			0x77, 0x88, 0x99, 0x77, 0x88, 0x99, 0x77, 0x88, 0x99, 0x77, 0x88, 0x99,
		]);
	});

	it("reads a picture of the second kind, of the head of it of the places of the file of its own", async () => {
		const walk = Buffer.concat([
			Buffer.from([0x11, 0x22, 0x33]),
			Buffer.from([0x80]),
			Buffer.from([0x80]),
		]);
		const data = rctFile(
			3,
			1,
			Buffer.concat([Buffer.from("base", "latin1"), walk]),
			{
				version: 1,
				base: 4,
			},
		);
		expect(await placesOf(data, 3, 1)).toEqual([
			0x11, 0x22, 0x33, 0x11, 0x22, 0x33, 0x11, 0x22, 0x33,
		]);
	});

	it("turns away a picture of a key standing of no places of the file of it", async () => {
		const data = rctFile(1, 1, Buffer.from([0x11, 0x22, 0x33]), { kind: "S" });
		await expect(bmpOf(data)).rejects.toThrow(GarbroError);
	});

	it("turns away a picture of a walk standing past the places of the file of it", async () => {
		// The places of the walk of the picture stand of the places of the file of it of no more than the
		// places of the picture itself.
		const beyond = rctFile(2, 1, Buffer.from([0x11, 0x22, 0x33, 0x82]));
		await expect(bmpOf(beyond)).rejects.toThrow(GarbroError);
		const behind = rctFile(2, 1, Buffer.from([0x11, 0x22, 0x33, 0x90]));
		await expect(bmpOf(behind)).rejects.toThrow(GarbroError);
		const short = rctFile(2, 1, Buffer.from([0x11, 0x22]));
		await expect(bmpOf(short)).rejects.toThrow(GarbroError);
	});

	it("tells a picture of the engine by the head of it", async () => {
		expect(
			await rctImageFormat.detect?.(
				new BufferByteSource(rctFile(1, 1, Buffer.from([0x11, 0x22, 0x33]))),
			),
		).toBe(true);
		const wrong = rctFile(1, 1, Buffer.from([0x11, 0x22, 0x33]));
		wrong.writeUInt32LE(0, 0);
		expect(await rctImageFormat.detect?.(new BufferByteSource(wrong))).toBe(
			false,
		);
	});
});
