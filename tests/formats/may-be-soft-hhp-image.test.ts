import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	mayBeSoftHhpImageFormat,
	readHhpLayout,
	unpackHhp,
} from "../../packages/formats/src/maybesoft/hhp-image.js";

const PALETTE_SIZE = 0x300;

/** A colour map whose entry `i` is the three bytes `i`, `i + 1`, `i + 2`. */
function paletteBytes(): Buffer {
	const palette = Buffer.alloc(PALETTE_SIZE);
	for (let i = 0; i < 0x100; i += 1) {
		palette[i * 3] = i;
		palette[i * 3 + 1] = (i + 1) & 0xff;
		palette[i * 3 + 2] = (i + 2) & 0xff;
	}
	return palette;
}

/** A bit writer that stands the bits of a byte from the highest down, as the reference reads them. */
class BitWriter {
	readonly #bits: number[] = [];

	push(value: number, count: number): void {
		for (let index = count - 1; index >= 0; index -= 1) {
			this.#bits.push((value >> index) & 1);
		}
	}

	toBuffer(): Buffer {
		const bytes = Buffer.alloc(Math.ceil(this.#bits.length / 8));
		this.#bits.forEach((bit, index) => {
			if (bit)
				bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (1 << (7 - (index & 7)));
		});
		return bytes;
	}
}

function hhpFile(bits: Buffer): Buffer {
	return Buffer.concat([paletteBytes(), bits]);
}

async function extract(data: Buffer, name = "pic.hhp"): Promise<Buffer> {
	const handle = await mayBeSoftHhpImageFormat.open(
		new BufferByteSource(data),
		name,
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** One pixel of `0x11`, then a count of nothing that ends the walk. */
function onePixelStream(): Buffer {
	const writer = new BitWriter();
	writer.push(0, 2);
	writer.push(1, 4);
	writer.push(0x11, 8);
	writer.push(0, 3);
	writer.push(0, 2);
	writer.push(0, 4);
	return writer.toBuffer();
}

describe("May-Be Soft image", () => {
	it("gates on the extension and hands out a fixed size", () => {
		const data = hhpFile(onePixelStream());
		expect(readHhpLayout(data, "pic.hhp")).toEqual({
			width: 640,
			height: 400,
			bitsPerPixel: 8,
		});
		// The reference only looks at a file whose name carries the extension.
		expect(readHhpLayout(data, "pic.bin")).toBeUndefined();
		// And a file that cannot even hold a colour map is turned away.
		expect(readHhpLayout(Buffer.alloc(0x100), "pic.hhp")).toBeUndefined();
	});

	it("finds the picture by its extension alone", async () => {
		const data = hhpFile(onePixelStream());
		expect(
			await mayBeSoftHhpImageFormat.detect(
				new BufferByteSource(data),
				"pic.hhp",
			),
		).toBe(true);
		expect(
			await mayBeSoftHhpImageFormat.detect(
				new BufferByteSource(data),
				"pic.bin",
			),
		).toBe(false);
	});

	it("carries the last value seen into the pixels that were left at nothing", () => {
		const pixels = unpackHhp(hhpFile(onePixelStream()));
		expect(pixels.length).toBe(640 * 400);
		expect(pixels[0]).toBe(0x11);
		// Every pixel that was left at nothing takes the last value seen before it.
		expect(pixels[1]).toBe(0x11);
		expect(pixels[640 * 400 - 1]).toBe(0x11);
	});

	it("walks down a column and steps aside by the table", () => {
		const writer = new BitWriter();
		// The first pixel, one place in.
		writer.push(0, 2);
		writer.push(1, 4);
		writer.push(0x22, 8);
		// A whole row down, then one row down and nowhere aside.
		writer.push(6, 3);
		writer.push(0, 2);
		writer.push(1, 4);
		writer.push(1, 3);
		writer.push(0, 3);
		// And a count of nothing to end the walk.
		writer.push(0, 2);
		writer.push(0, 4);
		const pixels = unpackHhp(hhpFile(writer.toBuffer()));
		expect(pixels[0]).toBe(0x22);
		expect(pixels[639]).toBe(0x22);
		expect(pixels[1279]).toBe(0x22);
		// The value that meets its own repeat turns to nothing and clears the one it carries.
		expect(pixels[1280]).toBe(0);
		expect(pixels[1281]).toBe(0);
		expect(pixels[640 * 400 - 1]).toBe(0);
	});

	it("writes the picture out with its colour map", async () => {
		const out = await extract(hhpFile(onePixelStream()));
		expect(out.readUInt16LE(0x1c)).toBe(8);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(400);
		expect(out.readInt32LE(0x12)).toBe(640);
		// The colour map stands blue, green, red and nothing.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0201000003020100");
		// Six hundred and forty pixels of `0x11` a row, the first of none of them left at nothing.
		expect(out.subarray(0x436, 0x436 + 8).toString("hex")).toBe(
			"1111111111111111",
		);
	});

	it("refuses a stream that stops where a code is wanted", () => {
		expect(() => unpackHhp(hhpFile(Buffer.alloc(0)))).toThrow(GarbroError);
		expect(() => unpackHhp(hhpFile(Buffer.alloc(0)))).toThrow("cut short");
	});

	it("declines a file that does not hold a picture", async () => {
		// A colour map with no stream behind it is all the head needs, and the walk then runs out of bits.
		const data = Buffer.alloc(PALETTE_SIZE);
		const handle = await mayBeSoftHhpImageFormat.open(
			new BufferByteSource(data),
			"pic.hhp",
		);
		await expect(handle.openEntry("0")).rejects.toThrow(GarbroError);
		await expect(handle.openEntry("0")).rejects.toThrow("cut short");
	});
});
