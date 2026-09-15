import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { BufferByteSource } from "@garbro-mcp/core";
import { reallivePdtImageFormat } from "../../packages/formats/src/reallive/pdt-image.js";

const PIXELS_AT = 0x20;

interface PdtOptions {
	version: number;
	width: number;
	height: number;
	body: Buffer;
	alpha?: Buffer;
	alphaOffset?: number;
}

/** A picture: the header, then the stream its pixels are stored in, and the transparency after it. */
function pdtFile(options: PdtOptions): Buffer {
	const header: Buffer = Buffer.alloc(PIXELS_AT, 0);
	header.write("PDT1", 0, "latin1");
	header.write(String(options.version), 4, "latin1");
	header.writeUInt32LE(options.width, 0x0c);
	header.writeUInt32LE(options.height, 0x10);
	const parts = [header, options.body];
	let alphaOffset = options.alphaOffset ?? 0;
	if (options.alpha) {
		alphaOffset = PIXELS_AT + options.body.length;
		parts.push(options.alpha);
	}
	header.writeUInt32LE(alphaOffset, 0x1c);
	return Buffer.concat(parts);
}

/** A colour map of two hundred and fifty six entries, of which only the first one is of interest. */
function paletteBytes(first: number[]): Buffer {
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0);
	palette[0] = first[0] ?? 0;
	palette[1] = first[1] ?? 0;
	palette[2] = first[2] ?? 0;
	return palette;
}

/** The table of sixteen places a version one stream counts its runs back from. */
function offsetTable(offsets: number[]): Buffer {
	const table: Buffer = Buffer.alloc(16 * 4, 0);
	for (const [index, value] of offsets.entries()) {
		table.writeInt32LE(value, index * 4);
	}
	return table;
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await reallivePdtImageFormat.open(sourceOf(data), "cg.pdt");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const stream = await handle.openEntry(entry.id);
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

/** A picture of two by two, whose four pixels are the three bytes each of them carries. */
function plainBody(pixels: number[][]): Buffer {
	const bits: number[] = [0xc0];
	for (const pixel of pixels) bits.push(...pixel);
	return Buffer.from(bits);
}

describe("AVG32 engine image", () => {
	it("finds a picture whose digit names a version", async () => {
		const data = pdtFile({
			version: 0,
			width: 2,
			height: 2,
			body: plainBody([]),
		});
		expect(await reallivePdtImageFormat.detect(sourceOf(data))).toBe(true);
		data.write("2", 4, "latin1");
		expect(await reallivePdtImageFormat.detect(sourceOf(data))).toBe(false);
	});

	it("lists the picture with its version and its transparency", async () => {
		const data = pdtFile({
			version: 0,
			width: 4,
			height: 2,
			body: plainBody([]),
			alpha: Buffer.from([0xc0, 0x11, 0x22]),
		});
		const handle = await reallivePdtImageFormat.open(
			sourceOf(data),
			"dir/cg.pdt",
		);
		expect(handle.entries).toHaveLength(1);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 4,
			height: 2,
			bitsPerPixel: 32,
			version: 0,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "avg32-pixels",
		});
	});

	it("writes a plain picture of pixels the stream carries", async () => {
		const body = Buffer.from([
			0xff, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb,
			0xcc,
		]);
		const out = await extract(
			pdtFile({ version: 0, width: 2, height: 2, body }),
		);
		expect(out.readUInt16LE(28)).toBe(32);
		expect(out.subarray(54, 54 + 16)).toEqual(
			Buffer.from([
				0x11, 0x22, 0x33, 0x00, 0x44, 0x55, 0x66, 0x00, 0x77, 0x88, 0x99, 0x00,
				0xaa, 0xbb, 0xcc, 0x00,
			]),
		);
	});

	it("unpacks a run repeating what the picture holds", async () => {
		// One pixel the stream carries, then a run of one pixel copied from the four bytes behind it.
		const body = Buffer.from([0x80, 0x11, 0x22, 0x33, 0x00, 0x00]);
		const out = await extract(
			pdtFile({ version: 0, width: 2, height: 1, body }),
		);
		expect(out.subarray(54, 54 + 8)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x00, 0x11, 0x22, 0x33, 0x00]),
		);
	});

	it("fills the fourth byte of a pixel with the transparency", async () => {
		const body = Buffer.from([0xc0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
		const out = await extract(
			pdtFile({
				version: 0,
				width: 2,
				height: 1,
				body,
				alpha: Buffer.from([0xc0, 0xaa, 0xbb]),
			}),
		);
		expect(out.subarray(54, 54 + 8)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0xaa, 0x44, 0x55, 0x66, 0xbb]),
		);
	});

	it("refuses a run reaching back before its picture", async () => {
		// A run counting back two pixels from the second one, which is not there.
		const body = Buffer.from([0x80, 0x11, 0x22, 0x33, 0x10, 0x00]);
		await expect(
			extract(pdtFile({ version: 0, width: 2, height: 1, body })),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("writes a picture with a colour map", async () => {
		const body = Buffer.concat([
			paletteBytes([0x11, 0x22, 0x33]),
			offsetTable([1]),
			Buffer.from([0xc0, 0x05, 0x06]),
		]);
		const out = await extract(
			pdtFile({ version: 1, width: 2, height: 1, body }),
		);
		expect(out.readUInt16LE(28)).toBe(8);
		expect(out.subarray(54, 54 + 4)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x00]),
		);
		expect(out.subarray(54 + 0x400, 54 + 0x400 + 2)).toEqual(
			Buffer.from([0x05, 0x06]),
		);
	});

	it("leaves the colour map alone when the picture carries transparency", async () => {
		const body = Buffer.concat([
			paletteBytes([0x11, 0x22, 0x33]),
			offsetTable([1]),
			Buffer.from([0xff, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
		]);
		const out = await extract(
			pdtFile({
				version: 1,
				width: 2,
				height: 1,
				body,
				alpha: Buffer.from([0xc0, 0x09, 0x08]),
			}),
		);
		expect(out.readUInt16LE(28)).toBe(32);
		expect(out.subarray(54, 54 + 8)).toEqual(
			Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]),
		);
	});

	it("counts a run back from the place the table names", async () => {
		// One byte the stream carries, then three more copied from the byte behind it.
		const body = Buffer.concat([
			paletteBytes([0, 0, 0]),
			offsetTable([1]),
			Buffer.from([0x80, 0x42, 0x10]),
		]);
		const out = await extract(
			pdtFile({ version: 1, width: 4, height: 1, body }),
		);
		expect(out.subarray(54 + 0x400, 54 + 0x400 + 4)).toEqual(
			Buffer.from([0x42, 0x42, 0x42, 0x42]),
		);
	});

	it("leaves the bytes before a place the picture has not reached", async () => {
		// A run naming a place a hundred bytes back in a picture of four, so the run is skipped whole.
		const body = Buffer.concat([
			paletteBytes([0, 0, 0]),
			offsetTable([1, 100]),
			Buffer.from([0x80, 0x42, 0x11]),
		]);
		const out = await extract(
			pdtFile({ version: 1, width: 4, height: 1, body }),
		);
		expect(out.subarray(54 + 0x400, 54 + 0x400 + 4)).toEqual(
			Buffer.from([0x42, 0x00, 0x00, 0x00]),
		);
	});

	it("refuses a run reaching outside the transparency", async () => {
		const body = Buffer.from([0xc0, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
		await expect(
			extract(
				pdtFile({
					version: 0,
					width: 2,
					height: 1,
					body,
					alpha: Buffer.from([0x80, 0xaa, 0x01, 0x00]),
				}),
			),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a picture with no colour map behind its header", async () => {
		const body = Buffer.from([0xc0, 0x01, 0x02]);
		await expect(
			extract(pdtFile({ version: 1, width: 2, height: 1, body })),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a stream that ends inside a pixel", async () => {
		const body = Buffer.from([0xc0, 0x11]);
		await expect(
			extract(pdtFile({ version: 0, width: 2, height: 1, body })),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a picture of nothing", async () => {
		const body = Buffer.from([0xc0, 0x11, 0x22, 0x33]);
		await expect(
			extract(pdtFile({ version: 0, width: 0, height: 1, body })),
		).rejects.toMatchObject({ code: "UNSUPPORTED_FEATURE" });
	});
});
