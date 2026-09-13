import { BufferByteSource } from "@garbro-mcp/core";
import { csfImageDescriptor, csfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const PREFIX_SIZE = 0xb;
const BMP_HEADER_SIZE = 54;

interface Built {
	file: Buffer;
	bitmap: Buffer;
}

/** A minimal twenty four bit bitmap with its own length recorded in the header. */
function buildBmp(width = 3, height = 2): Buffer {
	const stride = (width * 3 + 3) & ~3;
	const pixels: Buffer = Buffer.alloc(stride * height, 0x40);
	const bitmap: Buffer = Buffer.alloc(BMP_HEADER_SIZE + pixels.length, 0);
	bitmap.write("BM", 0, "latin1");
	bitmap.writeUInt32LE(bitmap.length, 2);
	bitmap.writeUInt32LE(BMP_HEADER_SIZE, 10);
	bitmap.writeUInt32LE(40, 14);
	bitmap.writeInt32LE(width, 18);
	bitmap.writeInt32LE(height, 22);
	bitmap.writeUInt16LE(1, 26);
	bitmap.writeUInt16LE(24, 28);
	bitmap.writeUInt32LE(pixels.length, 34);
	pixels.copy(bitmap, BMP_HEADER_SIZE);
	return bitmap;
}

/**
 * The codec's control byte: one per eight items, lowest bit first, a set bit meaning a literal byte. An
 * all literal stream is therefore `0xFF` followed by up to eight bytes.
 */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

/** Eleven bytes of prefix — only the first three matter — then the compressed bitmap. */
function buildCsf(bitmap = buildBmp(), trailing = 0): Built {
	const unpacked: Buffer = Buffer.concat([
		bitmap,
		Buffer.alloc(trailing, 0x11),
	]);
	const prefix: Buffer = Buffer.alloc(PREFIX_SIZE, 0x2f);
	prefix.write("CSF", 0, "latin1");
	return {
		file: Buffer.concat([prefix, lzssLiterals(unpacked)]),
		bitmap,
	};
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("eye csf bitmap", () => {
	it("declares no signature and no extension", () => {
		expect(csfImageFormat.detection?.signatures).toEqual([]);
		expect(csfImageDescriptor.extensions).toEqual([]);
	});

	it("decompresses the lzss stream back to the bitmap", async () => {
		const built = buildCsf();
		const source = sourceOf(built.file);
		expect(await csfImageFormat.detect(source, "EV01.CSF")).toBe(true);
		const archive = await csfImageFormat.open(source, "EV01.CSF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["EV01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(built.bitmap);
			expect(archive.entries[0]?.size).toBe(
				BigInt(built.file.length - PREFIX_SIZE),
			);
		} finally {
			await archive.close();
		}
	});

	it("ignores the free bytes of the prefix", async () => {
		const built = buildCsf();
		built.file[4] = 0x99;
		built.file[PREFIX_SIZE - 1] = 0x01;
		expect(await csfImageFormat.detect(sourceOf(built.file), "EV01.CSF")).toBe(
			true,
		);
		const archive = await csfImageFormat.open(sourceOf(built.file), "EV01.CSF");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(built.bitmap);
		} finally {
			await archive.close();
		}
	});

	it("trims the output to the length the bitmap declares", async () => {
		const built = buildCsf(buildBmp(5, 4), 0x40);
		expect(built.bitmap.length).toBeLessThan(built.file.length - PREFIX_SIZE);
		const archive = await csfImageFormat.open(sourceOf(built.file), "EV02.CSF");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(built.bitmap);
			expect(output.readUInt32LE(2)).toBe(output.length);
		} finally {
			await archive.close();
		}
	});

	it("declines a stream that is not a bitmap", async () => {
		const prefix: Buffer = Buffer.alloc(PREFIX_SIZE, 0x2f);
		prefix.write("CSF", 0, "latin1");
		const stored = Buffer.concat([
			prefix,
			lzssLiterals(Buffer.alloc(0x40, 0x42)),
		]);
		expect(await csfImageFormat.detect(sourceOf(stored), "EV01.CSF")).toBe(
			false,
		);
	});

	it("declines an OS/2 core header", async () => {
		const bitmap = buildBmp();
		bitmap.writeUInt32LE(12, 14);
		expect(
			await csfImageFormat.detect(sourceOf(buildCsf(bitmap).file), "EV01.CSF"),
		).toBe(false);
	});

	it("declines a file whose prefix is not CSF", async () => {
		const built = buildCsf();
		built.file[1] = 0x44;
		expect(await csfImageFormat.detect(sourceOf(built.file), "EV01.CSF")).toBe(
			false,
		);
	});

	it("declines a file shorter than the prefix", async () => {
		expect(
			await csfImageFormat.detect(sourceOf(Buffer.alloc(4)), "EV01.CSF"),
		).toBe(false);
	});
});
