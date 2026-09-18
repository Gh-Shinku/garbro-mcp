import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	clioExpImageFormat,
	readExpLayout,
	unpackExp,
} from "../../packages/formats/src/clio/exp-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

const DATA_OFFSET = 0x28;

/** The table block that names every place itself, which the reference reads as two runs of one hundred and
 * twenty eight entries. */
function selfTable(): Buffer {
	const parts: number[] = [];
	for (const start of [0, 0x80]) {
		parts.push(0x7f);
		for (let index = 0; index < 0x80; index += 1) parts.push(start + index);
	}
	return Buffer.from(parts);
}

/** A block whose tokens all stand for themselves. */
function selfBlock(tokens: Buffer): Buffer {
	const count = Buffer.alloc(2);
	count.writeUInt16BE(tokens.length, 0);
	return Buffer.concat([selfTable(), count, tokens]);
}

/** The place `0x41` of the table is given two bytes, so a token of it expands. */
function expansionTable(): Buffer {
	const parts: number[] = [];
	// The entries before the given place name themselves.
	parts.push(0x40);
	for (let index = 0; index < 0x41; index += 1) parts.push(index);
	// The given place takes two bytes.
	parts.push(0x00, 0x42, 0x43);
	// The entries behind it name themselves, in two runs.
	parts.push(0x7f);
	for (let index = 0x42; index < 0xc2; index += 1) parts.push(index);
	parts.push(0x3d);
	for (let index = 0xc2; index < 0x100; index += 1) parts.push(index);
	return Buffer.from(parts);
}

function expFile(stream: Buffer, bitmapSize: number): Buffer {
	const head = Buffer.alloc(DATA_OFFSET);
	Buffer.from("PXEN", "latin1").copy(head, 0);
	head.writeInt32LE(bitmapSize, 0x24);
	return Buffer.concat([head, stream]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await clioExpImageFormat.open(
		new BufferByteSource(data),
		"pic.exp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

const PIXELS = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

describe("Clio compressed bitmap", () => {
	it("reads the head and the measurements of the bitmap behind it", () => {
		const bmp = writeBmp24(2, 2, PIXELS);
		const data = expFile(selfBlock(bmp), bmp.length);
		expect(readExpLayout(data)).toEqual({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			bitmapSize: bmp.length,
		});
	});

	it("gates on the signature and the size of the bitmap", async () => {
		const bmp = writeBmp24(2, 2, PIXELS);
		const data = expFile(selfBlock(bmp), bmp.length);
		expect(
			await clioExpImageFormat.detect(new BufferByteSource(data), "pic.exp"),
		).toBe(true);
		const other = Buffer.from(data);
		other.write("PXEM", 0, "latin1");
		expect(readExpLayout(other)).toBeUndefined();
		const negative = expFile(selfBlock(bmp), -1);
		expect(readExpLayout(negative)).toBeUndefined();
		// A stream that does not unfold to a bitmap head is turned away.
		const empty = expFile(Buffer.alloc(0), bmp.length);
		expect(readExpLayout(empty)).toBeUndefined();
	});

	it("reports the measurements and the unfolding", async () => {
		const bmp = writeBmp24(2, 2, PIXELS);
		const handle = await clioExpImageFormat.open(
			new BufferByteSource(expFile(selfBlock(bmp), bmp.length)),
			"dir/pic.exp",
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

	it("unfolds the bitmap the head describes", async () => {
		const bmp = writeBmp24(2, 2, PIXELS);
		const out = await extract(expFile(selfBlock(bmp), bmp.length));
		expect(out.equals(bmp)).toBe(true);
	});

	it("walks a dictionary of tokens that expand", () => {
		const block = Buffer.concat([
			expansionTable(),
			Buffer.from([0x00, 0x03]),
			Buffer.from([0x41, 0x00, 0x00]),
		]);
		// The token of the given place expands into two bytes, and the rest stand for themselves.
		expect(unpackExp(block, 3).toString("hex")).toBe("424300");
	});

	it("refuses a stream that stops where a byte is wanted", () => {
		const bmp = writeBmp24(2, 2, PIXELS);
		const block = selfBlock(bmp);
		// The table alone, with no count or tokens behind it.
		expect(() => unpackExp(selfTable(), 4)).toThrow(GarbroError);
		expect(() => unpackExp(selfTable(), 4)).toThrow("cut short");
		// And a block whose tokens are not all there.
		expect(() =>
			unpackExp(block.subarray(0, block.length - 1), bmp.length),
		).toThrow("cut short");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = expFile(Buffer.alloc(0), 4);
		await expect(
			clioExpImageFormat.open(new BufferByteSource(data), "pic.exp"),
		).rejects.toThrow(GarbroError);
		await expect(
			clioExpImageFormat.open(new BufferByteSource(data), "pic.exp"),
		).rejects.toThrow("Not a Clio picture");
	});
});
