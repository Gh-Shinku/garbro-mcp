import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { BufferByteSource } from "@garbro-mcp/core";
import { zoneBmImageFormat } from "../../packages/formats/src/zone/bm-image.js";

const HEADER_SIZE = 0x18;
const PALETTE_SIZE = 0x400;
const FLAG_OFFSET = HEADER_SIZE + PALETTE_SIZE + 12;
const PIXELS_OFFSET = FLAG_OFFSET + 1;
/** Where the pixels of the picture the port writes start, behind the two hundred and fifty six colours. */
const OUTPUT_PIXELS = 54 + PALETTE_SIZE;
/** The byte the runs of a picture are written with, which is what the header names. */
const FLAG = 0x5c;

interface BmOptions {
	compressed?: boolean;
	width: number;
	height: number;
	/** The byte the runs are written with, and what the picture carries behind the colour map. */
	flag?: number;
	/** The first colour of the map, the only one the tests look at. */
	colour?: number[];
	body?: Buffer;
}

/** A picture: the header, its colour map, the twelve bytes behind it, and then the pixels or the runs. */
function bmFile(options: BmOptions): Buffer {
	const head: Buffer = Buffer.alloc(PIXELS_OFFSET, 0);
	head.writeInt32LE(options.compressed ? 1 : 0, 0);
	head.writeUInt32LE(options.width, 4);
	head.writeUInt32LE(options.height, 8);
	const colour = options.colour ?? [0x11, 0x22, 0x33];
	colour.forEach((byte, index) => {
		head[HEADER_SIZE + index] = byte;
	});
	head[FLAG_OFFSET] = options.flag ?? FLAG;
	return Buffer.concat([head, options.body ?? Buffer.alloc(0)]);
}

/** The pixels of a picture that is not stored as runs, which are kept from the bottom row up. */
function bottomUpRows(rows: number[][]): Buffer {
	return Buffer.from(rows.slice().reverse().flat());
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.bm_"): Promise<Buffer> {
	const handle = await zoneBmImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const stream = await handle.openEntry(entry.id);
	const chunks: Buffer[] = [];
	for await (const chunk of stream) chunks.push(Buffer.from(chunk));
	return Buffer.concat(chunks);
}

describe("Zone compressed image", () => {
	it("finds a picture under the name of its file", async () => {
		const plain = bmFile({
			width: 2,
			height: 1,
			body: Buffer.from([1, 2]),
		});
		expect(await zoneBmImageFormat.detect(sourceOf(plain), "cg.bm_")).toBe(
			true,
		);
		expect(await zoneBmImageFormat.detect(sourceOf(plain), "cg.dat")).toBe(
			false,
		);
		const other = bmFile({ width: 2, height: 1 });
		other.writeInt32LE(2, 0);
		expect(await zoneBmImageFormat.detect(sourceOf(other), "cg.bm_")).toBe(
			false,
		);
	});

	it("lists the picture with the byte its runs are written with", async () => {
		const data = bmFile({ width: 4, height: 2, body: Buffer.alloc(8, 1) });
		const handle = await zoneBmImageFormat.open(sourceOf(data), "dir/cg.bm_");
		expect(handle.entries).toHaveLength(1);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 4,
			height: 2,
			bitsPerPixel: 8,
			isCompressed: false,
			rleFlag: FLAG,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "none",
		});
	});

	it("writes the pixels of a picture that is not stored as runs", async () => {
		// The rows are kept from the bottom up, so the first row of the file is the last of the picture.
		const body = bottomUpRows([
			[1, 2, 3],
			[4, 5, 6],
		]);
		const out = await extract(bmFile({ width: 3, height: 2, body }));
		expect(out.readUInt16LE(28)).toBe(8);
		expect(out.subarray(54, 57)).toEqual(Buffer.from([0x11, 0x22, 0x33]));
		// A row of a bitmap is padded to four bytes, so three pixels of a row take four.
		expect(out.subarray(OUTPUT_PIXELS, OUTPUT_PIXELS + 8)).toEqual(
			Buffer.from([1, 2, 3, 0, 4, 5, 6, 0]),
		);
	});

	it("unpacks the pixels and the runs of a picture that is stored as runs", async () => {
		// Two pixels of their own, the byte the runs are written with standing for itself, then two runs.
		const body = Buffer.from([
			0x0a,
			0x0b,
			FLAG,
			0x00,
			FLAG,
			0x03,
			0x00,
			0x77,
			FLAG,
			0x02,
			0x09,
			0x88,
		]);
		const out = await extract(
			bmFile({ compressed: true, width: 8, height: 1, body }),
		);
		expect(out.subarray(OUTPUT_PIXELS, OUTPUT_PIXELS + 8)).toEqual(
			Buffer.from([0x0a, 0x0b, FLAG, 0x77, 0x77, 0x77, 0x88, 0x88]),
		);
	});

	it("counts a run past two hundred and fifty five with the ones in front of it", async () => {
		// A count of two ones and a two is two hundred and fifty eight, which is more than the picture holds.
		const body = Buffer.from([FLAG, 0x01, 0x01, 0x02, 0x00, 0x77]);
		await expect(
			extract(bmFile({ compressed: true, width: 4, height: 1, body })),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a run that reaches past its picture", async () => {
		const body = Buffer.from([FLAG, 0x09, 0x00, 0x77]);
		await expect(
			extract(bmFile({ compressed: true, width: 4, height: 1, body })),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a stream that ends inside a run", async () => {
		const body = Buffer.from([FLAG, 0x03, 0x00]);
		await expect(
			extract(bmFile({ compressed: true, width: 4, height: 1, body })),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a picture that is cut short of its pixels", async () => {
		const body = Buffer.from([1, 2]);
		await expect(
			extract(bmFile({ width: 4, height: 2, body })),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("refuses a picture of nothing", async () => {
		const body = Buffer.alloc(4, 1);
		await expect(
			extract(bmFile({ width: 0, height: 4, body })),
		).rejects.toMatchObject({ code: "UNSUPPORTED_FEATURE" });
	});
});
