import { BufferByteSource } from "@garbro-mcp/core";
import { crowdZbmImageFormat, lzBmpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const STREAM_OFFSET = 0x0e;
const BMP_HEADER_SIZE = 54;
/** The reference inverts this many bytes of the decoded image. */
const XOR_SIZE = 100;

/** A literal only LZSS stream: every control bit set, then the bytes. Frame settings never come into it. */
function lzssLiterals(data: Buffer): Buffer {
	const out: number[] = [];
	for (let i = 0; i < data.length; i += 8) {
		out.push(0xff);
		for (let j = i; j < Math.min(i + 8, data.length); j += 1) {
			out.push(data[j] ?? 0);
		}
	}
	return Buffer.from(out);
}

/** A twenty four bit bitmap, big enough for the inversion to run into the pixels. */
function buildBmp(width: number, height: number): Buffer {
	const pixels = Buffer.alloc(width * height * 3, 0x00);
	for (let index = 0; index < pixels.length; index += 1) {
		pixels[index] = (index * 7 + 3) & 0xff;
	}
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(BMP_HEADER_SIZE + pixels.length, 2);
	header.writeUInt32LE(BMP_HEADER_SIZE, 10);
	header.writeUInt32LE(40, 14);
	header.writeUInt32LE(width, 18);
	header.writeInt32LE(height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(24, 28);
	header.writeUInt32LE(pixels.length, 34);
	return Buffer.concat([header, pixels]);
}

/** What the file holds: the first hundred bytes inverted, the rest as they are. */
function obfuscate(data: Buffer): Buffer {
	const copy = Buffer.from(data);
	const count = Math.min(XOR_SIZE, copy.length);
	for (let index = 0; index < count; index += 1) {
		copy[index] = (copy[index] ?? 0) ^ 0xff;
	}
	return copy;
}

function buildZbm(data: Buffer, sizeOverride?: number): Buffer {
	const header: Buffer = Buffer.alloc(STREAM_OFFSET, 0x00);
	header.write("SZDD", 0, "latin1");
	header.writeInt32LE(sizeOverride ?? data.length, 0x0a);
	return Buffer.concat([header, lzssLiterals(obfuscate(data))]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "IMAGE.ZBM"): Promise<Buffer> {
	const archive = await crowdZbmImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("crowd zbm compressed bitmap", () => {
	it("declares the SZDD signature, no extension and its obfuscation", () => {
		expect(crowdZbmImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x53, 0x5a, 0x44, 0x44]) },
		]);
		expect(crowdZbmImageFormat.descriptor.extensions).toEqual([]);
		expect(crowdZbmImageFormat.descriptor.capabilities.encryption).toBe(true);
	});

	it("reads the metadata from an inverted header", async () => {
		const real = buildBmp(10, 4);
		const file = buildZbm(real);
		// The stored header is not `BM` but its complement, which is what keeps the probes of the other SZDD
		// formats apart.
		expect(obfuscate(real).subarray(0, 2)).toEqual(Buffer.from([0xbd, 0xb2]));
		expect(obfuscate(real).subarray(0, 2).toString("latin1")).not.toBe("BM");
		const source = sourceOf(file);
		expect(await crowdZbmImageFormat.detect(source, "IMAGE.ZBM")).toBe(true);
		const archive = await crowdZbmImageFormat.open(source, "IMAGE.ZBM");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["IMAGE.bmp"]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 10,
				height: 4,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({ unpackedSize: real.length });
		} finally {
			await archive.close();
		}
	});

	it("inverts the header and the first pixels, and stops at a hundred bytes", async () => {
		// Extraction flips a hundred bytes where the metadata read flips fifty four, so the first forty six
		// bytes of the image come back with the header.
		const real = buildBmp(10, 4);
		const file = buildZbm(real);
		const output = await extract(file);
		expect(output).toEqual(real);
		const stored = obfuscate(real);
		expect(output[BMP_HEADER_SIZE]).toBe((stored[BMP_HEADER_SIZE] ?? 0) ^ 0xff);
		expect(output[XOR_SIZE - 1]).toBe((stored[XOR_SIZE - 1] ?? 0) ^ 0xff);
		expect(output[XOR_SIZE]).toBe(stored[XOR_SIZE]);
		expect(output.length).toBe(real.length);
	});

	it("follows a small size word rather than refusing it", async () => {
		// The stored word is the codec's output length and nothing bounds it from below, so a short one
		// produces a short bitmap instead of a decline.
		const real = buildBmp(4, 2);
		const output = await extract(buildZbm(real, 20));
		expect(output.length).toBe(20);
		expect(output).toEqual(real.subarray(0, 20));
	});

	it("declines a stream that cannot supply a header", async () => {
		// An empty payload decodes to nothing, so there is no header to invert and read.
		const empty = Buffer.concat([
			Buffer.from("SZDD", "latin1"),
			Buffer.alloc(STREAM_OFFSET - 4, 0x00),
		]);
		empty.writeInt32LE(BMP_HEADER_SIZE, 0x0a);
		expect(await crowdZbmImageFormat.detect(sourceOf(empty), "A.ZBM")).toBe(
			false,
		);
		expect(
			await crowdZbmImageFormat.detect(
				sourceOf(Buffer.alloc(STREAM_OFFSET - 1)),
				"A.ZBM",
			),
		).toBe(false);
		const wrongSignature = buildZbm(buildBmp(4, 2));
		wrongSignature[0] = 0x54;
		expect(
			await crowdZbmImageFormat.detect(sourceOf(wrongSignature), "A.ZBM"),
		).toBe(false);
	});

	it("is disjoint from the other SZDD bitmap", async () => {
		// Both formats use the same signature and the same codec settings, but one looks for `BM` as stored and
		// this one only after inverting every byte, so neither can accept the other's files.
		const inverted = buildZbm(buildBmp(10, 4));
		expect(await crowdZbmImageFormat.detect(sourceOf(inverted), "A.ZBM")).toBe(
			true,
		);
		expect(await lzBmpImageFormat.detect(sourceOf(inverted), "A.ZBM")).toBe(
			false,
		);
		const stored = buildZbm(obfuscate(buildBmp(10, 4)));
		for (let index = 0; index < BMP_HEADER_SIZE; index += 1) {
			stored[STREAM_OFFSET + index] = 0x00;
		}
		expect(await lzBmpImageFormat.detect(sourceOf(stored), "A.ZBM")).toBe(
			false,
		);
	});
});
