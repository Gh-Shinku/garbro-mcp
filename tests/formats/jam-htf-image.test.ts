import { BufferByteSource } from "@garbro-mcp/core";
import { htfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;
const MAX_UNPACKED = 0x1000000;

const WIDTH = 4;
const HEIGHT = 3;

/** A minimal valid eight bit bitmap with a grey palette. */
function buildBmp(width = WIDTH, height = HEIGHT, extra = 0): Buffer {
	const stride = (width + 3) & ~3;
	const imageSize = stride * height;
	const fileSize = DATA_OFFSET + imageSize;
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(fileSize, 2);
	header.writeUInt32LE(DATA_OFFSET, 10);
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(width, 18);
	header.writeInt32LE(-height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(8, 28);
	header.writeUInt32LE(imageSize, 34);
	header.writeUInt32LE(256, 46);
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE);
	for (let i = 0; i < 256; i += 1) {
		palette[i * 4] = i;
		palette[i * 4 + 1] = i;
		palette[i * 4 + 2] = i;
	}
	const body: Buffer = Buffer.alloc(imageSize + extra);
	for (let i = 0; i < imageSize; i += 1) body[i] = (i * 7) & 0xff;
	if (extra > 0) body.fill(0x5a, imageSize);
	return Buffer.concat([header, palette, body]);
}

/**
 * Writes a Huffman stream, most significant bit first, using a chain tree: the first symbol is reached
 * with a single zero bit, the second with `10`, the third with `110`, and the last lives at the end of
 * the chain. That is the same shape `decompressHuffman` walks, so the fixture exercises the tree wiring
 * rather than a degenerate single leaf.
 */
function huffmanStream(data: Buffer): Buffer {
	const symbols: number[] = [];
	for (const byte of data) if (!symbols.includes(byte)) symbols.push(byte);
	const bits: number[] = [];
	const push = (value: number, count: number): void => {
		for (let i = count - 1; i >= 0; i -= 1) bits.push((value >> i) & 1);
	};
	const pushByte = (value: number): void => push(value, 8);
	// A single distinct byte needs no chain at all: the root itself is a leaf, and the decoder then
	// produces that byte without reading any data bits.
	if (symbols.length === 1) {
		bits.push(0);
		pushByte(symbols[0] ?? 0);
		const single: Buffer = Buffer.alloc(1);
		single[0] = bits[0] === 1 ? 1 : 0;
		return single;
	}
	// Tree: internal, then its left leaf, then the rest of the chain.
	const writeNode = (index: number): void => {
		bits.push(1);
		bits.push(0);
		pushByte(symbols[index] ?? 0);
		if (index + 1 === symbols.length - 1) {
			// The final node holds the last two symbols, both as leaves.
			bits.push(0);
			pushByte(symbols[index + 1] ?? 0);
			return;
		}
		writeNode(index + 1);
	};
	writeNode(0);
	const codes = new Map<number, number[]>();
	for (let i = 0; i < symbols.length; i += 1) {
		codes.set(
			symbols[i] ?? 0,
			Array.from({ length: i }, () => 1).concat(
				i === symbols.length - 1 ? [] : [0],
			),
		);
	}
	for (const byte of data) {
		const code = codes.get(byte);
		if (!code) throw new Error("symbol without a code");
		bits.push(...code);
	}
	const out: Buffer = Buffer.alloc(Math.ceil(bits.length / 8));
	for (let i = 0; i < bits.length; i += 1) {
		if (bits[i] === 1) out[i >> 3] = (out[i >> 3] ?? 0) | (0x80 >> (i & 7));
	}
	return out;
}

function buildHtf(bmp: Buffer, declared = bmp.length): Buffer {
	const header: Buffer = Buffer.alloc(4);
	header.writeInt32LE(declared, 0);
	return Buffer.concat([header, huffmanStream(bmp)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("jam htf image", () => {
	it("declares no signature and the htf extension", () => {
		expect(htfImageFormat.detection?.signatures).toEqual([]);
	});

	it("decompresses the bitmap and reports its header", async () => {
		const bmp = buildBmp();
		const stored = buildHtf(bmp);
		const source = sourceOf(stored);
		expect(await htfImageFormat.detect(source, "CG01.HTF")).toBe(true);
		const archive = await htfImageFormat.open(source, "CG01.HTF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "huffman",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(stored.length - 4));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(bmp);
			expect(output.readUInt16LE(28)).toBe(8);
		} finally {
			await archive.close();
		}
	});

	it("trims the bitmap to the length its header declares", async () => {
		// The stream holds more than the bitmap says it needs.
		const bmp = buildBmp(WIDTH, HEIGHT, 0x20);
		const declared = DATA_OFFSET + ((WIDTH + 3) & ~3) * HEIGHT;
		// The container declares the whole stream; the bitmap declares only what it needs.
		const stored = buildHtf(bmp, bmp.length);
		expect(bmp.length).toBeGreaterThan(declared);
		const archive = await htfImageFormat.open(sourceOf(stored), "CG02.HTF");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(declared);
			// The whole bitmap up to its declared length, with the stream's extra tail dropped. A sentinel
			// byte would prove nothing here: the grey palette already holds every byte value.
			expect(output).toEqual(bmp.subarray(0, declared));
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the HTF extension", async () => {
		const stored = buildHtf(buildBmp());
		expect(await htfImageFormat.detect(sourceOf(stored), "CG01.BIN")).toBe(
			false,
		);
		expect(await htfImageFormat.detect(sourceOf(stored), "CG01")).toBe(false);
		// The extension is compared without regard to case.
		expect(await htfImageFormat.detect(sourceOf(stored), "cg01.htf")).toBe(
			true,
		);
	});

	it("declines an unpacked size outside the accepted range", async () => {
		const bmp = buildBmp();
		for (const declared of [0, -1, MAX_UNPACKED + 1]) {
			const stored = buildHtf(bmp, declared);
			expect(await htfImageFormat.detect(sourceOf(stored), "CG01.HTF")).toBe(
				false,
			);
		}
	});

	it("declines a stream that does not decompress to a bitmap", async () => {
		// A valid Huffman stream whose payload is not a bitmap.
		const stored = buildHtf(Buffer.alloc(0x40, 0x42));
		expect(await htfImageFormat.detect(sourceOf(stored), "CG01.HTF")).toBe(
			false,
		);
	});

	it("declines a bitmap with an OS/2 header", async () => {
		const bmp = buildBmp();
		bmp.writeUInt32LE(12, 14);
		const stored = buildHtf(bmp);
		expect(await htfImageFormat.detect(sourceOf(stored), "CG01.HTF")).toBe(
			false,
		);
	});

	it("declines a truncated stream", async () => {
		const stored = buildHtf(buildBmp());
		expect(
			await htfImageFormat.detect(sourceOf(stored.subarray(0, 8)), "CG01.HTF"),
		).toBe(false);
	});

	it("declines a file shorter than the size field", async () => {
		expect(
			await htfImageFormat.detect(sourceOf(Buffer.alloc(3)), "CG01.HTF"),
		).toBe(false);
	});
});
