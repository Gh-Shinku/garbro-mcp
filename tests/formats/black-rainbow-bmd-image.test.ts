import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	blackRainbowBmdImageFormat,
	readBmdLayout,
	unpackBmd,
} from "../../packages/formats/src/black-rainbow/bmd-image.js";

/** The bytes of a row, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}

/** A bitmap: the head of twenty bytes and the walk of runs behind it. */
function bmdFile(input: {
	width: number;
	height: number;
	packed: Buffer;
	flags?: number;
	packedSize?: number;
	mark?: string;
}): Buffer {
	const head = Buffer.alloc(0x14, 0x00);
	Buffer.from(input.mark ?? "_BMD", "latin1").copy(head, 0);
	head.writeUInt32LE(input.packedSize ?? input.packed.length, 4);
	head.writeUInt32LE(input.width, 8);
	head.writeUInt32LE(input.height, 0x0c);
	head.writeInt32LE(input.flags ?? 0, 0x10);
	return Buffer.concat([head, input.packed]);
}

/** A walk of runs that stands as they are: a control byte of eight places and then eight bytes. */
function literals(bytes: Buffer): Buffer {
	return Buffer.concat([Buffer.from([0xff]), bytes]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await blackRainbowBmdImageFormat.open(
		new BufferByteSource(data),
		"pic.bmd",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Black Rainbow bitmap", () => {
	it("reads the head as the reference does", () => {
		const packed = literals(Buffer.alloc(8, 0x11));
		expect(
			readBmdLayout(bmdFile({ width: 2, height: 1, packed, flags: 1 })),
		).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
			packedSize: 9,
			flags: 1,
		});
	});

	it("gates on the word, the sizes and the walk", () => {
		const good = bmdFile({
			width: 2,
			height: 1,
			packed: literals(Buffer.alloc(8, 0x11)),
		});
		expect(readBmdLayout(good)).toBeDefined();
		expect(
			readBmdLayout(
				bmdFile({
					width: 2,
					height: 1,
					mark: "_BMX",
					packed: literals(Buffer.alloc(8, 0x11)),
				}),
			),
		).toBeUndefined();
		expect(
			readBmdLayout(
				bmdFile({
					width: 0,
					height: 1,
					packed: literals(Buffer.alloc(8, 0x11)),
				}),
			),
		).toBeUndefined();
		// The walk has to stand inside the file.
		expect(
			readBmdLayout(
				bmdFile({
					width: 2,
					height: 1,
					packed: literals(Buffer.alloc(8, 0x11)),
					packedSize: 0x100,
				}),
			),
		).toBeUndefined();
	});

	it("unwraps a walk of bytes that stand as they are", async () => {
		const pixels = Buffer.from([
			0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80,
		]);
		const data = bmdFile({ width: 2, height: 1, packed: literals(pixels) });
		const layout = readBmdLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackBmd(data, layout).toString("hex")).toBe(
			pixels.toString("hex"),
		);
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// `ImageData.Create` keeps the stored order top down, so the height of the bitmap is negative.
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe(
			pixels.toString("hex"),
		);
	});

	it("unwraps a walk of runs that point behind the byte being written", async () => {
		// Two pixels that stand, then a run of eight bytes taken from where they were written — the window
		// stands at 0xFEE before its first byte is written, so that is where the run points. The pair holds
		// the two lower places of the distance in its first byte and the four places above them in the
		// second, with the length above those, three bytes short.
		const first = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
		const packed = Buffer.concat([
			literals(first),
			Buffer.from([0x00, 0xee, 0xf5]),
		]);
		const data = bmdFile({ width: 4, height: 1, packed });
		const out = await extract(data);
		expect(out.subarray(0x36, 0x46).toString("hex")).toBe(
			hex([1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 4, 5, 6, 7, 8]),
		);
	});

	it("reads a picture with a fourth byte of a colour", async () => {
		const pixels = Buffer.from([0x01, 0x02, 0x03, 0xff]);
		const out = await extract(
			bmdFile({
				width: 1,
				height: 1,
				flags: 1,
				packed: literals(pixels),
			}),
		);
		expect(out.subarray(0x36, 0x3a).toString("hex")).toBe("010203ff");
	});

	it("leaves what the walk does not give as nought", () => {
		// A walk that says eight bytes stand as they are and gives only one pixel of them.
		const data = bmdFile({
			width: 2,
			height: 1,
			packed: Buffer.concat([
				Buffer.from([0xff]),
				Buffer.from([0x10, 0x20, 0x30, 0x40]),
			]),
		});
		const layout = readBmdLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackBmd(data, layout).toString("hex")).toBe(
			hex([0x10, 0x20, 0x30, 0x40, 0, 0, 0, 0]),
		);
	});

	it("declines a file that does not hold a bitmap", async () => {
		const data = bmdFile({
			width: 2,
			height: 1,
			mark: "_BMX",
			packed: literals(Buffer.alloc(8, 0x11)),
		});
		await expect(
			blackRainbowBmdImageFormat.open(new BufferByteSource(data), "pic.bmd"),
		).rejects.toThrow(GarbroError);
		await expect(
			blackRainbowBmdImageFormat.open(new BufferByteSource(data), "pic.bmd"),
		).rejects.toThrow("Not a Black Rainbow bitmap");
	});
});
