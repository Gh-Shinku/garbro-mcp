import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readTanLayout,
	unpackTanFrame,
	ikuraTanImageFormat,
} from "../../packages/formats/src/ikura/tan-image.js";

/** A colour map whose entry `i` is the four bytes `i`, `i + 1`, `i + 2`, nothing. */
function paletteBytes(): Buffer {
	const palette = Buffer.alloc(0x400);
	for (let i = 0; i < 0x100; i += 1) {
		palette[i * 4] = i;
		palette[i * 4 + 1] = (i + 1) & 0xff;
		palette[i * 4 + 2] = (i + 2) & 0xff;
	}
	return palette;
}

/** A file: a record, the measurements, the colour map, the frame table and one frame. */
function tanFile(width: number, height: number, frame: Buffer): Buffer {
	const head = Buffer.alloc(2 + 4 + 4);
	head.writeUInt16LE(1, 0);
	head.writeUInt16LE(width, 6);
	head.writeUInt16LE(height, 8);
	const table = Buffer.alloc(2 + 4);
	table.writeUInt16LE(1, 0);
	table.writeUInt32LE(0, 2);
	return Buffer.concat([head, paletteBytes(), table, frame]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await ikuraTanImageFormat.open(
		new BufferByteSource(data),
		"anim.tan",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** One literal, two literals, then a copy of the byte before the run. */
const FRAME = Buffer.from([5, 0xaa, 6, 0xbb, 0xcc, 1, 0x01, 0x01]);

describe("D.O. animation image", () => {
	it("reads the head as the reference does", () => {
		const layout = readTanLayout(tanFile(2, 2, FRAME));
		expect(layout).toEqual({ width: 2, height: 2, dataOffset: 10 });
	});

	it("gates on the extension and the head", async () => {
		const data = tanFile(2, 2, FRAME);
		expect(
			await ikuraTanImageFormat.detect(new BufferByteSource(data), "anim.tan"),
		).toBe(true);
		// The reference only looks at a file whose name carries the extension.
		expect(
			await ikuraTanImageFormat.detect(new BufferByteSource(data), "anim.bin"),
		).toBe(false);
		// A count of no records is refused.
		const none = Buffer.from(data);
		none.writeUInt16LE(0, 0);
		expect(readTanLayout(none)).toBeUndefined();
		// So is a picture of no size.
		const empty = Buffer.from(data);
		empty.writeUInt16LE(0, 6);
		expect(readTanLayout(empty)).toBeUndefined();
	});

	it("reports the measurements of the first frame", async () => {
		const handle = await ikuraTanImageFormat.open(
			new BufferByteSource(tanFile(2, 2, FRAME)),
			"dir/anim.tan",
		);
		expect(handle.entries[0]?.path).toBe("anim.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 8,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "rle",
			colors: 0x100,
		});
	});

	it("unfolds the first frame and writes it out with its colour map", async () => {
		const out = await extract(tanFile(2, 2, FRAME));
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.readInt32LE(0x12)).toBe(2);
		expect(out.readInt32LE(0x16)).toBe(-2);
		// Two rows of two pixels, each padded to four bytes.
		expect(out.subarray(0x436).toString("hex")).toBe("aabb0000cccc0000");
		// The colour map is the stored one, which is already the order a bitmap wants.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0001020001020300");
	});

	it("declines a file that does not hold a frame", async () => {
		const short = tanFile(2, 2, FRAME).subarray(0, 12);
		expect(readTanLayout(short)).toBeDefined();
		const handle = await ikuraTanImageFormat.open(
			new BufferByteSource(short),
			"anim.tan",
		);
		await expect(handle.openEntry("0")).rejects.toThrow(GarbroError);
		await expect(handle.openEntry("0")).rejects.toThrow("colour map");
	});

	it("unfolds each kind of command", () => {
		const layout = { width: 4, height: 1, dataOffset: 0 };
		const file = (frame: Buffer) =>
			Buffer.concat([
				Buffer.alloc(0x400),
				Buffer.from([1, 0, 0, 0, 0, 0]),
				frame,
			]);
		// A repeat of one value.
		expect(
			unpackTanFrame(file(Buffer.from([0, 4, 0x7f])), layout).pixels.toString(
				"hex",
			),
		).toBe("7f7f7f7f");
		// A copy from one byte behind.
		expect(
			unpackTanFrame(
				file(Buffer.from([5, 1, 5, 2, 1, 1, 1, 5, 3])),
				layout,
			).pixels.toString("hex"),
		).toBe("01020203");
		// A copy with a word of distance.
		expect(
			unpackTanFrame(
				file(Buffer.from([5, 1, 5, 2, 2, 1, 2, 0, 5, 3])),
				layout,
			).pixels.toString("hex"),
		).toBe("01020103");
		// Pixels left as they stand.
		expect(
			unpackTanFrame(
				file(Buffer.from([3, 2, 6, 6, 7])),
				layout,
			).pixels.toString("hex"),
		).toBe("00000607");
	});

	it("refuses a command that reaches outside the frame", () => {
		const layout = { width: 2, height: 1, dataOffset: 0 };
		const file = (frame: Buffer) =>
			Buffer.concat([
				Buffer.alloc(0x400),
				Buffer.from([1, 0, 0, 0, 0, 0]),
				frame,
			]);
		expect(() => unpackTanFrame(file(Buffer.from([0, 8, 1])), layout)).toThrow(
			"past its own frame",
		);
		expect(() => unpackTanFrame(file(Buffer.from([1, 8, 1])), layout)).toThrow(
			"past its own frame",
		);
		expect(() =>
			unpackTanFrame(
				Buffer.concat([Buffer.alloc(0x400), Buffer.from([0, 0, 0, 0])]),
				layout,
			),
		).toThrow("does not hold that frame");
	});
});
