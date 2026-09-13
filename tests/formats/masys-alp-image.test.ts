import { BufferByteSource } from "@garbro-mcp/core";
import {
	masysAlpImageDescriptor,
	masysAlpImageFormat,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x15;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;
const SIGNATURE = Buffer.from("ALPd", "ascii");

interface Built {
	file: Buffer;
	width: number;
	height: number;
	unpackedSize: number;
}

/** The reference's expansion: mask to seven bits, scale, truncate to a byte. */
function expand(value: number): number {
	return Math.trunc(((value & 0x7f) * 0xff) / 0x40) & 0xff;
}

/** A literal sample: the control byte is the value itself, with the run bit clear. */
function literal(value: number): Buffer {
	return Buffer.from([value & 0x7f]);
}

/** A run: the run bit set, the value in the low bits, then the little endian count. */
function run(value: number, count: number): Buffer {
	const head: Buffer = Buffer.from([(value & 0x7f) | 0x80]);
	const size: Buffer = Buffer.alloc(2);
	size.writeUInt16LE(count, 0);
	return Buffer.concat([head, size]);
}

function buildAlp(
	width = 0x14,
	height = 2,
	stream: Buffer = Buffer.concat([
		literal(0x00),
		run(0x40, width - 1),
		run(0x20, width),
	]),
	unpackedSize = width * height,
): Built {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(width, 5);
	header.writeUInt32LE(height, 9);
	header.writeUInt32LE(unpackedSize, 0x11);
	return {
		file: Buffer.concat([header, stream]),
		width,
		height,
		unpackedSize,
	};
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("masys alp alpha mask", () => {
	it("declares the ALPd signature and the alp extension", () => {
		expect(masysAlpImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(masysAlpImageDescriptor.extensions).toEqual(["alp"]);
	});

	it("expands literals and runs into a grey bitmap", async () => {
		const built = buildAlp();
		const source = sourceOf(built.file);
		expect(await masysAlpImageFormat.detect(source, "MASK01.ALP")).toBe(true);
		const archive = await masysAlpImageFormat.open(source, "MASK01.ALP");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"MASK01.bmp",
			]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 0x14,
				height: 2,
				bitsPerPixel: 8,
				unpackedSize: 0x28,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x14,
				height: 2,
				bitsPerPixel: 8,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			// `ImageData.Create` is top down, so the bitmap stores a negative height.
			expect(output.readInt32LE(22)).toBe(-2);
			expect(output.readUInt16LE(28)).toBe(8);
			// A twenty pixel row is already four byte aligned, so the payload is the pixels verbatim.
			expect(output.length).toBe(DATA_OFFSET + 0x28);
			const pixels = output.subarray(DATA_OFFSET);
			expect(pixels.readUInt8(0)).toBe(0);
			expect(pixels.readUInt8(1)).toBe(255);
			expect(pixels.readUInt8(0x14)).toBe(expand(0x20));
			expect(pixels.readUInt8(0x27)).toBe(expand(0x20));
			expect(expand(0x20)).toBe(127);
		} finally {
			await archive.close();
		}
	});

	it("leaves the rest of the image zero when the stream ends early", async () => {
		// Two literal samples for a four sample image.
		const built = buildAlp(
			4,
			1,
			Buffer.concat([literal(0x40), literal(0x20)]),
			4,
		);
		const archive = await masysAlpImageFormat.open(
			sourceOf(built.file),
			"MASK02.ALP",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			const pixels = output.subarray(DATA_OFFSET);
			expect(pixels).toEqual(Buffer.from([255, expand(0x20), 0x00, 0x00]));
		} finally {
			await archive.close();
		}
	});

	it("wraps samples above the six bit range", async () => {
		const built = buildAlp(
			2,
			1,
			Buffer.concat([literal(0x7f), literal(0x41)]),
			2,
		);
		const archive = await masysAlpImageFormat.open(
			sourceOf(built.file),
			"MASK03.ALP",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			const pixels = output.subarray(DATA_OFFSET);
			// `(byte)(0x7F * 0xFF / 0x40)` truncates 506, so the sample wraps to 250 rather than 255.
			expect(expand(0x7f)).toBe(250);
			expect(pixels.readUInt8(0)).toBe(250);
			expect(expand(0x41)).toBe(2);
			expect(pixels.readUInt8(1)).toBe(2);
		} finally {
			await archive.close();
		}
	});

	it("declines a run that overruns the image", async () => {
		const built = buildAlp(4, 1, run(0x10, 5), 4);
		expect(
			await masysAlpImageFormat.detect(sourceOf(built.file), "MASK01.ALP"),
		).toBe(true);
		// Like the reference, listing only reads the header, so the failure lands on extraction.
		const archive = await masysAlpImageFormat.open(
			sourceOf(built.file),
			"MASK01.ALP",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(
				/Invalid Masys ALP image/,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a reserved byte that is not zero", async () => {
		const built = buildAlp();
		built.file.writeUInt8(1, 4);
		expect(
			await masysAlpImageFormat.detect(sourceOf(built.file), "MASK01.ALP"),
		).toBe(false);
	});

	it("declines a size that disagrees with the dimensions", async () => {
		const built = buildAlp(4, 1, literal(0x10), 5);
		expect(
			await masysAlpImageFormat.detect(sourceOf(built.file), "MASK01.ALP"),
		).toBe(false);
	});

	it("declines a different signature", async () => {
		const built = buildAlp();
		built.file[3] = 0x65;
		expect(
			await masysAlpImageFormat.detect(sourceOf(built.file), "MASK01.ALP"),
		).toBe(false);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await masysAlpImageFormat.detect(sourceOf(Buffer.alloc(8)), "MASK01.ALP"),
		).toBe(false);
	});
});
