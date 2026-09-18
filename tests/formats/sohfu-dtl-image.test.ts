import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readDtlLayout,
	readDtlcLayout,
	sohfuDtlcImageFormat,
	sohfuDtlImageFormat,
} from "../../packages/formats/src/sohfu/dtl-image.js";

/** A Sohfu picture: the head and the pixels. */
function dtlFile(input: {
	mark?: string;
	width: number;
	height: number;
	bpp: number;
	stride: number;
	pixels: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x18, 0x00);
	Buffer.from(input.mark ?? "DTL_", "latin1").copy(head, 0);
	head.writeUInt32LE(input.width, 0x08);
	head.writeUInt32LE(input.height, 0x0c);
	head.writeInt32LE(input.bpp, 0x10);
	head.writeInt32LE(input.stride, 0x14);
	return Buffer.concat([head, input.pixels]);
}

/** A Sohfu picture behind a table of runs: a count a row and eight bytes a run. */
function dtlcFile(input: {
	mark?: string;
	width: number;
	height: number;
	bpp: number;
	stride: number;
	runs: number[];
	pixels: Buffer;
}): Buffer {
	const table: Buffer[] = [];
	for (const count of input.runs) {
		const entry = Buffer.alloc(4 + count * 8, 0x00);
		entry.writeInt32LE(count, 0);
		table.push(entry);
	}
	return dtlFile({
		mark: input.mark ?? "DTLC",
		width: input.width,
		height: input.height,
		bpp: input.bpp,
		stride: input.stride,
		pixels: Buffer.concat([...table, input.pixels]),
	});
}

async function extract(
	format: typeof sohfuDtlImageFormat,
	data: Buffer,
): Promise<Buffer> {
	const handle = await format.open(new BufferByteSource(data), "pic.ls8");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Sohfu image", () => {
	it("reads the head as the reference does", () => {
		const data = dtlFile({
			width: 2,
			height: 1,
			bpp: 24,
			stride: 6,
			pixels: Buffer.alloc(6),
		});
		expect(readDtlLayout(data)).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			stride: 6,
			rowBytes: 6,
			pixelsOffset: 0x18,
		});
	});

	it("gates on the mark, the depth, the row and the pixels", () => {
		const good = dtlFile({
			width: 2,
			height: 1,
			bpp: 24,
			stride: 6,
			pixels: Buffer.alloc(6),
		});
		expect(readDtlLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("DTLC", 0, "latin1");
		expect(readDtlLayout(mark)).toBeUndefined();
		// Sixteen bits a pixel is not one of the depths the reader has a layout for.
		const depth = Buffer.from(good);
		depth.writeInt32LE(16, 0x10);
		expect(readDtlLayout(depth)).toBeUndefined();
		// A row narrower than the picture cannot hold it.
		const narrow = Buffer.from(good);
		narrow.writeInt32LE(4, 0x14);
		expect(readDtlLayout(narrow)).toBeUndefined();
		// And the pixels have to stand inside the file.
		const short = Buffer.from(good.subarray(0, 0x1a));
		expect(readDtlLayout(short)).toBeUndefined();
	});

	it("writes a twenty four bit picture out again", async () => {
		const out = await extract(
			sohfuDtlImageFormat,
			dtlFile({
				width: 2,
				height: 1,
				bpp: 24,
				stride: 6,
				pixels: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `ImageData.Create` keeps the stored order top down.
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("1122334455660000");
	});

	it("writes an eight bit picture out as a grey one", async () => {
		const out = await extract(
			sohfuDtlImageFormat,
			dtlFile({
				width: 2,
				height: 1,
				bpp: 8,
				stride: 2,
				pixels: Buffer.from([0x80, 0x40]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.readUInt32LE(0x2e)).toBe(256);
		expect(
			out.subarray(0x36 + 0x80 * 4, 0x36 + 0x80 * 4 + 4).toString("hex"),
		).toBe("80808000");
		expect(out.subarray(0x436, 0x43a).toString("hex")).toBe("80400000");
	});

	it("writes a four bit picture out with its sixteen shades", async () => {
		const out = await extract(
			sohfuDtlImageFormat,
			dtlFile({
				width: 2,
				height: 2,
				bpp: 4,
				stride: 1,
				pixels: Buffer.from([0x21, 0x0f]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(4);
		expect(out.readUInt32LE(0x2e)).toBe(16);
		// The sixteen shades are `0x00`, `0x11` and so on, a byte apart.
		expect(out.subarray(0x36, 0x36 + 16).toString("hex")).toBe(
			"00000000111111002222220033333300",
		);
		// The rows are packed two pixels a byte and padded to four.
		expect(out.subarray(0x76, 0x7e).toString("hex")).toBe("210000000f000000");
	});

	it("walks the table of runs of the other kind", () => {
		const data = dtlcFile({
			width: 2,
			height: 2,
			bpp: 32,
			stride: 8,
			runs: [1, 0],
			pixels: Buffer.alloc(16, 0x40),
		});
		const layout = readDtlcLayout(data);
		expect(layout).toMatchObject({
			bitsPerPixel: 32,
			pixelsOffset: 0x18 + 12 + 4,
			strideCount: 1,
		});
		// The second mark of the same format is read as well.
		const other = dtlcFile({
			mark: "DTLA",
			width: 2,
			height: 1,
			bpp: 24,
			stride: 6,
			runs: [0],
			pixels: Buffer.alloc(6),
		});
		expect(readDtlcLayout(other)).toBeDefined();
	});

	it("writes a picture behind a table of runs out again", async () => {
		const out = await extract(
			sohfuDtlcImageFormat,
			dtlcFile({
				width: 2,
				height: 2,
				bpp: 32,
				stride: 8,
				runs: [1, 0],
				pixels: Buffer.from([
					0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb,
					0xcc, 0xdd, 0xee, 0xff, 0x00,
				]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.subarray(0x36).toString("hex")).toBe(
			"112233445566778899aabbccddeeff00",
		);
	});

	it("gates the run kind on its depths and its table", () => {
		const good = dtlcFile({
			width: 2,
			height: 1,
			bpp: 24,
			stride: 6,
			runs: [0],
			pixels: Buffer.alloc(6),
		});
		expect(readDtlcLayout(good)).toBeDefined();
		const depth = Buffer.from(good);
		depth.writeInt32LE(8, 0x10);
		expect(readDtlcLayout(depth)).toBeUndefined();
		// A table that reaches past the file is turned away.
		const far = Buffer.from(good);
		far.writeInt32LE(0x1000, 0x18);
		expect(readDtlcLayout(far)).toBeUndefined();
	});

	it("declines a file that does not hold a picture", async () => {
		const data = dtlFile({
			width: 2,
			height: 1,
			bpp: 24,
			stride: 6,
			pixels: Buffer.alloc(6),
		});
		data.write("DTLC", 0, "latin1");
		await expect(
			sohfuDtlImageFormat.open(new BufferByteSource(data), "pic.ls8"),
		).rejects.toThrow(GarbroError);
		await expect(
			sohfuDtlImageFormat.open(new BufferByteSource(data), "pic.ls8"),
		).rejects.toThrow("Not a Sohfu picture");
	});
});
