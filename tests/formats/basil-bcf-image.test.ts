import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	basilBcfImageFormat,
	lzUnpackBcf,
	readBcfLayout,
} from "../../packages/formats/src/basil/bcf-image.js";

interface BcfInput {
	width: number;
	height: number;
	stride: number;
	data: Buffer;
	dataBits: Buffer;
	dataOffset?: number;
	dataBitsOffset?: number;
	dataShift?: number;
	alpha?: Buffer;
	alphaBits?: Buffer;
	alphaOffset?: number;
	alphaBitsOffset?: number;
	alphaShift?: number;
}

/** A picture: the head and the parts of the two planes, each where the head says it stands. */
function bcfFile(input: BcfInput): Buffer {
	const parts: { offset: number; bytes: Buffer }[] = [];
	const place = (offset: number | undefined, bytes: Buffer, at: number) => {
		const position = offset ?? at;
		parts.push({ offset: position, bytes });
		return position;
	};
	// The colour plane's bits end where the alpha plane begins, so the parts are laid one after another.
	let cursor = 0x20;
	const dataOffset = place(input.dataOffset, input.data, cursor);
	cursor = Math.max(cursor, dataOffset + input.data.length);
	const dataBitsOffset = place(input.dataBitsOffset, input.dataBits, cursor);
	cursor = Math.max(cursor, dataBitsOffset + input.dataBits.length);
	let alphaOffset = 0;
	let alphaBitsOffset = 0;
	if (input.alpha) {
		alphaOffset = place(input.alphaOffset, input.alpha, cursor);
		cursor = Math.max(cursor, alphaOffset + input.alpha.length);
		alphaBitsOffset = place(
			input.alphaBitsOffset,
			input.alphaBits ?? Buffer.alloc(1),
			cursor,
		);
		cursor = Math.max(cursor, alphaBitsOffset + (input.alphaBits?.length ?? 1));
	}
	const size = parts.reduce(
		(max, part) => Math.max(max, part.offset + part.bytes.length),
		0x20,
	);
	const head = Buffer.alloc(0x20, 0x00);
	Buffer.from([0x42, 0x43, 0x46, 0x00]).copy(head, 0);
	head.writeUInt16LE(input.width, 4);
	head.writeUInt16LE(input.height, 6);
	head.writeInt32LE(input.stride, 8);
	head.writeUInt8(input.dataShift ?? 0, 0x0c);
	head.writeUInt8(input.alphaShift ?? 0, 0x0d);
	head.writeUInt32LE(dataOffset, 0x10);
	head.writeUInt32LE(dataBitsOffset, 0x14);
	head.writeUInt32LE(alphaOffset, 0x18);
	head.writeUInt32LE(alphaBitsOffset, 0x1c);
	const file = Buffer.alloc(size, 0x00);
	head.copy(file, 0);
	for (const part of parts) part.bytes.copy(file, part.offset);
	return file;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await basilBcfImageFormat.open(
		new BufferByteSource(data),
		"pic.bcf",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("BasiL image", () => {
	it("reads the head as the reference does", () => {
		const data = bcfFile({
			width: 2,
			height: 2,
			stride: 6,
			data: Buffer.alloc(12),
			dataBits: Buffer.alloc(2),
		});
		expect(readBcfLayout(data)).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			stride: 6,
			dataShift: 0,
		});
		// A place of the alpha plane is what makes a picture thirty two bits a pixel.
		const withAlpha = bcfFile({
			width: 2,
			height: 1,
			stride: 6,
			data: Buffer.alloc(6),
			dataBits: Buffer.alloc(1),
			alpha: Buffer.alloc(2),
			alphaBits: Buffer.alloc(1),
		});
		expect(readBcfLayout(withAlpha)).toMatchObject({ bitsPerPixel: 32 });
	});

	it("gates on the mark, the row, the steps and the places", () => {
		const good = bcfFile({
			width: 2,
			height: 2,
			stride: 6,
			data: Buffer.alloc(12),
			dataBits: Buffer.alloc(2),
		});
		expect(readBcfLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.writeUInt8(0x47, 2);
		expect(readBcfLayout(mark)).toBeUndefined();
		const narrow = Buffer.from(good);
		narrow.writeInt32LE(4, 8);
		expect(readBcfLayout(narrow)).toBeUndefined();
		// Only five steps are in the table.
		const step = Buffer.from(good);
		step.writeUInt8(5, 0x0c);
		expect(readBcfLayout(step)).toBeUndefined();
		// The bits of the colour plane have to begin before the alpha plane does.
		const bits = Buffer.from(good);
		bits.writeUInt32LE(0x1000, 0x14);
		expect(readBcfLayout(bits)).toBeUndefined();
	});

	it("unfolds bytes that stand and references that reach back", () => {
		const output = Buffer.alloc(12, 0x00);
		// Three bytes stand themselves; a reference then takes nine bytes three behind the walk.
		lzUnpackBcf(
			Buffer.from([0xaa, 0xbb, 0xcc, 0x16, 0x00]),
			Buffer.from([0x08]),
			0,
			0,
			output,
		);
		expect(output.toString("hex")).toBe("aabbccaabbccaabbccaabbcc");
	});

	it("refuses a reference that reaches outside the plane", () => {
		// A reference with nothing written before it cannot reach back at all.
		expect(() =>
			lzUnpackBcf(
				Buffer.from([0x00, 0x00]),
				Buffer.from([0x01]),
				0,
				0,
				Buffer.alloc(12, 0x00),
			),
		).toThrow("reaches before its own start");
		// And one that would take more bytes than the plane still holds is refused as well.
		expect(() =>
			lzUnpackBcf(
				Buffer.from([0xaa, 0xbb, 0xcc, 0x16, 0x00]),
				Buffer.from([0x08]),
				0,
				0,
				Buffer.alloc(4, 0x00),
			),
		).toThrow("writes past its own end");
	});

	it("writes a twenty four bit picture out again", async () => {
		const data = bcfFile({
			width: 2,
			height: 2,
			stride: 6,
			data: Buffer.from([
				0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc,
			]),
			dataBits: Buffer.alloc(2),
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(2);
		expect(out.subarray(0x36).toString("hex")).toBe(
			"1122334455660000778899aabbcc0000",
		);
	});

	it("weaves the alpha plane into a thirty two bit picture", async () => {
		const data = bcfFile({
			width: 2,
			height: 1,
			stride: 6,
			data: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
			dataBits: Buffer.alloc(1),
			alpha: Buffer.from([0x80, 0x40]),
			alphaBits: Buffer.alloc(1),
		});
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.readInt32LE(0x16)).toBe(1);
		expect(out.subarray(0x36).toString("hex")).toBe("1122338044556640");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = bcfFile({
			width: 2,
			height: 1,
			stride: 6,
			data: Buffer.alloc(6),
			dataBits: Buffer.alloc(1),
		});
		data.writeUInt8(0x47, 2);
		await expect(
			basilBcfImageFormat.open(new BufferByteSource(data), "pic.bcf"),
		).rejects.toThrow(GarbroError);
		await expect(
			basilBcfImageFormat.open(new BufferByteSource(data), "pic.bcf"),
		).rejects.toThrow("Not a BasiL picture");
	});
});
