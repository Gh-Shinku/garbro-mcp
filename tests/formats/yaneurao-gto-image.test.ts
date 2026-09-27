import { BufferByteSource } from "@garbro-mcp/core";
import { yaneuraoGtoImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const FILTER_KEY = 0x0c;

/** Applies the key the reference's `SubFilterStream` takes off when reading. */
function addKey(file: Buffer): Buffer {
	const encoded: Buffer = Buffer.alloc(file.length, 0x00);
	for (let index = 0; index < file.length; index += 1) {
		encoded[index] = ((file[index] ?? 0) + FILTER_KEY) & 0xff;
	}
	return encoded;
}

interface BmpOptions {
	width?: number;
	height?: number;
	bits?: 24 | 32;
	/** Writes a DIB size the shared bitmap reader does not accept. */
	broken?: boolean;
}

/** A bitmap as the tests write it, with both ends of the byte range in its pixels. */
function buildBmp(options: BmpOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const bits = options.bits ?? 24;
	const header: Buffer = Buffer.alloc(54, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(14 + 40, 10);
	header.writeUInt32LE(options.broken ? 1 : 40, 14);
	header.writeInt32LE(width, 18);
	header.writeInt32LE(height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(bits, 28);
	const rowSize = Math.floor((width * (bits / 8) + 3) / 4) * 4;
	const body: Buffer = Buffer.alloc(rowSize * height, 0x00);
	for (let index = 0; index < body.length; index += 1) {
		body[index] = index % 2 === 0 ? 0x00 : 0xff;
	}
	header.writeUInt32LE(header.length + body.length, 2);
	return Buffer.concat([header, body]);
}

interface GtoOptions extends BmpOptions {
	/** How many bytes to drop from the end of the encoded file. */
	truncate?: number;
	/** Leaves the bitmap as it is, without the key. */
	plain?: boolean;
}

function buildGto(options: GtoOptions = {}): Buffer {
	const bmp = buildBmp(options);
	const file = options.plain ? bmp : addKey(bmp);
	return options.truncate
		? file.subarray(0, Math.max(0, file.length - options.truncate))
		: file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.gto"): Promise<Buffer> {
	const archive = await yaneuraoGtoImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Yaneurao obfuscated bitmap", () => {
	it("needs the keyed marker and a bitmap behind it", async () => {
		expect(
			await yaneuraoGtoImageFormat.detect(sourceOf(buildGto()), "A.gto"),
		).toBe(true);
		// The same bitmap without the key is not this format.
		expect(
			await yaneuraoGtoImageFormat.detect(
				sourceOf(buildGto({ plain: true })),
				"A.gto",
			),
		).toBe(false);
		// The marker alone is not enough: the bytes behind it have to read back as a bitmap header.
		expect(
			await yaneuraoGtoImageFormat.detect(
				sourceOf(
					Buffer.concat([Buffer.from("NY", "latin1"), Buffer.alloc(64, 0x00)]),
				),
				"A.gto",
			),
		).toBe(false);
		expect(
			await yaneuraoGtoImageFormat.detect(
				sourceOf(Buffer.from("N", "latin1")),
				"A.gto",
			),
		).toBe(false);
	});

	it("takes its size from the bitmap behind the key", async () => {
		const archive = await yaneuraoGtoImageFormat.open(
			sourceOf(buildGto({ width: 5, height: 3 })),
			"A.gto",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 5,
				height: 3,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
	});

	it("reads the places of the picture the key stands behind", async () => {
		const file = buildGto({ width: 3, height: 2 });
		const picture = readBmpImage(await extract(file));
		expect(picture).toMatchObject({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
		});
		// A row of three pixels of three places of a colour stands of nine places of the file where the row of
		// a bitmap stands of twelve, so the padding of the file stands of no count of the picture.
		const bmp = buildBmp({ width: 3, height: 2 });
		const expected: number[] = [];
		for (let row = 0; row < 2; row += 1) {
			for (let at = 0; at < 9; at += 1)
				expected.push(bmp[54 + row * 12 + at] ?? 0);
		}
		expect([...(picture?.pixels ?? [])]).toEqual(expected);
	});

	it("adds its key back at both ends of the byte range", async () => {
		// The body alternates between the two extremes, so a key added back the wrong way would show.
		const picture = readBmpImage(
			await extract(buildGto({ width: 2, height: 1 })),
		);
		const bmp = buildBmp({ width: 2, height: 1 });
		expect([...(picture?.pixels ?? [])]).toEqual([...bmp.subarray(54, 60)]);
	});

	it("reads a thirty two bit bitmap", async () => {
		const picture = readBmpImage(
			await extract(buildGto({ width: 2, height: 1, bits: 32 })),
		);
		expect(picture).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
		expect([...(picture?.pixels ?? [])]).toEqual([
			...buildBmp({ width: 2, height: 1, bits: 32 }).subarray(54, 62),
		]);
	});

	it("turns a picture that ends inside its places away", async () => {
		const file = buildGto({ width: 4, height: 4, truncate: 10 });
		// The header is all the walk of the file reads, so a short file still detects and still lists, and the
		// walk of the places of the picture stands turned away, which is where the reference throws.
		expect(await yaneuraoGtoImageFormat.detect(sourceOf(file), "A.gto")).toBe(
			true,
		);
		await expect(extract(file)).rejects.toThrow();
	});

	it("refuses a file whose header does not read back as a bitmap", async () => {
		const file = buildGto({ broken: true });
		expect(await yaneuraoGtoImageFormat.detect(sourceOf(file), "A.gto")).toBe(
			false,
		);
		await expect(extract(file)).rejects.toThrow();
	});

	it("names the entry after the bitmap and reports its depth", async () => {
		const archive = await yaneuraoGtoImageFormat.open(
			sourceOf(buildGto({ width: 6, height: 2 })),
			"sub/CG_07.gto",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 6,
				height: 2,
			});
		} finally {
			await archive.close();
		}
	});
});
