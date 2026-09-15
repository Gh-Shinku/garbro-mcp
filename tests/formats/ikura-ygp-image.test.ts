import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	ikuraYgpImageFormat,
	readYgpLayout,
	unpackYgp,
} from "../../packages/formats/src/ikura/ygp-image.js";

const HEADER_FIELDS = 8;
const DATA_OFFSET = 0x36;

/** A step of pixels that stand in the stream themselves, four bytes to the pixel. */
function raw(bytes: number[]): Buffer {
	if (bytes.length % 4 !== 0 || bytes.length < 4 || bytes.length > 256) {
		throw new Error("a step of pixels holds one to sixty four pixels");
	}
	return Buffer.from([bytes.length / 4 - 1, ...bytes]);
}

/** A step repeating the pixel before it. */
function repeat(count: number): Buffer {
	return Buffer.from([0x40 | (count - 1)]);
}

/** A step copying from a place behind, the place a byte long. */
function copy8(count: number, offset: number): Buffer {
	return Buffer.from([0x80 | (count - 1), offset]);
}

/** A step copying from a place behind, the place two bytes long. */
function copy16(count: number, offset: number): Buffer {
	return Buffer.from([0xa0 | (count - 1), offset & 0xff, (offset >> 8) & 0xff]);
}

/** A pixel of a ramp, four bytes to the pixel, of which the first three carry the number. */
function rampPixels(count: number): Buffer {
	const out: Buffer = Buffer.alloc(count * 4, 0x00);
	for (let index = 0; index < count; index += 1) {
		out[index * 4] = index & 0xff;
		out[index * 4 + 1] = (index + 0x40) & 0xff;
		out[index * 4 + 2] = (index + 0x80) & 0xff;
	}
	return out;
}

interface FileParts {
	width?: number;
	height?: number;
	type?: number;
	flags?: number;
	headerSize?: number;
	/** The mask the reference reads and never looks at again. */
	mask?: number;
	/** The size the walk is told the stream is, which is its own length by default. */
	dataSize?: number;
	steps?: Buffer;
	raw?: Buffer;
	offsetX?: number;
	offsetY?: number;
}

/** A whole file: the header, the fields of the picture behind it and the stream of the pixels. */
function ygpFile(parts: FileParts = {}): Buffer {
	const headerSize = parts.headerSize ?? 0x20;
	const stream = parts.steps ?? parts.raw ?? Buffer.alloc(0);
	const head: Buffer = Buffer.alloc(headerSize + HEADER_FIELDS, 0x00);
	head.write("YGP\0", 0, "latin1");
	head.writeUInt16LE(parts.mask ?? 0x1234, 4);
	head[6] = parts.type ?? 1;
	head[7] = parts.flags ?? 0;
	head.writeInt32LE(headerSize, 8);
	if (0 !== ((parts.flags ?? 0) & 4)) {
		head.writeInt16LE(parts.offsetX ?? 0, 0x14);
		head.writeInt16LE(parts.offsetY ?? 0, 0x16);
	}
	head.writeInt32LE(parts.dataSize ?? stream.length, headerSize);
	head.writeUInt16LE(parts.width ?? 1, headerSize + 4);
	head.writeUInt16LE(parts.height ?? 1, headerSize + 6);
	return Buffer.concat([head, stream]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.ygp"): Promise<Buffer> {
	const handle = await ikuraYgpImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of the bitmap of a picture, four bytes to the pixel, top row first. */
function pixels(bitmap: Buffer, width: number, height: number): string {
	return bitmap
		.subarray(DATA_OFFSET, DATA_OFFSET + width * height * 4)
		.toString("hex");
}

describe("Ikura GDL picture format", () => {
	it("finds a picture by its four bytes", async () => {
		const data = ygpFile({ raw: rampPixels(1) });
		expect(await ikuraYgpImageFormat.detect(sourceOf(data), "cg.ygp")).toBe(
			true,
		);
		// The kind of the picture has to stand at one or two, and the measurements above nothing.
		expect(
			await ikuraYgpImageFormat.detect(
				sourceOf(ygpFile({ type: 0 })),
				"cg.ygp",
			),
		).toBe(false);
		expect(
			await ikuraYgpImageFormat.detect(
				sourceOf(ygpFile({ type: 3 })),
				"cg.ygp",
			),
		).toBe(false);
		expect(
			await ikuraYgpImageFormat.detect(
				sourceOf(ygpFile({ width: 0 })),
				"cg.ygp",
			),
		).toBe(false);
		expect(
			await ikuraYgpImageFormat.detect(
				sourceOf(ygpFile({ height: 0 })),
				"cg.ygp",
			),
		).toBe(false);
		expect(readYgpLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
		// A header that does not hold the fields of the picture behind it is turned away.
		const broken = ygpFile({ raw: rampPixels(1) });
		broken.writeInt32LE(0x200, 8);
		expect(readYgpLayout(broken)).toBeUndefined();
	});

	it("reads two bytes of the header that it never looks at again", async () => {
		// The reference reads the mask at offset four and never uses it, so any value is a picture.
		const one = readYgpLayout(ygpFile({ mask: 0, raw: rampPixels(1) }));
		const other = readYgpLayout(ygpFile({ mask: 0xffff, raw: rampPixels(1) }));
		expect(one?.width).toBe(1);
		expect(other?.width).toBe(1);
	});

	it("reports the measurements, the depth and the place where a flag asks for it", async () => {
		const handle = await ikuraYgpImageFormat.open(
			sourceOf(
				ygpFile({
					width: 2,
					height: 2,
					flags: 4,
					offsetX: -3,
					offsetY: 5,
					raw: rampPixels(4),
				}),
			),
			"dir/cg.ygp",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			offsetX: -3,
			offsetY: 5,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "none",
			width: 2,
			height: 2,
		});
		// Without the flag there is no place to report at all.
		const plain = await ikuraYgpImageFormat.open(
			sourceOf(ygpFile({ raw: rampPixels(1) })),
			"cg.ygp",
		);
		expect("offsetX" in (plain.entries[0]?.metadata ?? {})).toBe(false);
	});

	it("reads the pixels as they stand where no flag asks for a walk", async () => {
		const bitmap = await extract(
			ygpFile({ width: 2, height: 1, raw: rampPixels(2) }),
		);
		expect(bitmap.readUInt16LE(0x1c)).toBe(32);
		expect(bitmap.readInt32LE(0x16)).toBe(-1);
		expect(pixels(bitmap, 2, 1)).toBe(
			Buffer.concat([rampPixels(1), rampPixels(2).subarray(4, 8)]).toString(
				"hex",
			),
		);
	});

	it("walks a stream of pixels that stand in it and of runs", async () => {
		// Two pixels stand in the stream, the second of them is repeated once and then copied twice.
		const data = ygpFile({
			width: 6,
			height: 1,
			flags: 1,
			steps: Buffer.concat([
				raw([1, 2, 3, 0xaa, 4, 5, 6, 0xbb]),
				repeat(2),
				copy8(2, 2),
			]),
		});
		const bitmap = await extract(data);
		expect(pixels(bitmap, 6, 1)).toBe(
			"010203aa040506bb040506bb040506bb040506bb040506bb",
		);
	});

	it("copies a run from a place a byte long", async () => {
		const ramp = rampPixels(4);
		const data = ygpFile({
			width: 6,
			height: 1,
			flags: 1,
			steps: Buffer.concat([raw([...ramp]), copy8(2, 4)]),
		});
		const bitmap = await extract(data);
		// Six pixels of a picture of four: the ramp, then its first two pixels again.
		expect(pixels(bitmap, 6, 1)).toBe(
			Buffer.concat([ramp, ramp.subarray(0, 8)]).toString("hex"),
		);
	});

	it("copies a run from a place two bytes long", async () => {
		// A picture of seventy pixels: the first sixty eight stand in the stream, and the last two are copied
		// from a place of sixty six pixels, which reaches the third pixel of the picture.
		const ramp = rampPixels(68);
		const data = ygpFile({
			width: 70,
			height: 1,
			flags: 1,
			steps: Buffer.concat([
				raw([...ramp.subarray(0, 256)]),
				raw([...ramp.subarray(256)]),
				copy16(2, 0x42),
			]),
		});
		const bitmap = await extract(data);
		expect(pixels(bitmap, 70, 1)).toBe(
			Buffer.concat([ramp, ramp.subarray(8, 16)]).toString("hex"),
		);
	});

	it("steps over the rest of the stream where a control byte says nothing", async () => {
		// The first step of pixels and then a control byte above `0xC0`: the picture is not moved on.
		const data = ygpFile({
			width: 4,
			height: 1,
			flags: 1,
			steps: Buffer.concat([
				raw([1, 2, 3, 0xaa]),
				Buffer.from([0xff]),
				raw([4, 5, 6, 0xbb]),
			]),
		});
		const bitmap = await extract(data);
		// The step above `0xC0` moves the picture on by nothing, so the pixels behind it land on the second
		// pixel rather than the third, and the first two pixels of the picture are the two steps of pixels.
		expect(pixels(bitmap, 4, 1)).toBe("010203aa040506bb0000000000000000");
	});

	it("leaves the pixels the stream does not fill as they stand", async () => {
		// The step asks for two pixels of which the stream holds one, so the second stands as it was.
		const data = ygpFile({
			width: 2,
			height: 1,
			flags: 1,
			steps: Buffer.from([1, 1, 2, 3, 0xaa]),
		});
		const bitmap = await extract(data);
		expect(pixels(bitmap, 2, 1)).toBe("010203aa00000000");
	});

	it("refuses a walk that writes past the end of the picture", async () => {
		const data = ygpFile({
			width: 1,
			height: 1,
			flags: 1,
			steps: Buffer.concat([raw([1, 2, 3, 0xaa]), raw([4, 5, 6, 0xbb])]),
		});
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"Ikura picture writes past its own end",
		);
	});

	it("refuses a run that copies from before the start of the picture", async () => {
		const data = ygpFile({
			width: 2,
			height: 1,
			flags: 1,
			steps: Buffer.concat([raw([1, 2, 3, 0xaa]), copy8(1, 3)]),
		});
		await expect(extract(data)).rejects.toThrow(
			"Ikura picture copies from before its start",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const data = ygpFile({
			width: 0xffff,
			height: 0xffff,
			raw: Buffer.alloc(4, 0),
		});
		expect(await ikuraYgpImageFormat.detect(sourceOf(data), "cg.ygp")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("walks the steps of a picture of one pixel itself", () => {
		const data = ygpFile({
			width: 1,
			height: 1,
			flags: 1,
			steps: raw([9, 8, 7, 6]),
		});
		const layout = readYgpLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackYgp(data, layout).toString("hex")).toBe("09080706");
	});
});
