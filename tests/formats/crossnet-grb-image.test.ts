import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	crossNetGrbImageFormat,
	readGrbLayout,
	unpackGrb,
} from "../../packages/formats/src/crossnet/grb-image.js";

/** A colour map whose entry `i` is the four bytes `i`, `i + 1`, `i + 2`, nothing. */
function paletteBytes(bpp: number): Buffer {
	const entries = 1 << bpp;
	const palette = Buffer.alloc(entries * 4);
	for (let i = 0; i < entries; i += 1) {
		palette[i * 4] = i & 0xff;
		palette[i * 4 + 1] = (i + 1) & 0xff;
		palette[i * 4 + 2] = (i + 2) & 0xff;
	}
	return palette;
}

interface GrbOptions {
	bpp?: number;
	rows: Buffer;
	control: Buffer;
	literals: Buffer;
	palette?: Buffer;
}

/** A file: the head, the colour map, one byte a row, the control bytes and the literal pixels. */
function grbFile(width: number, height: number, options: GrbOptions): Buffer {
	const bpp = options.bpp ?? 8;
	const palette = options.palette ?? paletteBytes(bpp);
	const head = Buffer.alloc(0x18);
	head.writeInt32LE(bpp, 0);
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	const bitsOffset = 0x18 + palette.length + options.rows.length;
	const dataOffset = bitsOffset + options.control.length;
	head.writeUInt32LE(bitsOffset, 8);
	head.writeUInt32LE(dataOffset, 0x10);
	return Buffer.concat([
		head,
		palette,
		options.rows,
		options.control,
		options.literals,
	]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await crossNetGrbImageFormat.open(
		new BufferByteSource(data),
		"pic.grb",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("CrossNet image", () => {
	it("reads the head as the reference does", () => {
		const data = grbFile(2, 1, {
			rows: Buffer.from([0]),
			control: Buffer.from([0]),
			literals: Buffer.alloc(4),
		});
		expect(readGrbLayout(data)).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 8,
			paddedWidth: 4,
			stride: 4,
		});
		// One bit a pixel rounds its width up to thirty two and walks an eighth of it.
		const narrow = grbFile(8, 1, {
			bpp: 1,
			rows: Buffer.from([0]),
			control: Buffer.from([0]),
			literals: Buffer.alloc(4),
		});
		expect(readGrbLayout(narrow)).toMatchObject({
			bitsPerPixel: 1,
			paddedWidth: 32,
			stride: 4,
		});
	});

	it("gates on the depth, the measurements and the offsets", () => {
		const good = grbFile(2, 1, {
			rows: Buffer.from([0]),
			control: Buffer.from([0]),
			literals: Buffer.alloc(4),
		});
		expect(readGrbLayout(good)).toBeDefined();
		// Only one and eight bits a pixel are registered.
		const odd = Buffer.from(good);
		odd.writeInt32LE(4, 0);
		expect(readGrbLayout(odd)).toBeUndefined();
		// The measurements may not be nothing or too wide.
		const wide = Buffer.from(good);
		wide.writeUInt16LE(0x8001, 4);
		expect(readGrbLayout(wide)).toBeUndefined();
		// And the offsets have to stand inside the file and behind the head.
		const shallow = Buffer.from(good);
		shallow.writeUInt32LE(4, 8);
		expect(readGrbLayout(shallow)).toBeUndefined();
	});

	it("reads the pixels that stand in the stream themselves", () => {
		const data = grbFile(2, 1, {
			rows: Buffer.from([0]),
			control: Buffer.from([0x00]),
			literals: Buffer.from([0x11, 0x22, 0x33, 0x44]),
		});
		const layout = readGrbLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackGrb(data, layout).pixels.toString("hex")).toBe("11223344");
	});

	it("takes a pixel again from the place the row code names", () => {
		// The row code of one names the three places to the left, so the bytes behind the literal repeat it.
		const data = grbFile(4, 1, {
			rows: Buffer.from([1]),
			control: Buffer.from([0x1b]),
			literals: Buffer.from([0xaa]),
		});
		const layout = readGrbLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackGrb(data, layout).pixels.toString("hex")).toBe("aaaaaaaa");
	});

	it("refuses a reference that reaches before the start of the picture", () => {
		const data = grbFile(4, 1, {
			rows: Buffer.from([0]),
			control: Buffer.from([0x60]),
			literals: Buffer.from([0xaa]),
		});
		const layout = readGrbLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => unpackGrb(data, layout)).toThrow(GarbroError);
		expect(() => unpackGrb(data, layout)).toThrow("before its own start");
	});

	it("writes a one bit picture out with its two colours", async () => {
		// A row of one bit is walked as four bytes of the rounded row, of which only the first is the picture.
		const data = grbFile(8, 1, {
			bpp: 1,
			rows: Buffer.from([0]),
			control: Buffer.from([0x00]),
			literals: Buffer.from([0xff, 0x00, 0x00, 0x00]),
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(1);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x2e)).toBe(2);
		expect(out.subarray(0x3e).toString("hex")).toBe("ff000000");
	});

	it("writes an eight bit picture out with its colour map", async () => {
		const data = grbFile(4, 1, {
			rows: Buffer.from([1]),
			control: Buffer.from([0x1b]),
			literals: Buffer.from([0xaa]),
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0001020001020300");
		expect(out.subarray(0x436).toString("hex")).toBe("aaaaaaaa");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = grbFile(2, 1, {
			rows: Buffer.from([0]),
			control: Buffer.from([0]),
			literals: Buffer.alloc(4),
		});
		data.writeInt32LE(4, 0);
		await expect(
			crossNetGrbImageFormat.open(new BufferByteSource(data), "pic.grb"),
		).rejects.toThrow(GarbroError);
		await expect(
			crossNetGrbImageFormat.open(new BufferByteSource(data), "pic.grb"),
		).rejects.toThrow("Not a CrossNet picture");
	});
});
