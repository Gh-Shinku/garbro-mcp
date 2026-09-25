import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { rctImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readRctLayout } from "../../packages/formats/src/majiro/rct-image.js";

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
