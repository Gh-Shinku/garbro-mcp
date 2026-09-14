import { BufferByteSource } from "@garbro-mcp/core";
import { silkyIgfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x14;
const PACKED_BIT = 0x80000000;

interface IgfOptions {
	width?: number;
	height?: number;
	depth?: number;
	packed?: boolean;
	unpackedSize?: number;
	body?: Buffer;
	/** Replaces the whole flags word, for the cases the reader refuses. */
	flags?: number;
	/** Replaces the marker. */
	signature?: string;
}

function buildIgf(options: IgfOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const depth = options.depth ?? 24;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.signature ?? "ZEUS", 0, "latin1");
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	header.writeInt32LE(options.unpackedSize ?? 0, 0x0c);
	const flags = options.flags ?? (options.packed ? PACKED_BIT + depth : depth);
	header.writeUInt32LE(flags, 0x10);
	return Buffer.concat([header, options.body ?? Buffer.alloc(0)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.igf"): Promise<Buffer> {
	const archive = await silkyIgfImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Silky's image", () => {
	it("declares the ZEUS word and no extension", async () => {
		expect(silkyIgfImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("ZEUS", "latin1") },
		]);
		expect(silkyIgfImageFormat.descriptor.extensions).toEqual([]);
		expect(
			await silkyIgfImageFormat.detect(
				sourceOf(buildIgf({ body: Buffer.alloc(12) })),
				"A",
			),
		).toBe(true);
		expect(
			await silkyIgfImageFormat.detect(
				sourceOf(buildIgf({ signature: "ZEUT", body: Buffer.alloc(12) })),
				"A",
			),
		).toBe(false);
		expect(
			await silkyIgfImageFormat.detect(sourceOf(Buffer.alloc(8)), "A"),
		).toBe(false);
	});

	it("takes its depth from the low byte of the flags, where zero means thirty two", async () => {
		for (const [depth, expected] of [
			[24, 24],
			[32, 32],
			[8, 8],
			[0, 32],
		] as Array<[number, number]>) {
			const archive = await silkyIgfImageFormat.open(
				sourceOf(
					buildIgf({ width: 2, height: 2, depth, body: Buffer.alloc(64) }),
				),
				"CG01.igf",
			);
			try {
				expect(archive.entries[0]?.metadata).toMatchObject({
					type: "image",
					width: 2,
					height: 2,
					bitsPerPixel: expected,
					packed: false,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("unfolds raw rows bottom up", async () => {
		// Two rows of two pixels each, the first row of the buffer being the one at the bottom of the image.
		const body = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const output = await extract(
			buildIgf({ width: 2, height: 2, depth: 24, body }),
		);
		expect(output.readUInt16LE(28)).toBe(24);
		// `CreateFlipped` keeps a positive height, which is what a bottom up bitmap records.
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(54, 60)).toEqual(Buffer.from([1, 2, 3, 4, 5, 6]));
		// Bitmap rows are padded to four bytes, so the second row starts eight bytes in.
		expect(output.subarray(62, 68)).toEqual(Buffer.from([7, 8, 9, 10, 11, 12]));
	});

	it("writes a thirty two bit image when the flags carry no depth", async () => {
		const body: Buffer = Buffer.alloc(4 * 1 * 2, 0x00);
		body.set([0x11, 0x22, 0x33, 0x44], 0);
		body.set([0x55, 0x66, 0x77, 0x88], 4);
		const output = await extract(
			buildIgf({ width: 1, height: 2, depth: 0, body }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(54, 62)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]),
		);
	});

	it("writes eight bit pixels as grey", async () => {
		const body = Buffer.from([0x00, 0x7f, 0x80, 0xff]);
		const output = await extract(
			buildIgf({ width: 2, height: 2, depth: 8, body }),
		);
		expect(output.readUInt16LE(28)).toBe(8);
		expect(output.readInt32LE(22)).toBe(2);
		// A grey ramp stands in for a palette, and the stored bytes are the levels themselves.
		expect(output.subarray(54 + 0x40 * 4, 54 + 0x40 * 4 + 4)).toEqual(
			Buffer.from([0x40, 0x40, 0x40, 0x00]),
		);
		expect(output.subarray(54 + 0x400, 54 + 0x400 + 2)).toEqual(
			Buffer.from([0x00, 0x7f]),
		);
		// Bitmap rows are padded to four bytes, so the second row starts four bytes in.
		expect(output.subarray(54 + 0x400 + 4, 54 + 0x400 + 6)).toEqual(
			Buffer.from([0x80, 0xff]),
		);
	});

	it("fills the window the packed stream unpacks from with the reference's byte", async () => {
		// One control byte whose first run is a single clear bit: one match of three bytes from offset zero,
		// which nothing has written yet. A window filled with zeroes would give three zero bytes here.
		const packed = Buffer.from([0xfe, 0x00, 0x00]);
		const output = await extract(
			buildIgf({
				width: 3,
				height: 1,
				depth: 8,
				packed: true,
				unpackedSize: 3,
				body: packed,
			}),
		);
		expect(output.subarray(54 + 0x400, 54 + 0x400 + 3)).toEqual(
			Buffer.from([0x20, 0x20, 0x20]),
		);
	});

	it("unfolds a packed stream of literals", async () => {
		// One control byte whose single run is eight set bits: eight literal bytes.
		const literals = Buffer.from([9, 8, 7, 6, 5, 4, 3, 2]);
		const packed = Buffer.concat([Buffer.from([0xff]), literals]);
		const output = await extract(
			buildIgf({
				width: 8,
				height: 1,
				depth: 8,
				packed: true,
				unpackedSize: 8,
				body: packed,
			}),
		);
		expect(output.subarray(54 + 0x400, 54 + 0x400 + 8)).toEqual(literals);
	});

	it("refuses a raw body that stops short and a packed one of the wrong size", async () => {
		const short = buildIgf({
			width: 2,
			height: 2,
			depth: 24,
			body: Buffer.alloc(4),
		});
		expect(await silkyIgfImageFormat.detect(sourceOf(short), "A")).toBe(true);
		await expect(extract(short)).rejects.toThrow(/truncated/);
		const wrong = buildIgf({
			width: 3,
			height: 1,
			depth: 8,
			packed: true,
			unpackedSize: 5,
			body: Buffer.concat([
				Buffer.from([0xff]),
				Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
			]),
		});
		await expect(extract(wrong)).rejects.toThrow(/own size/);
	});

	it("refuses a depth its bitmap cannot take", async () => {
		const sixteen = buildIgf({
			width: 2,
			height: 2,
			depth: 16,
			body: Buffer.alloc(64),
		});
		expect(await silkyIgfImageFormat.detect(sourceOf(sixteen), "A")).toBe(true);
		await expect(extract(sixteen)).rejects.toThrow(/depth: 16/);
	});

	it("names the entry after the image", async () => {
		const archive = await silkyIgfImageFormat.open(
			sourceOf(
				buildIgf({ width: 2, height: 2, depth: 24, body: Buffer.alloc(12) }),
			),
			"sub/CG07.igf",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG07.bmp");
			expect(archive.entries[0]?.compressed).toBe(false);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "none",
			});
		} finally {
			await archive.close();
		}
	});
});
