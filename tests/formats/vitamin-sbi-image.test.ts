import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readSbiLayout,
	sbiStride,
	unpackSbi,
	vitaminSbiImageFormat,
} from "../../packages/formats/src/vitamin/sbi-image.js";

const HEADER_SIZE = 0x20;

interface SbiOptions {
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	packed?: boolean;
	palette?: boolean;
}

/** A colour map whose entry `i` is the three bytes `i`, `i + 1`, `i + 2`. */
function paletteBytes(): Buffer {
	const palette = Buffer.alloc(0x300);
	for (let i = 0; i < 0x100; i += 1) {
		palette[i * 3] = i;
		palette[i * 3 + 1] = (i + 1) & 0xff;
		palette[i * 3 + 2] = (i + 2) & 0xff;
	}
	return palette;
}

function sbiFile(body: Buffer, options: SbiOptions = {}): Buffer {
	const bitsPerPixel = options.bitsPerPixel ?? 24;
	const width = options.width ?? 2;
	const height = options.height ?? 1;
	const hasPalette = options.palette ?? false;
	const head = Buffer.alloc(HEADER_SIZE);
	Buffer.from("SBI\n", "latin1").copy(head, 0);
	head[4] = 1;
	head[5] = 0;
	head[6] = bitsPerPixel;
	head.writeUInt16LE(width, 7);
	head.writeUInt16LE(height, 9);
	head[0xf] = hasPalette ? 0 : 1;
	head[0x10] = options.packed ? 1 : 0;
	const parts = hasPalette ? [paletteBytes(), body] : [body];
	head.writeInt32LE(
		HEADER_SIZE + parts.reduce((total, part) => total + part.length, 0),
		0xb,
	);
	return Buffer.concat([head, ...parts]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await vitaminSbiImageFormat.open(
		new BufferByteSource(data),
		"pic.cmp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Vitamin image", () => {
	it("reads the head as the reference does", () => {
		const layout = readSbiLayout(
			sbiFile(Buffer.alloc(6), {
				width: 4,
				height: 2,
				bitsPerPixel: 16,
				packed: true,
			}),
		);
		expect(layout).toEqual({
			width: 4,
			height: 2,
			bitsPerPixel: 16,
			inputSize: HEADER_SIZE + 6,
			packed: true,
			hasPalette: false,
		});
		// A row is rounded up to four bytes.
		expect(sbiStride(3, 8)).toBe(4);
		expect(sbiStride(5, 24)).toBe(16);
	});

	it("gates on the two marker bytes and the depth", async () => {
		const data = sbiFile(Buffer.alloc(6));
		expect(
			await vitaminSbiImageFormat.detect(new BufferByteSource(data), "pic.cmp"),
		).toBe(true);
		// The bytes at four and five have to be a one and nothing.
		const odd = Buffer.from(data);
		odd[5] = 1;
		expect(readSbiLayout(odd)).toBeUndefined();
		// A depth below eight is refused.
		const shallow = sbiFile(Buffer.alloc(6), { bitsPerPixel: 4 });
		expect(readSbiLayout(shallow)).toBeUndefined();
		// And a depth the reader does not know is not offered.
		const strange = sbiFile(Buffer.alloc(6), { bitsPerPixel: 12 });
		expect(readSbiLayout(strange)).toBeDefined();
		expect(
			await vitaminSbiImageFormat.detect(
				new BufferByteSource(strange),
				"pic.cmp",
			),
		).toBe(false);
	});

	it("reports the measurements of the picture", async () => {
		const handle = await vitaminSbiImageFormat.open(
			new BufferByteSource(
				sbiFile(Buffer.alloc(6), { width: 2, height: 2, bitsPerPixel: 24 }),
			),
			"dir/pic.cmp",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			packed: false,
		});
	});

	it("stands an unpacked picture bottom up", async () => {
		// Two rows of whole stride, the first of which becomes the last row of the picture.
		const body = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const out = await extract(
			sbiFile(body, { width: 2, height: 2, bitsPerPixel: 8 }),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		// The top row is the second row of the stream and the bottom row its first.
		expect(out.subarray(0x436).toString("hex")).toBe("0506000001020000");
	});

	it("walks a packed picture across whole rows", async () => {
		// Two pixels that stand in the stream themselves.
		const body = Buffer.from([2, 1, 2, 3, 4, 5, 6]);
		const data = sbiFile(body, { width: 2, height: 1, packed: true });
		const layout = readSbiLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackSbi(data, layout).pixels.toString("hex")).toBe(
			"01020304050600" + "00",
		);
		const out = await extract(data);
		expect(out.subarray(54, 62).toString("hex")).toBe("0102030405060000");
	});

	it("repeats the first pixel of a run", () => {
		// A control above 0x80 holds that many less 0x80 pixels, of which the first stands in the stream.
		const body = Buffer.from([0x84, 1, 2, 3]);
		const data = sbiFile(body, { width: 4, height: 1, packed: true });
		const layout = readSbiLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackSbi(data, layout).pixels.toString("hex")).toBe(
			"010203010203010203010203",
		);
	});

	it("places a run across the edge of a row", () => {
		// Three pixels of one value for a picture two pixels wide: the third goes onto the row above.
		const body = Buffer.from([0x83, 9, 8, 7]);
		const data = sbiFile(body, { width: 2, height: 2, packed: true });
		const layout = readSbiLayout(data);
		if (!layout) throw new Error("no layout");
		// The buffer stands bottom up, so the run begins on the last row and wraps onto the first.
		expect(unpackSbi(data, layout).pixels.toString("hex")).toBe(
			"09080700000000000908070908070000",
		);
	});

	it("reads the colour map of an eight bit picture", async () => {
		const body = Buffer.from([0, 1, 0, 1]);
		const out = await extract(
			sbiFile(body, {
				width: 2,
				height: 1,
				bitsPerPixel: 8,
				palette: true,
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		// The entries of the bitmap stand blue, green, red, nothing.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0201000003020100");
		expect(out.subarray(0x436).toString("hex")).toBe("00010000");
	});

	it("refuses a stream that is cut short", () => {
		const body = Buffer.from([2, 1, 2, 3]);
		const data = sbiFile(body, { width: 2, height: 1, packed: true });
		const layout = readSbiLayout(data);
		if (!layout) throw new Error("no layout");
		// The head promises two pixels and only one and a half stand there.
		expect(() => unpackSbi(data.subarray(0, 0x24), layout)).toThrow(
			GarbroError,
		);
		expect(() => unpackSbi(data.subarray(0, 0x24), layout)).toThrow(
			"cut short",
		);
	});
});
