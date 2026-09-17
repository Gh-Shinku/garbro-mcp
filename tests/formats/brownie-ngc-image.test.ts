import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	brownieNgcImageFormat,
	readNgcLayout,
	unpackNgc,
} from "../../packages/formats/src/brownie/ngc-image.js";

const HEADER_SIZE = 0x20;

interface NgcOptions {
	width?: number;
	height?: number;
	bitsLineSize?: number;
}

function ngcFile(stream: Buffer, options: NgcOptions = {}): Buffer {
	const head = Buffer.alloc(HEADER_SIZE);
	Buffer.from("NG/B", "latin1").copy(head, 0);
	head.writeUInt32LE(options.width ?? 2, 0x14);
	head.writeUInt32LE(options.height ?? 2, 0x18);
	head.writeInt32LE(options.bitsLineSize ?? 0, 0x1c);
	return Buffer.concat([head, stream]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await brownieNgcImageFormat.open(
		new BufferByteSource(data),
		"pic.ngc",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** A row that stands in the stream as it is. */
function rawRow(bytes: number[]): Buffer {
	return Buffer.concat([Buffer.from([1]), Buffer.from(bytes)]);
}

describe("Brownie image", () => {
	it("reads the head as the reference does", () => {
		const data = ngcFile(Buffer.alloc(0), {
			width: 4,
			height: 3,
			bitsLineSize: 2,
		});
		expect(readNgcLayout(data)).toEqual({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
			bitsLineSize: 2,
		});
	});

	it("finds a picture by its signature and the head", async () => {
		const data = ngcFile(Buffer.alloc(0));
		expect(
			await brownieNgcImageFormat.detect(new BufferByteSource(data), "pic.ngc"),
		).toBe(true);
		const other = Buffer.from(data);
		other.write("NG/C", 0, "latin1");
		expect(readNgcLayout(other)).toBeUndefined();
		const empty = ngcFile(Buffer.alloc(0), { height: 0 });
		expect(readNgcLayout(empty)).toBeUndefined();
		const negative = ngcFile(Buffer.alloc(0), { bitsLineSize: -1 });
		expect(readNgcLayout(negative)).toBeUndefined();
	});

	it("reports the measurements of the picture", async () => {
		const handle = await brownieNgcImageFormat.open(
			new BufferByteSource(
				ngcFile(
					Buffer.concat([
						rawRow([1, 2, 3, 4, 5, 6]),
						rawRow([7, 8, 9, 10, 11, 12]),
					]),
				),
			),
			"dir/pic.ngc",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "custom",
		});
	});

	it("stands a row in the stream as it is", async () => {
		const data = ngcFile(
			Buffer.concat([
				rawRow([1, 2, 3, 4, 5, 6]),
				rawRow([7, 8, 9, 10, 11, 12]),
			]),
		);
		const layout = readNgcLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackNgc(data, layout).toString("hex")).toBe(
			"0102030405060708090a0b0c",
		);
		const out = await extract(data);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(2);
		expect(out.subarray(54, 70).toString("hex")).toBe(
			"01020304050600000708090a0b0c0000",
		);
	});

	it("repeats the row above", () => {
		const data = ngcFile(
			Buffer.concat([rawRow([1, 2, 3, 4, 5, 6]), Buffer.from([0])]),
		);
		const layout = readNgcLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackNgc(data, layout).toString("hex")).toBe(
			"0102030405060102030405" + "06",
		);
	});

	it("reads three run length coded channels across the whole picture", () => {
		const stream = Buffer.from([
			3,
			// Channel nought: four pixels of `0xAA`.
			0x04, 0xaa,
			// Channel one: four pixels of `0xBB`.
			0x04, 0xbb,
			// Channel two: four pixels of `0xCC`.
			0x04, 0xcc,
		]);
		const data = ngcFile(stream);
		const layout = readNgcLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackNgc(data, layout).toString("hex")).toBe(
			"aabbccaabbccaabbccaabbcc",
		);
	});

	it("reads a run length line of bytes that stand in the stream", () => {
		const stream = Buffer.from([
			3,
			// Channel nought: one pixel of `0xAA` and then three that stand in the stream.
			0x01,
			0xaa, 0x00, 0x03, 0x11, 0x22, 0x33,
			// Channel one and two hold no runs at all.
			0x00, 0x00, 0x00, 0x00,
		]);
		const data = ngcFile(stream);
		const layout = readNgcLayout(data);
		if (!layout) throw new Error("no layout");
		// The first channel holds `0xAA` at the first pixel and `0x11`, `0x22`, `0x33` at the rest.
		const pixels = unpackNgc(data, layout);
		expect(pixels[0]).toBe(0xaa);
		expect(pixels[3]).toBe(0x11);
		expect(pixels[6]).toBe(0x22);
		expect(pixels[9]).toBe(0x33);
	});

	it("reads a masked row against the row above", () => {
		const stream = Buffer.concat([
			rawRow([1, 2, 3, 4, 5, 6]),
			Buffer.from([2, 0x80, 0x99]),
		]);
		const data = ngcFile(stream, { bitsLineSize: 1 });
		const layout = readNgcLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackNgc(data, layout).toString("hex")).toBe(
			"010203040506990203040506",
		);
	});

	it("refuses a row that reaches above the first one", () => {
		const copy = ngcFile(Buffer.from([0]));
		const copyLayout = readNgcLayout(copy);
		if (!copyLayout) throw new Error("no layout");
		expect(() => unpackNgc(copy, copyLayout)).toThrow(GarbroError);
		const masked = ngcFile(Buffer.from([2, 0x40, 0x99]), { bitsLineSize: 1 });
		const maskedLayout = readNgcLayout(masked);
		if (!maskedLayout) throw new Error("no layout");
		expect(() => unpackNgc(masked, maskedLayout)).toThrow(
			"before its own start",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		// A head that is not signed is turned away; one that is but holds no rows is a picture of nothing,
		// which is what the reference's own read leaves as well.
		const data = ngcFile(Buffer.alloc(0));
		data.write("NG/C", 0, "latin1");
		await expect(
			brownieNgcImageFormat.open(new BufferByteSource(data), "pic.ngc"),
		).rejects.toThrow(GarbroError);
		await expect(
			brownieNgcImageFormat.open(new BufferByteSource(data), "pic.ngc"),
		).rejects.toThrow("Not a Brownie picture");
	});
});
