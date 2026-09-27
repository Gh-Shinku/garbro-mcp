// The pictures of the engine of LiveMaker of the shape `GaleX200` (GARbro "ArcFormats/LiveMaker/
// ImageGALX.cs", class GalXFormat, and "ArcFormats/LiveMaker/ArcGALX.cs", class GalXOpener), against files
// built in the test: a head of XML of zlib and the counts of the places of the picture behind it.
import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import {
	galxArchiveFormat,
	galxImageFormat,
	readGalxHead,
	readGalxFrame,
} from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { buffer as consumeBuffer } from "node:stream/consumers";

/** The XML of the head of a picture of the engine, of the counts given. */
function xml(frames: { pixels: Buffer; alpha?: Buffer }[], bits = 32): string {
	const head =
		`<Frames Width="2" Height="1" Bpp="${bits}" Version="100" Count="${frames.length}" ` +
		`Randomized="0" CompType="0" BGColor="0" BlockWidth="0" BlockHeight="0">`;
	const body = frames
		.map(
			(frame) =>
				`<Frame><Layers Count="1" Width="2" Height="1" Bpp="${bits}">` +
				`<Layer AlphaOn="${undefined === frame.alpha ? "0" : "1"}"/></Layers></Frame>`,
		)
		.join("");
	return `${head}${body}</Frames>`;
}

/** A picture of the shape `GaleX200`, of the counts of the places of its frames. */
function galxFile(
	frames: { pixels: Buffer; alpha?: Buffer }[],
	options: { bits?: number } = {},
): Buffer {
	const head = deflateSync(
		Buffer.from(xml(frames, options.bits ?? 32), "utf8"),
	);
	const parts: Buffer[] = [];
	for (const frame of frames) {
		const size = Buffer.alloc(4, 0x00);
		size.writeInt32LE(frame.pixels.length, 0);
		parts.push(size, frame.pixels);
		if (frame.alpha) {
			const alphaSize = Buffer.alloc(4, 0x00);
			alphaSize.writeInt32LE(frame.alpha.length, 0);
			parts.push(alphaSize, frame.alpha);
		}
	}
	const out = Buffer.alloc(12 + head.length, 0x00);
	out.write("GaleX200", 0, "latin1");
	out.writeInt32LE(head.length, 8);
	head.copy(out, 12);
	return Buffer.concat([out, ...parts]);
}

/** The places of two places of a picture of the engine, of the places of the colours given. */
function places(first: number[], second: number[]): Buffer {
	return Buffer.from([...first, ...second]);
}

describe("LiveMaker engine picture of the shape GaleX200", () => {
	it("reads the head of a picture of the engine, of the XML of it", async () => {
		const file = galxFile([
			{ pixels: places([1, 2, 3, 4], [5, 6, 7, 8]) },
			{
				pixels: places([9, 10, 11, 12], [13, 14, 15, 16]),
				alpha: Buffer.from([0x40, 0x40, 0x80, 0x80]),
			},
		]);
		const head = await readGalxHead(file);
		if (!head) throw new Error("no head");
		expect(head.meta.version).toBe(100);
		expect(head.frames.length).toBe(2);
		// The places of the frames stand behind the XML, of the count of the places of it.
		const dataOffset = 12 + file.readInt32LE(8);
		expect([
			head.frames[0]?.offset,
			head.frames[0]?.size,
			head.frames[1]?.offset,
			head.frames[1]?.size,
		]).toEqual([dataOffset, 12, dataOffset + 12, 20]);
		expect(head.frames[0]?.alphaOn).toEqual([false]);
		expect(head.frames[1]?.alphaOn).toEqual([true]);
		// The places of a picture of the engine stand of the walk of the name `GAL` itself, of the counts
		// of the XML: a picture of the count of the version one hundred stands of the places as they stand.
		const frame = await readGalxFrame(file, head, 0, 1);
		expect(frame?.layers.length).toBe(1);
		expect([...(frame?.layers[0]?.pixels ?? Buffer.alloc(0))]).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8,
		]);
		// A head of no word of the engine, and one of a count of the version behind the counts of the
		// reference, stand of no head at all.
		const wrong = galxFile([{ pixels: places([1, 2, 3, 4], [5, 6, 7, 8]) }]);
		wrong.write("GaleX100", 0, "latin1");
		expect(await readGalxHead(wrong)).toBeUndefined();
		expect(await readGalxHead(Buffer.alloc(0x40, 0x00))).toBeUndefined();
	});

	it("reads the picture of a file of the shape GaleX200", async () => {
		const file = galxFile([
			{ pixels: places([1, 2, 3, 4], [5, 6, 7, 8]) },
			{ pixels: places([9, 10, 11, 12], [13, 14, 15, 16]) },
		]);
		const source = new BufferByteSource(file);
		expect(await galxImageFormat.detect(source, "/tmp/picture.gal")).toBe(true);
		const handle = await galxImageFormat.open(source, "/tmp/picture.gal");
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"picture.bmp",
			]);
			const picture = await consumeBuffer(
				await handle.openEntry(handle.entries[0]?.id ?? "0"),
			);
			expect(picture.toString("latin1", 0, 2)).toBe("BM");
			expect(picture.readUInt16LE(28)).toBe(32);
			// The picture stands of the places of the first frame of the file, of its own colours.
			expect([...picture.subarray(54, 62)]).toEqual([
				1, 2, 3, 255, 5, 6, 7, 255,
			]);
		} finally {
			await handle.close();
		}
	});

	it("reads every frame of a file of the shape GaleX200 as a picture of its own", async () => {
		const file = galxFile([
			{ pixels: places([1, 2, 3, 4], [5, 6, 7, 8]) },
			{
				pixels: places([9, 10, 11, 12], [13, 14, 15, 16]),
				alpha: Buffer.from([0x40, 0x40, 0x80, 0x80]),
			},
		]);
		const source = new BufferByteSource(file);
		expect(await galxArchiveFormat.detect(source, "/tmp/frames.galx")).toBe(
			true,
		);
		const handle = await galxArchiveFormat.open(source, "/tmp/frames.galx");
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"frames#0000",
				"frames#0001",
			]);
			expect(handle.entries.map((entry) => entry.size)).toEqual([12n, 20n]);
			expect(handle.metadata?.count).toBe(2);
			const first = await consumeBuffer(
				await handle.openEntry(handle.entries[0]?.id ?? "0"),
			);
			expect([...first.subarray(54, 62)]).toEqual([1, 2, 3, 255, 5, 6, 7, 255]);
			const second = await consumeBuffer(
				await handle.openEntry(handle.entries[1]?.id ?? "1"),
			);
			// A frame that stands of the places of a colour of its own stands of the counts of them: the
			// place of the colour of a picture of the engine stands of the places of the colour of the
			// frame (`0x40` of the places of the colour of both places of the picture here).
			expect([...second.subarray(54, 62)]).toEqual([
				9, 10, 11, 0x40, 13, 14, 15, 0x40,
			]);
		} finally {
			await handle.close();
		}
	});

	it("reads no file of no head of the shape, and of no count of places behind it", async () => {
		const other = new BufferByteSource(Buffer.alloc(0x40, 0x00));
		expect(await galxImageFormat.detect(other, "/tmp/other.gal")).toBe(false);
		expect(await galxArchiveFormat.detect(other, "/tmp/other.galx")).toBe(
			false,
		);
		// A frame whose counts of places reach past the end of the file stands of no picture at all.
		const file = galxFile([{ pixels: places([1, 2, 3, 4], [5, 6, 7, 8]) }]);
		const short = Buffer.concat([file.subarray(0, 12), Buffer.alloc(0)]);
		short.write("GaleX200", 0, "latin1");
		expect(
			await readGalxHead(file.subarray(0, file.length - 4)),
		).toBeUndefined();
	});
});
