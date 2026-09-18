import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	csWareBpcImageFormat,
	readBpcLayout,
	readBpcPalette,
	unpackBpc,
} from "../../packages/formats/src/csware/bpc-image.js";

/** The bytes of a row, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}

/** A colour map of as many entries of four bytes as the depth asks for. */
function paletteBytes(entries: number): Buffer {
	const palette = Buffer.alloc(entries * 4, 0x00);
	for (let entry = 0; entry < entries; entry += 1) {
		palette[entry * 4] = entry;
		palette[entry * 4 + 1] = 0x10;
		palette[entry * 4 + 2] = 0x20;
	}
	return palette;
}

/** A bitmap: the head of sixteen bytes, the colour map and then the pixels. */
function bpcFile(input: {
	width: number;
	height: number;
	bpp: number;
	body: Buffer;
	palette?: Buffer;
	mark?: number;
}): Buffer {
	const head = Buffer.alloc(0x10, 0x00);
	head.writeUInt32LE(input.mark ?? 0x28, 0);
	head.writeUInt32LE(input.width, 4);
	head.writeUInt32LE(input.height, 8);
	head.writeUInt16LE(input.bpp, 0x0e);
	// The word at the beginning of the file is also where its pixels stand, so the head of sixteen bytes
	// and that place stand apart.
	const at = input.mark ?? 0x28;
	const padding = Buffer.alloc(Math.max(0, at - head.length), 0x00);
	return Buffer.concat([
		head,
		padding,
		input.palette ?? Buffer.alloc(0),
		input.body,
	]);
}

/** A word of four bytes. */
function word(value: number): Buffer {
	const bytes = Buffer.alloc(4, 0x00);
	bytes.writeInt32LE(value, 0);
	return bytes;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await csWareBpcImageFormat.open(
		new BufferByteSource(data),
		"pic.bpc",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("C's ware bitmap", () => {
	it("reads the head as the reference does", () => {
		const data = bpcFile({
			width: 8,
			height: 1,
			bpp: 1,
			palette: paletteBytes(2),
			body: Buffer.from([0xa5]),
		});
		expect(readBpcLayout(data)).toEqual({
			width: 8,
			height: 1,
			bitsPerPixel: 1,
			dataOffset: 0x28,
			stride: 1,
		});
	});

	it("gates on the word, the depth and the sizes", () => {
		const good = bpcFile({
			width: 8,
			height: 1,
			bpp: 1,
			palette: paletteBytes(2),
			body: Buffer.from([0xa5]),
		});
		expect(readBpcLayout(good)).toBeDefined();
		// The word the file begins with is the word the reference registers.
		expect(
			readBpcLayout(
				bpcFile({
					width: 8,
					height: 1,
					bpp: 1,
					mark: 0x48,
					palette: paletteBytes(2),
					body: Buffer.from([0xa5]),
				}),
			),
		).toBeUndefined();
		expect(
			readBpcLayout(
				bpcFile({
					width: 8,
					height: 1,
					bpp: 16,
					body: Buffer.alloc(0x40, 0x00),
				}),
			),
		).toBeUndefined();
	});

	it("reads a picture of one bit a pixel as it stands", async () => {
		const out = await extract(
			bpcFile({
				width: 8,
				height: 2,
				bpp: 1,
				palette: paletteBytes(2),
				body: Buffer.from([0xa5, 0x5a]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(1);
		// `CreateFlipped` stores rows bottom up, so the height of the bitmap stays positive.
		expect(out.readInt32LE(0x16)).toBe(2);
		// The two entries of the colour map stand as the file gives them.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe(
			hex([0x00, 0x10, 0x20, 0x00, 0x01, 0x10, 0x20, 0x00]),
		);
		// The two rows stand one after the other, a byte a row with the rest of the row padded.
		expect(out.subarray(0x3e, 0x46).toString("hex")).toBe(
			"a5000000" + "5a000000",
		);
	});

	it("reads a picture of eight bits walked along with a control of its own", async () => {
		// One byte stands as it is, the control stands in front of a count of two whose runs are the byte
		// before the control, and then one more byte stands as it is.
		const body = Buffer.concat([
			word(4),
			Buffer.from([0x00]),
			Buffer.from([0x10, 0x00, 0x02, 0x20]),
		]);
		const data = bpcFile({
			width: 4,
			height: 1,
			bpp: 8,
			palette: paletteBytes(0x100),
			body,
		});
		const layout = readBpcLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackBpc(data, layout).toString("hex")).toBe(
			hex([0x10, 0x10, 0x10, 0x20]),
		);
		const out = await extract(data);
		expect(out.subarray(0x436, 0x43a).toString("hex")).toBe("10101020");
	});

	it("reads a picture of eight bits walked along with the escape of its own", async () => {
		// The escape stands in front of the byte its runs stand behind and then the count.
		const body = Buffer.concat([
			word(5),
			Buffer.from([0xf5, 0x7f]),
			Buffer.from([0x30, 0xf5, 0x7f, 0x02, 0x40]),
		]);
		const data = bpcFile({
			width: 4,
			height: 1,
			bpp: 8,
			palette: paletteBytes(0x100),
			body,
		});
		const layout = readBpcLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackBpc(data, layout).toString("hex")).toBe(
			hex([0x30, 0x30, 0x30, 0x40]),
		);
		const out = await extract(data);
		expect(out.subarray(0x436, 0x43a).toString("hex")).toBe("30303040");
		expect(readBpcPalette(data, layout).subarray(0, 4).toString("hex")).toBe(
			"00102000",
		);
	});

	it("reads a picture of eight bits whose escape stands as a byte of its own", async () => {
		// The escape stands where the byte behind it is not the one its runs stand behind, so it is a byte
		// of the picture itself.
		const body = Buffer.concat([
			word(3),
			Buffer.from([0xf5, 0x7f]),
			Buffer.from([0xf5, 0x00, 0x20]),
		]);
		const data = bpcFile({
			width: 3,
			height: 1,
			bpp: 8,
			palette: paletteBytes(0x100),
			body,
		});
		const layout = readBpcLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackBpc(data, layout).toString("hex")).toBe(
			hex([0xf5, 0x00, 0x20]),
		);
	});

	it("reads a picture of twenty four bits in three planes", async () => {
		// Three planes of two pixels each, every one of them a byte that stands as it is and then a run of
		// one whose byte is the one before the control.
		const planes = [0x11, 0x22, 0x33].map((value) =>
			Buffer.from([value, 0x00, 0x01]),
		);
		// What the head gives for a plane is the size of its walk, which is three bytes here.
		const body = Buffer.concat([
			word(3),
			word(3),
			word(3),
			Buffer.from([0x00, 0x00, 0x00]),
			Buffer.from([0x7f, 0x7f, 0x7f]),
			...planes,
		]);
		const data = bpcFile({ width: 2, height: 1, bpp: 24, body });
		const layout = readBpcLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackBpc(data, layout).toString("hex")).toBe(
			hex([0x11, 0x22, 0x33, 0x11, 0x22, 0x33]),
		);
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe(
			hex([0x11, 0x22, 0x33, 0x11, 0x22, 0x33, 0, 0]),
		);
	});

	it("reads a picture of twenty four bits with the escape of its own", async () => {
		// Three planes of three pixels each, every one of them a byte that stands as it is and then a run
		// of two behind the escape and the byte its runs stand behind.
		const planes = [0x44, 0x55, 0x66].map((value) =>
			Buffer.from([value, 0xf5, 0x7f, 0x02]),
		);
		// Every plane's walk is four bytes: the byte that stands, the escape, the byte its runs stand
		// behind and the count.
		const body = Buffer.concat([
			word(4),
			word(4),
			word(4),
			Buffer.from([0xf5, 0xf5, 0xf5]),
			Buffer.from([0x7f, 0x7f, 0x7f]),
			...planes,
		]);
		const data = bpcFile({ width: 3, height: 1, bpp: 24, body });
		const layout = readBpcLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackBpc(data, layout).toString("hex")).toBe(
			hex([0x44, 0x55, 0x66, 0x44, 0x55, 0x66, 0x44, 0x55, 0x66]),
		);
	});

	it("turns a walk that begins with a run away", () => {
		const body = Buffer.concat([
			word(3),
			Buffer.from([0x00]),
			Buffer.from([0x00, 0x02, 0x20]),
		]);
		const data = bpcFile({
			width: 3,
			height: 1,
			bpp: 8,
			palette: paletteBytes(0x100),
			body,
		});
		const layout = readBpcLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => unpackBpc(data, layout)).toThrow(GarbroError);
		expect(() => unpackBpc(data, layout)).toThrow(
			"C's ware bitmap begins its walk with a run",
		);
	});

	it("declines a file that does not hold a bitmap", async () => {
		const data = bpcFile({
			width: 8,
			height: 1,
			bpp: 1,
			mark: 0x48,
			palette: paletteBytes(2),
			body: Buffer.from([0xa5]),
		});
		await expect(
			csWareBpcImageFormat.open(new BufferByteSource(data), "pic.bpc"),
		).rejects.toThrow(GarbroError);
		await expect(
			csWareBpcImageFormat.open(new BufferByteSource(data), "pic.bpc"),
		).rejects.toThrow("Not a C's ware bitmap");
	});
});
