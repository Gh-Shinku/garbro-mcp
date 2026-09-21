import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readAlbLayout,
	slgAlbImageFormat,
	unpackAlb,
} from "../../packages/formats/src/slg/alb-image.js";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x10;
const BLOCK_TAG = 0x4850;
/** The dictionary a block carries when every entry stands for its own byte. */
const LITERAL_DICTIONARY: Buffer = (() => {
	const dictionary = Buffer.alloc(0x100 * 2, 0x00);
	for (let index = 0; index < 0x100; index += 1) {
		dictionary[index * 2] = index;
	}
	return dictionary;
})();

function blockHead(dictionarySize: number, symbols: number): Buffer {
	const head = Buffer.alloc(4);
	head.writeUInt16LE(BLOCK_TAG, 0);
	head.writeUInt16LE(dictionarySize, 2);
	return Buffer.concat([head, encodeSymbolCount(symbols)]);
}

/** The count of symbols and the two bytes that name the coding are read one after the other. */
function encodeSymbolCount(symbols: number): Buffer {
	const tail = Buffer.alloc(2);
	tail.writeUInt16LE(symbols, 0);
	return tail;
}

/** A block whose dictionary stands for the bytes themselves: the symbols come out as they stand. */
function literalBlock(
	symbols: Buffer,
	dictionary = LITERAL_DICTIONARY,
): Buffer {
	return Buffer.concat([
		blockHead(dictionary.length, symbols.length),
		Buffer.from([0x00, 0x00]),
		dictionary,
		symbols,
	]);
}

/** A block whose dictionary is run length coded: a byte equal to the marker introduces a run of entries that
 * stand for themselves, and every other byte is the first half of an entry with its second behind it. */
function codedBlock(coded: Buffer, symbols: Buffer, marker = 0xff): Buffer {
	return Buffer.concat([
		blockHead(coded.length, symbols.length),
		Buffer.from([0x01, marker]),
		coded,
		symbols,
	]);
}

function albFile(stream: Buffer, declaredSize: number): Buffer {
	const header = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("ALB1", 0, "latin1");
	header.writeInt32LE(declaredSize, 8);
	return Buffer.concat([header, stream]);
}

/** A picture that opens like a PNG of the given size, which is enough for the header to be read off it. */
function pngHead(width: number, height: number): Buffer {
	const head = Buffer.alloc(0x30, 0x00);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head, 0);
	head.writeUInt32BE(13, 8);
	head.write("IHDR", 12, "latin1");
	head.writeUInt32BE(width, 16);
	head.writeUInt32BE(height, 20);
	head[24] = 8;
	head[25] = 2;
	return head;
}

function ddsHead(width: number, height: number): Buffer {
	const head = Buffer.alloc(0x80, 0x00);
	head.write("DDS ", 0, "latin1");
	head.writeInt32LE(124, 4);
	head.writeUInt32LE(height, 0x10);
	head.writeUInt32LE(width, 0x14);
	return head;
}

function jpegHead(): Buffer {
	return Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
}

function layoutOf(file: Buffer) {
	const layout = readAlbLayout(file);
	if (!layout) throw new Error("the fixture does not read as an SLG picture");
	return layout;
}

async function entryOf(file: Buffer): Promise<{ path: string; size: bigint }> {
	const archive = await slgAlbImageFormat.open(
		new BufferByteSource(file),
		"face.alb",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("the picture has no entry");
		return { path: entry.path, size: entry.size };
	} finally {
		await archive.close();
	}
}

describe("SLG system ALB image", () => {
	it("unwraps a picture whose dictionary stands for its own bytes", async () => {
		const picture = pngHead(3, 2);
		const file = albFile(literalBlock(picture), picture.length);
		const layout = layoutOf(file);
		expect(layout.kind).toBe("png");
		expect(layout.unpackedSize).toBe(picture.length);
		expect(unpackAlb(file.subarray(HEADER_SIZE), picture.length)).toEqual(
			picture,
		);
		expect(await entryOf(file)).toEqual({
			path: "face.png",
			size: BigInt(picture.length),
		});
	});

	it("reports the header of the picture it unwrapped", async () => {
		const picture = pngHead(0x123, 0x45);
		const file = albFile(literalBlock(picture), picture.length);
		const archive = await slgAlbImageFormat.open(
			new BufferByteSource(file),
			"face.alb",
		);
		try {
			expect(archive.metadata).toMatchObject({
				image: "png",
				width: 0x123,
				height: 0x45,
				bitsPerPixel: 24,
				unpackedSize: picture.length,
			});
			const chunks: Buffer[] = [];
			const entry = archive.entries[0];
			if (!entry) throw new Error("the picture has no entry");
			for await (const chunk of await archive.openEntry(entry.id)) {
				chunks.push(Buffer.from(chunk as Uint8Array));
			}
			expect(Buffer.concat(chunks)).toEqual(picture);
		} finally {
			await archive.close();
		}
	});

	it("unwraps a stream of several blocks one behind the other", () => {
		const first = pngHead(2, 2);
		const second = Buffer.from([9, 8, 7]);
		const file = albFile(
			Buffer.concat([literalBlock(first), literalBlock(second)]),
			first.length + second.length,
		);
		expect(unpackAlb(file.subarray(HEADER_SIZE), first.length + 3)).toEqual(
			Buffer.concat([first, second]),
		);
	});

	it("expands the entries of a dictionary that stand for more than themselves", () => {
		// The entry of one byte stands for two others, and one of those two for two more, so the walk comes
		// out depth first: the two of the inner pair, then the second of the outer one.
		const dictionary = Buffer.from(LITERAL_DICTIONARY);
		dictionary[0x41 * 2] = 0x42;
		dictionary[0x41 * 2 + 1] = 0x43;
		dictionary[0x42 * 2] = 0x44;
		dictionary[0x42 * 2 + 1] = 0x45;
		const file = albFile(literalBlock(Buffer.from([0x41]), dictionary), 4);
		expect(unpackAlb(file.subarray(HEADER_SIZE), 4)).toEqual(
			Buffer.from([0x44, 0x45, 0x43]),
		);
	});

	it("reads a dictionary that is run length coded", () => {
		// Ten entries that stand for themselves, then one that stands for two bytes, whose symbol is the
		// eleventh entry, and then the rest of the table as one more run.
		const coded = Buffer.concat([
			Buffer.from([0xff, 0x0a]),
			Buffer.from([0x41, 0x42]),
			Buffer.from([0xff, 0xf5]),
		]);
		const file = albFile(codedBlock(coded, Buffer.from([0x0a])), 2);
		expect(unpackAlb(file.subarray(HEADER_SIZE), 2)).toEqual(
			Buffer.from([0x41, 0x42]),
		);
	});

	it("hands each kind of picture over with the name of its own", async () => {
		const dds = ddsHead(4, 5);
		const ddsFile = albFile(literalBlock(dds), dds.length);
		expect(layoutOf(ddsFile).kind).toBe("dds");
		expect(await entryOf(ddsFile)).toEqual({
			path: "face.dds",
			size: BigInt(dds.length),
		});
		const jpeg = jpegHead();
		const jpegFile = albFile(literalBlock(jpeg), jpeg.length);
		expect(layoutOf(jpegFile).kind).toBe("jpeg");
		expect(await entryOf(jpegFile)).toEqual({
			path: "face.jpg",
			size: BigInt(jpeg.length),
		});
	});

	it("lists the picture as one entry of its own kind", async () => {
		const picture = pngHead(6, 7);
		const file = albFile(literalBlock(picture), picture.length);
		await expectArchive({
			format: slgAlbImageFormat,
			archive: file,
			sourcePath: "face.alb",
			entries: [{ path: "face.png", size: picture.length }],
			metadata: {
				image: "png",
				width: 6,
				height: 7,
				compressed: true,
			},
		});
	});

	it("turns away a file whose stream is not the one it expects", async () => {
		const good = albFile(literalBlock(pngHead(2, 2)), 0x30);
		const withSize = (value: number): Buffer => {
			const copy = Buffer.from(good);
			copy.writeInt32LE(value, 8);
			return copy;
		};
		expect(
			await slgAlbImageFormat.detect(new BufferByteSource(good), "a.alb"),
		).toBe(true);
		for (const candidate of [
			Buffer.from("ALB2", "latin1"),
			withSize(0),
			withSize(-1),
			withSize(0x7fffffff),
			// A picture of a kind nothing here reads.
			albFile(literalBlock(Buffer.from("ZZZZZZZZ", "latin1")), 8),
			// A block whose tag is not the one a dictionary opens with.
			albFile(
				Buffer.concat([Buffer.from([0x00, 0x00]), literalBlock(pngHead(2, 2))]),
				0x30,
			),
		]) {
			expect(
				await slgAlbImageFormat.detect(
					new BufferByteSource(candidate),
					"a.alb",
				),
			).toBe(false);
		}
	});

	it("refuses a stream that does not hold the picture it declares", () => {
		const picture = pngHead(2, 2);
		// A dictionary that is cut short.
		const short = albFile(
			Buffer.concat([
				Buffer.from([0x50, 0x48, 0, 1, 0x10, 0]),
				Buffer.alloc(4),
			]),
			picture.length,
		);
		expect(() => unpackAlb(short.subarray(HEADER_SIZE), 0x30)).toThrow(
			GarbroError,
		);
		// A dictionary that runs past itself.
		const runPast = albFile(
			codedBlock(Buffer.from([0xff, 0xff, 0xff, 0xff]), Buffer.alloc(4)),
			4,
		);
		expect(() => unpackAlb(runPast.subarray(HEADER_SIZE), 4)).toThrow(
			GarbroError,
		);
		// A dictionary that nests deeper than the stack it is expanded on.
		const nesting = Buffer.from(LITERAL_DICTIONARY);
		nesting[0x41 * 2] = 0x42;
		nesting[0x41 * 2 + 1] = 0x43;
		nesting[0x42 * 2] = 0x41;
		nesting[0x42 * 2 + 1] = 0x41;
		const cycle = albFile(literalBlock(Buffer.from([0x41]), nesting), 0x10);
		expect(() => unpackAlb(cycle.subarray(HEADER_SIZE), 0x10)).toThrow(
			GarbroError,
		);
	});

	it("refuses a picture that unfolds to less than it declares", async () => {
		const picture = pngHead(2, 2);
		const file = albFile(literalBlock(picture), picture.length + 8);
		// The head still names the kind of picture, so the file is claimed and only the extraction fails.
		expect(layoutOf(file).kind).toBe("png");
		const archive = await slgAlbImageFormat.open(
			new BufferByteSource(file),
			"face.alb",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("the picture has no entry");
			await expect(archive.openEntry(entry.id)).rejects.toBeInstanceOf(
				GarbroError,
			);
		} finally {
			await archive.close();
		}
	});
});
