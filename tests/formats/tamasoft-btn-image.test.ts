import { BufferByteSource } from "@garbro-mcp/core";
import { btnImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x45, 0x42, 0x54, 0x4e]);
const SUR_SIGNATURE = Buffer.from([0x45, 0x53, 0x55, 0x52]);
const TABLE_OFFSET = 0x30;
const SUR_HEADER_SIZE = 0x10;
const SUR_PIXEL_OFFSET = 0x20;
const BMP_HEADER_SIZE = 54;
/** Filler for everything the reference never reads: the header tail, the table and the SUR gap. */
const FILLER = 0xab;

function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

function buildPixels(size: number): Buffer {
	const pixels: Buffer = Buffer.alloc(size);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 37 + 5) & 0xff;
	return pixels;
}

function buildSurRegion(options: {
	width: number;
	height: number;
	stream: Buffer;
}): Buffer {
	const header: Buffer = Buffer.alloc(SUR_HEADER_SIZE, 0x00);
	SUR_SIGNATURE.copy(header, 0);
	header.writeUInt32LE(options.width, 8);
	header.writeUInt32LE(options.height, 12);
	return Buffer.concat([
		header,
		Buffer.alloc(SUR_PIXEL_OFFSET - SUR_HEADER_SIZE, FILLER),
		options.stream,
	]);
}

function buildBtn(options: { count: number; sur?: Buffer }): Buffer {
	const header: Buffer = Buffer.alloc(8, FILLER);
	SIGNATURE.copy(header, 0);
	header.writeInt32LE(options.count, 4);
	const table = Buffer.alloc(options.count > 0 ? options.count * 4 : 0, FILLER);
	return Buffer.concat([
		header,
		Buffer.alloc(TABLE_OFFSET - 8, FILLER),
		table,
		options.sur ?? Buffer.alloc(0),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await btnImageFormat.open(sourceOf(stored), "BTN01.BTN");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("tamasoft btn image", () => {
	it("declares the EBTN signature and no extension", () => {
		expect(btnImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("EBTN");
		expect(btnImageFormat.descriptor.extensions).toEqual([]);
	});

	it("decodes the embedded image of a button with no table", async () => {
		const pixels = buildPixels(16);
		const sur = buildSurRegion({
			width: 2,
			height: 2,
			stream: lzssLiterals(pixels),
		});
		const stored = buildBtn({ count: 0, sur });
		expect(stored.length).toBe(TABLE_OFFSET + sur.length);
		const source = sourceOf(stored);
		expect(await btnImageFormat.detect(source, "BTN01.BTN")).toBe(true);
		const archive = await btnImageFormat.open(source, "BTN01.BTN");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BTN01.bmp"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "sur-lzss",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
				surOffset: TABLE_OFFSET,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("skips the table before the embedded image", async () => {
		const pixels = buildPixels(16);
		const sur = buildSurRegion({
			width: 2,
			height: 2,
			stream: lzssLiterals(pixels),
		});
		const stored = buildBtn({ count: 3, sur });
		// Twelve table entries worth of padding sit between the header and the file.
		expect(stored.subarray(TABLE_OFFSET, TABLE_OFFSET + 12)).toEqual(
			Buffer.alloc(12, FILLER),
		);
		const archive = await btnImageFormat.open(sourceOf(stored), "BTN01.BTN");
		try {
			expect(archive.metadata).toMatchObject({
				surOffset: TABLE_OFFSET + 12,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("reads the pixel offset from the embedded file rather than from this one", async () => {
		// A large table pushes the embedded file far enough that the bytes at the absolute offset 0x20 are the
		// filler this fixture writes, not the compressed stream. A port that ignored the rebasing would decode
		// those instead.
		const pixels = buildPixels(8);
		const sur = buildSurRegion({
			width: 2,
			height: 1,
			stream: lzssLiterals(pixels),
		});
		const stored = buildBtn({ count: 8, sur });
		expect(stored.subarray(0x20, 0x24)).toEqual(Buffer.alloc(4, FILLER));
		const output = await extract(stored);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("declines a negative table count", async () => {
		const stored = buildBtn({ count: -1 });
		expect(await btnImageFormat.detect(sourceOf(stored), "BTN01.BTN")).toBe(
			false,
		);
	});

	it("declines a table count that points past the file", async () => {
		const stored = buildBtn({ count: 0x100000 });
		expect(await btnImageFormat.detect(sourceOf(stored), "BTN01.BTN")).toBe(
			false,
		);
	});

	it("declines an embedded file without a sur header", async () => {
		const sur = Buffer.alloc(0x40, 0x00);
		const stored = buildBtn({ count: 1, sur });
		expect(await btnImageFormat.detect(sourceOf(stored), "BTN01.BTN")).toBe(
			false,
		);
	});

	it("lists a truncated stream but fails to extract it", async () => {
		const pixels = buildPixels(16);
		const sur = buildSurRegion({
			width: 2,
			height: 2,
			stream: lzssLiterals(pixels).subarray(0, 8),
		});
		const stored = buildBtn({ count: 0, sur });
		const source = sourceOf(stored);
		expect(await btnImageFormat.detect(source, "BTN01.BTN")).toBe(true);
		const archive = await btnImageFormat.open(source, "BTN01.BTN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});
});
