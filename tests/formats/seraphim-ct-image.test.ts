import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { seraphimCtImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
const BMP_HEADER_SIZE = 54;

/** One literal run: a control byte below 0x40 is a length of one to sixty four, then the bytes. */
function literals(values: number[] | Buffer): Buffer {
	const data = Buffer.from(values);
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 0x40) {
		const chunk = data.subarray(i, Math.min(i + 0x40, data.length));
		parts.push(Buffer.from([chunk.length - 1]), chunk);
	}
	return Buffer.concat(parts);
}

interface CtOptions {
	width?: number;
	height?: number;
	/** The picture, three bytes to the pixel in the order the file keeps them. */
	rgb?: Buffer;
	/** The transparency plane, one byte to the pixel, which the builder encodes into runs. */
	alpha?: number[] | Buffer;
	/** The transparency plane as it stands, for a test that wants an opcode of its own in it. */
	alphaStream?: Buffer;
	/** Whatever stands between the two planes, which the reference skips. */
	filler?: Buffer;
	/** The length of the picture the header claims. */
	packedSize?: number;
}

function buildCtFile(options: CtOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const rgb = literals(
		options.rgb ?? Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
	);
	const alpha =
		options.alphaStream ?? literals(options.alpha ?? [0, 25, 40, 100]);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("CF", 0, "latin1");
	header.writeUInt16LE(width, 8);
	header.writeUInt16LE(height, 10);
	header.writeInt32LE(options.packedSize ?? rgb.length, 12);
	const filler = options.filler ?? Buffer.alloc(4, 0x00);
	return Buffer.concat([header, rgb, filler, alpha]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer): Promise<Buffer> {
	const archive = await seraphimCtImageFormat.open(sourceOf(file), "CG01.cts");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The four bytes of a pixel of a four byte picture, which needs no row padding. */
function pixelAt(bmp: Buffer, x: number, y: number, width: number): number[] {
	const offset = BMP_HEADER_SIZE + (y * width + x) * 4;
	return [
		bmp[offset] ?? 0,
		bmp[offset + 1] ?? 0,
		bmp[offset + 2] ?? 0,
		bmp[offset + 3] ?? 0,
	];
}

describe("Seraphim CT image", () => {
	it("is found by the words of the picture it extends", async () => {
		expect(seraphimCtImageFormat.detection?.signatures?.length).toBe(6);
		expect(seraphimCtImageFormat.detection?.signatures?.[0]?.bytes).toEqual(
			Buffer.from("CF\0\0", "latin1"),
		);
		expect(
			await seraphimCtImageFormat.detect(sourceOf(buildCtFile()), "a.cts"),
		).toBe(true);
		// The header of this format is the header of the three byte one, so its own word would have been
		// shadowed by it anyway: the reference registers both under the same list.
		expect(
			await seraphimCtImageFormat.detect(
				sourceOf(buildCtFile({ packedSize: 0 })),
				"a.cts",
			),
		).toBe(false);
		expect(
			await seraphimCtImageFormat.detect(sourceOf(Buffer.alloc(8)), "a.cts"),
		).toBe(false);
	});

	it("writes the picture with the transparency plane behind it", async () => {
		const file = buildCtFile({ alpha: [0, 25, 40, 100] });
		const archive = await seraphimCtImageFormat.open(
			sourceOf(file),
			"CG01.cts",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "seraphim-rgb-alpha",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(32);
		// The picture of this format comes out the way it was stored, without the flip the other three get.
		expect(bmp.readInt32LE(22)).toBe(-2);
		// A colour of nought leaves the pixel opaque, and the reference inverts the transparency it reads.
		expect(pixelAt(bmp, 0, 0, 2)).toEqual([7, 8, 9, 153]);
		expect(pixelAt(bmp, 1, 0, 2)).toEqual([10, 11, 12, 0]);
		expect(pixelAt(bmp, 0, 1, 2)).toEqual([1, 2, 3, 255]);
		expect(pixelAt(bmp, 1, 1, 2)).toEqual([4, 5, 6, 192]);
	});

	it("reads the transparency plane where the length of the picture says it is", async () => {
		// Four bytes that would decode into a very different picture stand between the planes.
		const file = buildCtFile({
			alpha: [0, 100, 0, 100],
			filler: Buffer.from([0x03, 0xff, 0xff, 0xff]),
		});
		const bmp = await extract(file);
		// Had the reference read the plane straight after the pictures bytes it would have found the filler.
		expect(pixelAt(bmp, 0, 0, 2)).toEqual([7, 8, 9, 255]);
		expect(pixelAt(bmp, 1, 0, 2)).toEqual([10, 11, 12, 0]);
	});

	it("stops on an opcode the reference does not know, in either plane", async () => {
		const file = buildCtFile({
			alphaStream: Buffer.concat([literals([0, 25, 40]), Buffer.from([0xf3])]),
		});
		const archive = await seraphimCtImageFormat.open(
			sourceOf(file),
			"CG01.cts",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Invalid Seraphim image opcode",
			});
		} finally {
			await archive.close();
		}
	});
});
