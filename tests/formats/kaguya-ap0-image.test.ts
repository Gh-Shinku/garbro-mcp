import { BufferByteSource } from "@garbro-mcp/core";
import { ap0ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 12;
const BMP_HEADER_SIZE = 54;
const PALETTE_BYTES = 0x400;

interface Ap0Options {
	width?: number;
	height?: number;
	pixels?: Buffer;
	trailing?: number;
}

function buildAp0(options: Ap0Options = {}): Buffer {
	const { width = 3, height = 2 } = options;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("AP-0", 0, "latin1");
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	const pixels =
		options.pixels ??
		Buffer.from(Array.from({ length: width * height }, (_x, i) => i * 0x11));
	const file = Buffer.concat([header, pixels]);
	return options.trailing
		? Buffer.concat([file, Buffer.alloc(options.trailing, 0x5a)])
		: file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "SAMPLE.ALP"): Promise<Buffer> {
	const archive = await ap0ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The pixel block, after the header and the grey ramp palette. */
function body(output: Buffer): Buffer {
	return output.subarray(BMP_HEADER_SIZE + PALETTE_BYTES);
}

describe("kaguya ap-0 grayscale image", () => {
	it("registers the four byte signature and the alp extension", () => {
		expect(ap0ImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x41, 0x50, 0x2d, 0x30]) },
		]);
		expect(ap0ImageFormat.descriptor.extensions).toEqual(["alp"]);
	});

	it("reads eight bit grayscale pixels without reversing them", async () => {
		// The base format reverses its rows; this one does not, which is the whole difference between
		// `Create` and `CreateFlipped`.
		const file = buildAp0();
		const source = sourceOf(file);
		expect(await ap0ImageFormat.detect(source, "SAMPLE.ALP")).toBe(true);
		const archive = await ap0ImageFormat.open(source, "SAMPLE.ALP");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"SAMPLE.bmp",
			]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(8);
		// `CreateFlipped`: the data is bottom up as the bitmap means it, so the height is positive.
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.readUInt32LE(46)).toBe(256);
		// Three byte rows become four, with the pixels in the order they were stored.
		expect(body(output)).toEqual(
			Buffer.from([0x00, 0x11, 0x22, 0x00, 0x33, 0x44, 0x55, 0x00]),
		);
	});

	it("writes the grey ramp palette a grayscale bitmap expects", async () => {
		const output = await extract(buildAp0({ width: 1, height: 1 }));
		expect(output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 4)).toEqual(
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
		);
		expect(
			output.subarray(BMP_HEADER_SIZE + 255 * 4, BMP_HEADER_SIZE + 256 * 4),
		).toEqual(Buffer.from([0xff, 0xff, 0xff, 0x00]));
	});

	it("fails on extraction when the pixel stream is short", async () => {
		// The reference compares the read against the buffer length and throws, so the tail is not zeroed.
		const file = buildAp0({ width: 3, height: 2 });
		const truncated = file.subarray(0, file.length - 1);
		expect(await ap0ImageFormat.detect(sourceOf(truncated), "A.ALP")).toBe(
			true,
		);
		const archive = await ap0ImageFormat.open(sourceOf(truncated), "A.ALP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("ignores bytes after the pixels", async () => {
		// Unlike SFG, this format has no length equality: the buffer is read and anything after it is left.
		const plain = await extract(buildAp0());
		const padded = await extract(buildAp0({ trailing: 16 }));
		expect(padded).toEqual(plain);
	});

	it("applies the dimension ceiling but not a zero check", async () => {
		expect(
			await ap0ImageFormat.detect(
				sourceOf(buildAp0({ width: 0x8001 })),
				"A.ALP",
			),
		).toBe(false);
		expect(
			await ap0ImageFormat.detect(
				sourceOf(buildAp0({ height: 0x8001 })),
				"A.ALP",
			),
		).toBe(false);
		expect(
			await ap0ImageFormat.detect(
				sourceOf(buildAp0({ width: 0, height: 0, pixels: Buffer.alloc(0) })),
				"A.ALP",
			),
		).toBe(true);
		expect(
			await ap0ImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1)),
				"A.ALP",
			),
		).toBe(false);
	});
});
