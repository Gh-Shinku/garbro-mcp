import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { discoveryDatFormat } from "../../packages/formats/src/discovery/dat.js";
import { literalLzssStream } from "../helpers/lzss.js";

const WORD_SEED = 13;
const BYTE_SEED = 7;

/** The source bit position of every destination bit of `Descramble32`, derived from the reference. */
function wordPermutation(seed: number): number[] {
	const bits = Array.from({ length: 32 }, (_, index) => index);
	const first = bits[0] ?? 0;
	let walk = 0;
	for (let step = 0; step < 31; step += 1) {
		let shift = walk - seed;
		if (shift < 0) shift += ((31 - shift) >> 5) * 32;
		bits[walk] = bits[shift] ?? 0;
		walk = shift;
	}
	bits[walk] = first;
	return bits;
}

/** The source byte position of every destination byte of `Descramble8`. */
function bytePermutation(length: number, seed: number): number[] {
	const indexes = Array.from({ length }, (_, index) => index);
	const first = indexes[0] ?? 0;
	let x = 0;
	let i = 0;
	for (let count = length - 1; count > 0; count -= 1) {
		i = x - seed;
		while (i < 0) i += length;
		indexes[x] = indexes[i] ?? 0;
		x = i;
	}
	indexes[i] = first;
	return indexes;
}

/** Inverts a permutation given as "destination index holds source index". */
function invert(permutation: number[]): number[] {
	const output: number[] = new Array(permutation.length).fill(0);
	for (const [destination, source] of permutation.entries())
		output[source] = destination;
	return output;
}

/** Encrypts an index the way the reader expects: mask, byte scramble, then word scramble. */
function encryptIndex(plain: Buffer): Buffer {
	const masked = Buffer.from(plain);
	for (let index = 0; index < masked.length; index += 1)
		masked[index] = (masked[index] ?? 0) ^ 0xd6;
	const bytes = invert(bytePermutation(masked.length, BYTE_SEED));
	const gatheredBytes = Buffer.from(masked);
	for (const [destination, source] of bytes.entries())
		masked[destination] = gatheredBytes[source] ?? 0;
	const words = invert(wordPermutation(WORD_SEED));
	const output = Buffer.from(masked);
	for (let position = 0; position + 4 <= output.length; position += 4) {
		const value = output.readUInt32LE(position);
		let gathered = 0;
		for (let bit = 0; bit < 32; bit += 1) {
			const source = words[bit] ?? 0;
			gathered = (gathered | (((value >>> source) & 1) << bit)) >>> 0;
		}
		output.writeUInt32LE(gathered >>> 0, position);
	}
	return output;
}

interface DiscoveryIndexEntry {
	name: string;
	/** Stored size for bdata, header plus body for edata, plain size for vdata. */
	size: number;
	offset: number;
	unpackedSize?: number;
	bodySize?: number;
	bodyUnpacked?: number;
	bodyOffset?: number;
	headerSize?: number;
	headerUnpacked?: number;
	/** The counts of a picture of a bdata entry. */
	width?: number;
	height?: number;
	bpp?: number;
	isMask?: boolean;
	colors?: number;
	extra?: number;
}

/**
 * Builds a Discovery archive: every payload is placed at the absolute offset its record declares, and
 * the encrypted index plus the little endian count follow them at the end of the file.
 */
function buildDiscovery(
	kind: "bdata" | "edata" | "vdata",
	entries: DiscoveryIndexEntry[],
	payloads: { offset: number; data: Buffer }[] = [],
): Buffer {
	const headerSize = kind === "bdata" ? 0x3c : kind === "edata" ? 0x2c : 0x20;
	const nameOffset = kind === "bdata" ? 0x18 : kind === "edata" ? 0x1c : 0x10;
	const records = entries.map((entry) => {
		const record = Buffer.alloc(headerSize);
		const name = Buffer.from(entry.name, "latin1");
		record[0] = name.length;
		name.copy(record, nameOffset);
		if (kind === "bdata") {
			record[1] = entry.bpp ?? 8;
			record[2] = entry.isMask ? 1 : 0;
			record.writeUInt32LE(entry.size, 4);
			record.writeUInt32LE(entry.unpackedSize ?? entry.size, 8);
			record.writeUInt32LE(entry.offset, 0xc);
			record.writeUInt32LE(entry.width ?? 0, 0x10);
			record.writeUInt32LE(entry.height ?? 0, 0x14);
			record.writeUInt16LE(entry.extra ?? 0, 0x28);
			record.writeUInt16LE(entry.colors ?? 0, 0x2a);
		} else if (kind === "edata") {
			record.writeUInt32LE(entry.bodySize ?? 0, 4);
			record.writeUInt32LE(entry.bodyUnpacked ?? 0, 8);
			record.writeUInt32LE(entry.bodyOffset ?? 0, 0xc);
			record.writeUInt32LE(entry.headerSize ?? 0, 0x10);
			record.writeUInt32LE(entry.headerUnpacked ?? 0, 0x14);
			record.writeUInt32LE(entry.offset, 0x18);
		} else {
			record.writeUInt32LE(entry.size, 8);
			record.writeUInt32LE(entry.offset, 0xc);
		}
		return record;
	});
	const index = Buffer.concat(records);
	// VData records are masked only; the other schemes scramble the whole index as well.
	const encrypted: Buffer =
		kind === "vdata" ? Buffer.from(index) : encryptIndex(index);
	if (kind === "vdata") {
		for (let position = 0; position < encrypted.length; position += 1)
			encrypted[position] = (encrypted[position] ?? 0) ^ 0xde;
	}
	const count = Buffer.alloc(4);
	count.writeInt32LE(entries.length, 0);
	let indexStart = 0;
	for (const payload of payloads)
		indexStart = Math.max(indexStart, payload.offset + payload.data.length);
	const file = Buffer.alloc(indexStart + encrypted.length + count.length);
	for (const payload of payloads) payload.data.copy(file, payload.offset);
	encrypted.copy(file, indexStart);
	count.copy(file, indexStart + encrypted.length);
	return file;
}

/** A picture of the engine of a bdata entry: the places of its picture, of the counts of its record. */
function buildBDataPicture(
	width: number,
	height: number,
	bpp: number,
	pixels: Buffer,
	options: { isMask?: boolean; colors?: number; colorMap?: Buffer } = {},
): { data: Buffer; colors: number; isMask: boolean } {
	const places = options.isMask || 8 === bpp ? 1 : 3;
	const stride = (width * places + 3) & ~3;
	const rows = Buffer.alloc(stride * height);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(
			rows,
			row * stride,
			row * width * places,
			row * width * places + width * places,
		);
	}
	// The reference stands of the whole of the places of the colour map, and of ten places of the file to a
	// place of a count of the picture and two where the picture stands of such a count.
	const colors = options.colors ?? 0;
	const head = Buffer.alloc(colors * 4);
	(options.colorMap ?? Buffer.alloc(0)).copy(head, 0);
	return {
		data: Buffer.concat([head, rows]),
		colors,
		isMask: options.isMask ?? false,
	};
}

/** A stream of literals alone: one control word of eight places to eight places of the picture. */
function literalLzss(bytes: Buffer): Buffer {
	const words: number[] = [];
	for (let at = 0; at < bytes.length; at += 8) words.push(0xff);
	return Buffer.concat([Buffer.from(words), bytes]);
}

/** The picture a bdata entry stands of, read back through the bitmap walk of this project. */
async function pictureOfEntry(
	file: Buffer,
	path: string,
): Promise<{
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: number[];
	palette: number[];
}> {
	const archive = await discoveryDatFormat.open(sourceOf(file), "BData.dat");
	const entry = archive.entries.find((value) => value.path === path);
	if (!entry) throw new Error(`no entry ${path}`);
	const image = readBmpImage(
		await consumeBuffer(await archive.openEntry(entry.id)),
	);
	if (!image) throw new Error("no bitmap");
	return {
		width: image.width,
		height: image.height,
		bitsPerPixel: image.bitsPerPixel,
		pixels: [...image.pixels],
		palette: [...image.palette],
	};
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("discovery dat", () => {
	it("lists and reads the places of a bdata entry", async () => {
		// Two rows of three pixels of three places of a colour: a row of the file stands of the whole of a word
		// of four places, and the rows of the picture stand of the file turned over.
		const built = buildBDataPicture(
			3,
			2,
			24,
			Buffer.from([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
				0x18, 0x19,
			]),
		);
		const entry = {
			name: "TITLE.BMP",
			size: built.data.length,
			offset: 0x40,
			width: 3,
			height: 2,
			bpp: 24,
		};
		const file = buildDiscovery(
			"bdata",
			[entry],
			[{ offset: 0x40, data: built.data }],
		);
		const source = sourceOf(file);
		expect(await discoveryDatFormat.detect(source, "BData.dat")).toBe(true);
		const archive = await discoveryDatFormat.open(source, "BData.dat");
		try {
			expect(archive.entries.map((value) => value.path)).toEqual(["TITLE.BMP"]);
			expect(archive.entries[0]?.compressed).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				kind: "bdata",
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
		expect(await pictureOfEntry(file, "TITLE.BMP")).toEqual({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
			pixels: [
				0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 1, 2, 3, 4, 5, 6,
				7, 8, 9,
			],
			palette: [],
		});
	});

	it("reads the places of a packed picture of an entry", async () => {
		const built = buildBDataPicture(2, 1, 24, Buffer.from([1, 2, 3, 4, 5, 6]));
		const stored = literalLzss(built.data);
		const entry = {
			name: "PACKED.BMP",
			size: stored.length,
			unpackedSize: built.data.length,
			offset: 0x40,
			width: 2,
			height: 1,
			bpp: 24,
		};
		const file = buildDiscovery(
			"bdata",
			[entry],
			[{ offset: 0x40, data: stored }],
		);
		expect(await pictureOfEntry(file, "PACKED.BMP")).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			pixels: [1, 2, 3, 4, 5, 6],
			palette: [],
		});
	});

	it("reads the places of a picture of one place of a colour, of its colour map", async () => {
		const colorMap = Buffer.from([0, 0, 255, 0, 255, 0, 0, 0]);
		const built = buildBDataPicture(2, 1, 8, Buffer.from([1, 0]), {
			colors: 2,
			colorMap,
		});
		const entry = {
			name: "INDEXED.BMP",
			size: built.data.length,
			offset: 0x40,
			width: 2,
			height: 1,
			bpp: 8,
			colors: 2,
		};
		const file = buildDiscovery(
			"bdata",
			[entry],
			[{ offset: 0x40, data: built.data }],
		);
		const picture = await pictureOfEntry(file, "INDEXED.BMP");
		expect(picture).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 8,
			pixels: [1, 0],
		});
		expect(picture.palette.slice(0, 8)).toEqual([...colorMap]);
	});

	it("reads the places of a picture of a covering place, of the order of the file", async () => {
		// A picture of a covering place stands of `ImageData.Create` rather than of `CreateFlipped`, so the rows
		// of the file stand in the order of the picture.
		const built = buildBDataPicture(1, 2, 8, Buffer.from([7, 9]), {
			isMask: true,
		});
		const entry = {
			name: "MASK.BMP",
			size: built.data.length,
			offset: 0x40,
			width: 1,
			height: 2,
			bpp: 8,
			isMask: true,
		};
		const file = buildDiscovery(
			"bdata",
			[entry],
			[{ offset: 0x40, data: built.data }],
		);
		expect(await pictureOfEntry(file, "MASK.BMP")).toMatchObject({
			width: 1,
			height: 2,
			bitsPerPixel: 8,
			pixels: [7, 9],
		});
	});

	it("turns away a picture of a count of places of a colour the engine knows not", async () => {
		const built = buildBDataPicture(1, 1, 32, Buffer.alloc(4));
		const entry = {
			name: "WIDE.BMP",
			size: built.data.length,
			offset: 0x40,
			width: 1,
			height: 1,
			bpp: 32,
		};
		const file = buildDiscovery(
			"bdata",
			[entry],
			[{ offset: 0x40, data: built.data }],
		);
		const archive = await discoveryDatFormat.open(sourceOf(file), "BData.dat");
		const value = archive.entries[0];
		if (!value) throw new Error("missing entry");
		await expect(archive.openEntry(value.id)).rejects.toThrow(
			/stands of 32 places of a colour/,
		);
	});

	it("unpacks the header and body of an edata entry", async () => {
		const headerPlain = Buffer.from("HEADER");
		const bodyPlain = Buffer.from("body payload bytes");
		const headerStored = literalLzssStream(headerPlain);
		const bodyStored = literalLzssStream(bodyPlain);
		const payload = Buffer.concat([headerStored, bodyStored]);
		const entry = {
			name: "MUSIC.DAT",
			size: payload.length,
			offset: 0x40,
			headerSize: headerStored.length,
			headerUnpacked: headerPlain.length,
			bodySize: bodyStored.length,
			bodyUnpacked: bodyPlain.length,
			bodyOffset: 0x40 + headerStored.length,
		};
		const file = buildDiscovery(
			"edata",
			[entry],
			[{ offset: 0x40, data: payload }],
		);
		const source = sourceOf(file);
		expect(await discoveryDatFormat.detect(source, "EData.dat")).toBe(true);
		const archive = await discoveryDatFormat.open(source, "EData.dat");
		try {
			const value = archive.entries[0];
			if (!value) throw new Error("missing entry");
			expect(value.compressed).toBe(true);
			expect(value.sizeKnown).toBe(false);
			expect(Number(value.size)).toBe(headerPlain.length + bodyPlain.length);
			expect(await consumeBuffer(await archive.openEntry(value.id))).toEqual(
				Buffer.concat([headerPlain, bodyPlain]),
			);
		} finally {
			await archive.close();
		}
	});

	it("masks and lists a vdata entry", async () => {
		const entry = { name: "VOICE.WAV", size: 4, offset: 0x30 };
		const file = buildDiscovery(
			"vdata",
			[entry],
			[{ offset: 0x30, data: Buffer.from([1, 2, 3, 4]) }],
		);
		const source = sourceOf(file);
		expect(await discoveryDatFormat.detect(source, "VData.dat")).toBe(true);
		const archive = await discoveryDatFormat.open(source, "VData.dat");
		try {
			expect(archive.entries[0]?.path).toBe("VOICE.WAV");
			expect(Number(archive.entries[0]?.size)).toBe(4);
			const value = archive.entries[0];
			if (!value) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(value.id))).toEqual(
				Buffer.from([1, 2, 3, 4]),
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose name does not select a scheme", async () => {
		const file = buildDiscovery("bdata", [
			{ name: "A.BIN", size: 0, offset: 0x3c },
		]);
		expect(await discoveryDatFormat.detect(sourceOf(file), "Other.dat")).toBe(
			false,
		);
	});

	it("declines an insane entry count", async () => {
		const file = buildDiscovery("bdata", [
			{ name: "A.BIN", size: 0, offset: 0x3c },
		]);
		file.writeInt32LE(0x100000, file.length - 4);
		expect(await discoveryDatFormat.detect(sourceOf(file), "BData.dat")).toBe(
			false,
		);
	});

	it("declines a name that runs past the record", async () => {
		const file = buildDiscovery("bdata", [
			{ name: "A.BIN", size: 0, offset: 0x3c },
		]);
		const record = Buffer.from(file.subarray(0, 0x3c));
		record[0] = 0x30;
		encryptIndex(record).copy(file, 0);
		expect(await discoveryDatFormat.detect(sourceOf(file), "BData.dat")).toBe(
			false,
		);
	});

	it("declines an entry that does not fit in the file", async () => {
		const file = buildDiscovery("bdata", [
			{ name: "A.BIN", size: 0x1000, offset: 0x3c },
		]);
		expect(await discoveryDatFormat.detect(sourceOf(file), "BData.dat")).toBe(
			false,
		);
	});
});
