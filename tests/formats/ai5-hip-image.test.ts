import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { ai5HipImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("hip\0", "latin1");
const HIZ_SIGNATURE = Buffer.from("hiz\0", "latin1");
const HEADER_SIZE = 0x18;
const DATA_OFFSET = 0x4c;
/** Where the reference reads the picture of a composite file: its own header in front of the plain kind's. */
const COMPOSITE_DATA_OFFSET = DATA_OFFSET + HEADER_SIZE;
const BMP_HEADER_SIZE = 54;
const WIDTH_XOR = 0xaa5a5a5a;
const HEIGHT_XOR = 0xac9326af;
const SIZE_XOR = 0x19739d6a;

/** One control byte per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

/** The header of the plain kind, as it stands inside the region a composite file points at. */
function buildHizHeader(width: number, height: number): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	HIZ_SIGNATURE.copy(header, 0);
	header.writeInt32LE(100, 4);
	header.writeUInt32LE((width ^ WIDTH_XOR) >>> 0, 8);
	header.writeUInt32LE((height ^ HEIGHT_XOR) >>> 0, 0xc);
	header.writeUInt32LE(((width * height * 4) ^ SIZE_XOR) >>> 0, 0x14);
	return header;
}

interface HipOptions {
	width?: number;
	height?: number;
	/** The four planes of the picture, which the reference reads from the file itself. */
	planes?: Buffer;
	/** The first index word, at the offset the reference looks at first. */
	firstOffset?: number;
	/** The second index word, when it is not the one behind the first. */
	secondOffset?: number;
	/** Puts the two index words one word further on, where a file whose first word is nought keeps them. */
	indexAtSecondWord?: boolean;
	/** The region the index words name, when the header inside it is not a picture of the plain kind. */
	region?: Buffer;
	/** The length of the whole file, when a test wants it shorter than the rest of the file would make it. */
	length?: number;
}

function buildHip(options: HipOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const firstOffset = options.firstOffset ?? 0x40;
	const planes = options.planes ?? Buffer.alloc(width * height * 4, 0);
	const region = options.region ?? buildHizHeader(width, height);
	const secondOffset = options.secondOffset ?? firstOffset + 0x60;
	const stream = lzssLiterals(planes);
	const length =
		options.length ??
		Math.max(
			secondOffset,
			firstOffset + region.length,
			COMPOSITE_DATA_OFFSET + stream.length,
		);
	const body: Buffer = Buffer.alloc(length, 0x00);
	SIGNATURE.copy(body, 0);
	if (options.indexAtSecondWord) {
		body.writeUInt32LE(0, 0xc);
		body.writeUInt32LE(firstOffset, 0x10);
		body.writeUInt32LE(secondOffset, 0x14);
	} else {
		body.writeUInt32LE(firstOffset, 0xc);
		body.writeUInt32LE(secondOffset, 0x10);
	}
	// A file whose index words are both nought has no region to speak of, and its header stays whole.
	if (firstOffset >= HEADER_SIZE) {
		if (firstOffset + region.length > body.length) {
			throw new Error("the region of the fixture does not fit in it");
		}
		region.copy(body, firstOffset);
	}
	// A stream of another picture, where a reader that measured from the region would look for this one.
	const decoy = lzssLiterals(Buffer.alloc(width * height * 4, 0x77));
	if (firstOffset + DATA_OFFSET + decoy.length <= body.length) {
		decoy.copy(body, firstOffset + DATA_OFFSET);
	}
	if (COMPOSITE_DATA_OFFSET + stream.length > body.length) {
		throw new Error("the picture of the fixture does not fit in it");
	}
	stream.copy(body, COMPOSITE_DATA_OFFSET);
	return body;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer): Promise<Buffer> {
	const archive = await ai5HipImageFormat.open(sourceOf(file), "CG01.hip");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("elf composite image format (HIP)", () => {
	it("takes its index from the first word, or the one behind it", async () => {
		expect(ai5HipImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(await ai5HipImageFormat.detect(sourceOf(buildHip()), "a.hip")).toBe(
			true,
		);
		// A file whose first word is nought takes its index from the word behind that one.
		expect(
			await ai5HipImageFormat.detect(
				sourceOf(buildHip({ indexAtSecondWord: true })),
				"a.hip",
			),
		).toBe(true);
		expect(
			await ai5HipImageFormat.detect(
				sourceOf(buildHip({ indexAtSecondWord: true, secondOffset: 0 })),
				"a.hip",
			),
		).toBe(true);
		// Both words nought is no index at all.
		expect(
			await ai5HipImageFormat.detect(
				sourceOf(buildHip({ firstOffset: 0, secondOffset: 0 })),
				"a.hip",
			),
		).toBe(false);
		expect(
			await ai5HipImageFormat.detect(
				sourceOf(buildHip({ firstOffset: 0x60, secondOffset: 0x40 })),
				"a.hip",
			),
		).toBe(false);
		// The picture the index points at has to be one of the plain kind.
		expect(
			await ai5HipImageFormat.detect(
				sourceOf(buildHip({ region: Buffer.alloc(HEADER_SIZE, 0x00) })),
				"a.hip",
			),
		).toBe(false);
		expect(
			await ai5HipImageFormat.detect(sourceOf(Buffer.alloc(8, 0)), "a.hip"),
		).toBe(false);
	});

	it("reads its measurements from the region and its pixels from the file", async () => {
		const planes = Buffer.concat([
			Buffer.from([1, 2, 3, 4]),
			Buffer.from([5, 6, 7, 8]),
			Buffer.from([9, 10, 11, 12]),
			Buffer.from([13, 14, 15, 16]),
		]);
		const file = buildHip({ width: 2, height: 2, planes });
		const archive = await ai5HipImageFormat.open(sourceOf(file), "CG01.hip");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
				dataOffset: COMPOSITE_DATA_OFFSET,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(32);
		expect(bmp.readInt32LE(22)).toBe(-2);
		// The planes of the picture the file carries, not the ones the region would name.
		expect(bmp.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 16)).toEqual(
			Buffer.from([1, 5, 9, 13, 2, 6, 10, 14, 3, 7, 11, 15, 4, 8, 12, 16]),
		);
	});

	it("lets the picture run to the end of the file when no second picture follows", async () => {
		// One pixel of four planes: blue, green, red and alpha, one byte each.
		const planes = Buffer.from([0x21, 0x22, 0x23, 0x24]);
		// The region reaches from the first offset to the end of the file, which carries the picture.
		const file = buildHip({ width: 1, height: 1, planes, secondOffset: 0 });
		expect(await ai5HipImageFormat.detect(sourceOf(file), "a.hip")).toBe(true);
		const bmp = await extract(file);
		expect(bmp.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 4)).toEqual(
			Buffer.from([0x21, 0x22, 0x23, 0x24]),
		);
	});

	it("stops when the stream carries less than the whole picture", async () => {
		// The header asks for a picture of four pixels, and the file ends four bytes into its stream.
		const file = buildHip({
			width: 2,
			height: 2,
			planes: Buffer.alloc(0),
			secondOffset: 0x60,
			length: COMPOSITE_DATA_OFFSET + 4,
		});
		const archive = await ai5HipImageFormat.open(sourceOf(file), "CG01.hip");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Unexpected end of file",
			});
		} finally {
			await archive.close();
		}
	});
});
