import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { uranNclImageFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
} from "../../packages/formats/src/shared/bmp.js";

const NAME_OFFSET = 10;
const GAP_SIZE = 6;
const EMBEDDED_HEADER_SIZE = 9;
/** Every byte of the packed data has ten taken off it, so the fixture adds it on. */
const KEY = 10;

interface NclOptions {
	/** The path the file stores, which has to name a bitmap. */
	name?: string;
	/** The measurement its own header declares, which need not be the bitmap's. */
	width?: number;
	height?: number;
	/** What the bitmap inside is: an eight bit palette one unless the caller says otherwise. */
	bitmap?: Buffer;
	/** The byte in front of the packed data; two means the rest of it is a deflate stream. */
	method?: number;
	/** What is added to every byte of the packed data, which is ten unless the caller says otherwise. */
	key?: number;
	/** The size the packed data claims to be, which the fixture gets right unless it is told otherwise. */
	declaredSize?: number;
	/** A whole packed body to store instead of one built from a bitmap, before the key is added to it. */
	body?: Buffer;
}

/** One colour map as a bitmap stores it: blue, green, red, unused. */
function greyEntries(): Buffer {
	const entries: Buffer = Buffer.alloc(256 * 4);
	for (let i = 0; i < 256; i += 1) {
		entries[i * 4] = 255 - i;
		entries[i * 4 + 1] = i;
		entries[i * 4 + 2] = i;
	}
	return entries;
}

function buildNclFile(options: NclOptions = {}): Buffer {
	const name = options.name ?? "CG\\GRAPHIC.BMP";
	const width = options.width ?? 4;
	const height = options.height ?? 2;
	const bitmap =
		options.bitmap ??
		writeBmp8Palette(
			width,
			height,
			Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
			greyEntries(),
		);
	const method = options.method ?? 0;
	const body =
		options.body ??
		(2 === method
			? Buffer.concat([Buffer.from([method]), deflateSync(bitmap)])
			: Buffer.concat([Buffer.from([method]), bitmap]));
	const key = options.key ?? KEY;
	const packed: Buffer = Buffer.alloc(body.length);
	for (let i = 0; i < body.length; i += 1) {
		packed[i] = ((body[i] ?? 0) + key) & 0xff;
	}
	const nameBytes = Buffer.from(name, "latin1");
	const head: Buffer = Buffer.alloc(NAME_OFFSET);
	head.writeInt32LE(options.declaredSize ?? packed.length, 0);
	head.writeUInt16LE(nameBytes.length, 8);
	const gap: Buffer = Buffer.alloc(GAP_SIZE + EMBEDDED_HEADER_SIZE);
	gap.writeUInt16LE(EMBEDDED_HEADER_SIZE, GAP_SIZE - 2);
	gap.writeUInt32LE(width, GAP_SIZE + 1);
	gap.writeUInt32LE(height, GAP_SIZE + 5);
	return Buffer.concat([head, nameBytes, gap, packed]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.ncl"): Promise<Buffer> {
	const archive = await uranNclImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Uran NCL image", () => {
	it("finds its pictures by their extension and their stored path", async () => {
		expect(uranNclImageFormat.detection?.signatures).toEqual([]);
		const file = buildNclFile();
		expect(await uranNclImageFormat.detect(sourceOf(file), "CG01.ncl")).toBe(
			true,
		);
		expect(await uranNclImageFormat.detect(sourceOf(file), "CG01.NCL")).toBe(
			true,
		);
		expect(await uranNclImageFormat.detect(sourceOf(file), "CG01.bmp")).toBe(
			false,
		);
		expect(
			await uranNclImageFormat.detect(
				sourceOf(buildNclFile({ name: "GRAPHIC.PNG" })),
				"CG01.ncl",
			),
		).toBe(false);
		// The stored path decides, and a name of no length names nothing.
		expect(
			await uranNclImageFormat.detect(
				sourceOf(buildNclFile({ name: "" })),
				"CG01.ncl",
			),
		).toBe(false);
		// The packed data has to fit behind the header that describes it.
		expect(
			await uranNclImageFormat.detect(
				sourceOf(buildNclFile({ declaredSize: 0x4000 })),
				"CG01.ncl",
			),
		).toBe(false);
		expect(
			await uranNclImageFormat.detect(
				sourceOf(buildNclFile().subarray(0, 20)),
				"CG01.ncl",
			),
		).toBe(false);
	});

	it("hands back the bitmap the file holds", async () => {
		const file = buildNclFile();
		const archive = await uranNclImageFormat.open(sourceOf(file), "CG01.ncl");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			// The measurements are the ones the file's own header carries.
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 4,
				height: 2,
				bitsPerPixel: 8,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "deflate",
				width: 4,
				height: 2,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(8);
		expect(bmp.readInt32LE(18)).toBe(4);
		expect(bmp.readInt32LE(22)).toBe(-2);
		// The rows of a four pixel bitmap are padded out to four bytes, which is where its pixels begin.
		expect(bmp.subarray(54 + 1024, 54 + 1024 + 8)).toEqual(
			Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
		);
		// The colour map comes through untouched.
		expect(bmp.subarray(54, 54 + 8)).toEqual(
			Buffer.from([0xff, 0x00, 0x00, 0x00, 0xfe, 0x01, 0x01, 0x00]),
		);
	});

	it("unpacks the bitmap when the file says it is deflated", async () => {
		const bmp = await extract(buildNclFile({ method: 2 }));
		expect(bmp.readUInt16LE(28)).toBe(8);
		expect(bmp.subarray(54 + 1024, 54 + 1024 + 8)).toEqual(
			Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]),
		);
	});

	it("hands back a bitmap of another depth as it found it", async () => {
		const pixels = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		const bmp = await extract(
			buildNclFile({
				width: 2,
				height: 1,
				bitmap: writeBmp24(2, 1, pixels),
				method: 2,
			}),
		);
		expect(bmp.readUInt16LE(28)).toBe(24);
		expect(bmp.subarray(54, 54 + 6)).toEqual(pixels);
	});

	it("keeps the masks of a sixteen bit bitmap", async () => {
		const pixels = Buffer.from([0x1f, 0x00, 0xe0, 0x03]);
		const bmp = await extract(
			buildNclFile({
				width: 2,
				height: 1,
				bitmap: writeBmp16(2, 1, pixels),
			}),
		);
		expect(bmp.readUInt16LE(28)).toBe(16);
		expect(bmp.readUInt32LE(54)).toBe(0x7c00);
		expect(bmp.subarray(66, 70)).toEqual(pixels);
	});

	it("refuses data that was not packed with its own key", async () => {
		const file = buildNclFile({ key: KEY + 1 });
		await expect(extract(file)).rejects.toThrow(GarbroError);
		await expect(extract(file)).rejects.toThrow(
			"Uran NCL image holds no bitmap",
		);
	});

	it("refuses a bitmap that stands where the method byte belongs", async () => {
		// The reference reads one byte before the bitmap whatever that byte turns out to be.
		const bitmap = writeBmp8Palette(
			1,
			1,
			Buffer.from([0]),
			Buffer.alloc(256 * 4),
		);
		const file = buildNclFile({
			width: 1,
			height: 1,
			body: bitmap,
		});
		await expect(extract(file)).rejects.toThrow(
			"Uran NCL image holds no bitmap",
		);
	});

	it("refuses a deflate stream it cannot unpack", async () => {
		const file = buildNclFile({
			body: Buffer.concat([
				Buffer.from([2]),
				Buffer.from("not a deflate stream at all", "latin1"),
			]),
		});
		await expect(extract(file)).rejects.toThrow(GarbroError);
		await expect(extract(file)).rejects.toThrow(
			"Uran NCL image holds no deflate stream",
		);
	});
});
