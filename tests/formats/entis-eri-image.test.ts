// The Entis rasterized picture port, against pictures built in the test: the head of a picture of the
// engine (the word of the format, the identifier of the kind of it and the name of it) and the sections of
// the head of it (`FileHdr` and `ImageInf`, of the counts of the picture and of the kind of the places of
// it). The head of the picture stands of the same walk as the archives of the engine; the places of the
// picture themselves stand of the walk of the engine itself (`EriReader`, of the places of a picture of the
// kind of the counts of a picture of the engine): the fixture stands of an encoder of the counts of the walk
// of the engine of its own (`tests/helpers/erisa.ts`), of the counts of the walk of the engine of every
// count of a block of the picture one behind the other.
import { Buffer } from "node:buffer";
import { buffer as consume } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { entisEriImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	BLOCK,
	BLOCK_AREA,
	countedPicture,
	frameSection,
	losslessFrame,
} from "../helpers/eri.js";

const HEADER_SIZE = 0x40;
const FIRST_SECTION_END = 0x50;
/** The nested sections need slack, because the reader counts down the section body length. */
const BODY_SIZE = 0x90;
const IMAGE_INFO_SIZE = 0x44;

/** The head of a section: the name of it and the count of the places behind it. */
function sectionHead(id: string, length: number): Buffer {
	const header = Buffer.alloc(0x10);
	header.write(id.padEnd(8, " "), 0, "latin1");
	header.writeBigInt64LE(BigInt(length), 8);
	return header;
}

function section(id: string, body: Buffer): Buffer {
	return Buffer.concat([sectionHead(id, body.length), body]);
}

/** A `FileHdr ` section: the count of the kind of the file and the counts of the frames of it. */
function fileHeaderSection(frameCount: number): Buffer {
	const body = Buffer.alloc(0x14);
	body.writeInt32LE(0x00020100, 0);
	body.writeInt32LE(0, 4);
	body.writeInt32LE(1, 8);
	body.writeInt32LE(frameCount, 0xc);
	body.writeInt32LE(0, 0x10);
	return section("FileHdr ", body);
}

/** An `ImageInf` section: the counts of the picture and the kind of the places of the walk of it. */
function imageInfoSection(
	width: number,
	height: number,
	bpp: number,
	options: {
		version?: number;
		transformation?: number;
		architecture?: number;
		formatType?: number;
		blockingDegree?: number;
	} = {},
): Buffer {
	const body = Buffer.alloc(IMAGE_INFO_SIZE);
	body.writeInt32LE(options.version ?? 0x00020100, 0);
	body.writeInt32LE(options.transformation ?? 0x03020000, 4); // the walk of the places of a colour
	body.writeInt32LE(options.architecture ?? -16, 8); // the walk of the places of the engine
	body.writeInt32LE(options.formatType ?? 0x00010300, 0xc); // the kind of the places of the picture
	body.writeInt32LE(width, 0x10);
	body.writeInt32LE(height, 0x14);
	body.writeInt32LE(bpp, 0x18);
	body.writeInt32LE(0, 0x1c);
	body.writeInt32LE(0, 0x20);
	body.writeBigUInt64LE(0n, 0x24);
	body.writeBigUInt64LE(0n, 0x2c);
	body.writeInt32LE(options.blockingDegree ?? 8, 0x34);
	body.writeInt32LE(0, 0x38);
	body.writeInt32LE(0, 0x3c);
	body.writeInt32LE(0, 0x40);
	return section("ImageInf", body);
}

/** A picture of the engine: the head of it and the sections of the head of the picture. */
function buildPicture(input: {
	sections: Buffer[];
	frames?: Buffer[];
	identifier?: string;
	id?: number;
}): Buffer {
	const body = Buffer.alloc(BODY_SIZE);
	let at = 0;
	for (const part of input.sections) {
		part.copy(body, at);
		at += part.length;
	}
	const head = Buffer.alloc(FIRST_SECTION_END);
	head.write("Enti", 0, "latin1");
	head.writeUInt32LE(input.id ?? 0x03000100, 8);
	head.write(input.identifier ?? "Entis Rasterized Image", 0x10, "latin1");
	// The head of the section of the head of the picture stands at the places of its own, and the places
	// behind it stand behind the places of the head of the file.
	head.set(sectionHead("Header  ", body.length), HEADER_SIZE);
	return Buffer.concat([head, body, ...(input.frames ?? [])]);
}

describe("Entis rasterized image", () => {
	it("reads the head of a picture of the engine", async () => {
		const data = buildPicture({
			sections: [fileHeaderSection(1), imageInfoSection(0x40, 0x30, 8)],
		});
		const source = new BufferByteSource(data);
		expect(await entisEriImageFormat.detect(source, "picture.eri")).toBe(true);
		const archive = await entisEriImageFormat.open(source, "picture.eri");
		try {
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 0x40,
				height: 0x30,
				bitsPerPixel: 8,
				transformation: 0x03020000,
				architecture: -16,
				formatType: 0x00010300,
				frameCount: 1,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			expect(entry.path).toBe("picture.bmp");
			expect(entry.metadata).toMatchObject({
				type: "image",
				width: 0x40,
				height: 0x30,
				bitsPerPixel: 8,
			});
			// The places of the picture stand of the sections of the walk of the engine behind the places of
			// the head of it: a picture of the head alone stands of no place of a picture of the engine at
			// all.
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
			});
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
		} finally {
			await archive.close();
		}
	});

	it("stands of a picture of no place of a frame and of the name of it", async () => {
		// The walk of the head of a picture of the engine stands of the places of the picture of it alone:
		// the reference stands of no place of a frame of the file at all.
		const data = buildPicture({
			sections: [imageInfoSection(2, 3, 32)],
			identifier: "EMSAC-Image",
			id: 0x02000100,
		});
		const source = new BufferByteSource(data);
		expect(await entisEriImageFormat.detect(source, "picture.emi")).toBe(true);
		const archive = await entisEriImageFormat.open(source, "picture.emi");
		try {
			expect(archive.metadata).toMatchObject({
				width: 2,
				height: 3,
				bitsPerPixel: 32,
				frameCount: 0,
			});
			// The name of the picture stands of the name of the file itself, of the places of a bitmap.
			expect(archive.entries[0]?.path).toBe("picture.bmp");
		} finally {
			await archive.close();
		}
	});

	it("stands of the counts of the walk of the engine of the places of a picture of a count of a colour", async () => {
		// The places of a picture of the engine stand of the counts of the walk of the engine itself: every
		// place of the count of the walk of the picture stands of the counts of the walk of the engine of
		// every place of the count of the walk of the engine of the picture in front of it, of the places of
		// the picture of the count of the walk of the engine of no name at all at all.
		const block = Array.from(
			{ length: BLOCK_AREA },
			(_, at) => (at * 7) & 0xff,
		);
		const counted = countedPicture([block], BLOCK, BLOCK, 1);
		const data = buildPicture({
			sections: [
				fileHeaderSection(1),
				imageInfoSection(BLOCK, BLOCK, 8, {
					architecture: -4,
					formatType: 0x00000002,
					blockingDegree: 3,
				}),
			],
			frames: [frameSection(losslessFrame({ blocks: [block] }))],
		});
		const source = new BufferByteSource(data);
		expect(await entisEriImageFormat.detect(source, "picture.eri")).toBe(true);
		const archive = await entisEriImageFormat.open(source, "picture.eri");
		let bitmap: Buffer;
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			bitmap = await consume(await archive.openEntry(entry.id));
		} finally {
			await archive.close();
		}
		const image = readBmpImage(bitmap);
		if (!image) throw new Error("no bitmap of the walk");
		expect(image).toMatchObject({
			width: BLOCK,
			height: BLOCK,
			bitsPerPixel: 8,
		});
		expect([...image.pixels]).toEqual(counted[0]);
		// The counts of the walk of the engine of the places of the picture of two counts of a block of the
		// engine of their own stand of the counts of the walk of the engine of the count of the walk of the
		// picture in front of them as well.
		const lower = Array.from(
			{ length: BLOCK_AREA },
			(_, at) => (at * 5 + 1) & 0xff,
		);
		const upper = Array.from(
			{ length: BLOCK_AREA },
			(_, at) => (at * 3 + 2) & 0xff,
		);
		const two = countedPicture([lower, upper], BLOCK, BLOCK * 2, 1);
		const tall = buildPicture({
			sections: [
				fileHeaderSection(1),
				imageInfoSection(BLOCK, BLOCK * 2, 8, {
					architecture: -4,
					formatType: 0x00000002,
					blockingDegree: 3,
				}),
			],
			frames: [frameSection(losslessFrame({ blocks: [lower, upper] }))],
		});
		const tallSource = new BufferByteSource(tall);
		const tallArchive = await entisEriImageFormat.open(tallSource, "tall.eri");
		try {
			const entry = tallArchive.entries[0];
			if (!entry) throw new Error("no entry");
			const image2 = readBmpImage(
				await consume(await tallArchive.openEntry(entry.id)),
			);
			if (!image2) throw new Error("no bitmap of the walk");
			expect(image2.height).toBe(BLOCK * 2);
			expect([...image2.pixels]).toEqual(two[0]);
		} finally {
			await tallArchive.close();
		}
	});

	it("stands of the counts of the walk of the engine of the places of a picture of three counts of a colour", async () => {
		// A picture of the counts of the walk of the engine of three counts of a colour and up stands of the
		// counts of the walk of the engine of the places of the count of a block of the picture of its own
		// (`GetHuffmanCode`, of the tree of the counts of the walk of it): the counts of the walk of the
		// engine of the three counts of a colour stand of the counts of the walk of the engine of the count
		// of the walk of the picture of their own.
		const block = Array.from(
			{ length: BLOCK_AREA * 3 },
			(_, at) => (at * 11) & 0xff,
		);
		const counted = countedPicture([block], BLOCK, BLOCK, 3);
		const data = buildPicture({
			sections: [
				fileHeaderSection(1),
				imageInfoSection(BLOCK, BLOCK, 24, {
					version: 0x00020200,
					architecture: -4,
					formatType: 0x00000001,
					blockingDegree: 3,
				}),
			],
			frames: [
				frameSection(losslessFrame({ blocks: [block], operationTree: true })),
			],
		});
		const source = new BufferByteSource(data);
		const archive = await entisEriImageFormat.open(source, "picture.eri");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			const image = readBmpImage(
				await consume(await archive.openEntry(entry.id)),
			);
			if (!image) throw new Error("no bitmap of the walk");
			expect(image).toMatchObject({
				width: BLOCK,
				height: BLOCK,
				bitsPerPixel: 24,
			});
			// The places of the count of the walk of the engine of a picture of the engine stand of the
			// counts of the walk of the engine of the places of the count of a colour of the count of the
			// walk of the picture of its own: the count of a colour in front of the places of the count of
			// the walk of the engine of the picture.
			for (let at = 0; at < BLOCK_AREA; at += 1) {
				expect([
					image.pixels[at * 3],
					image.pixels[at * 3 + 1],
					image.pixels[at * 3 + 2],
				]).toEqual([counted[0]?.[at], counted[1]?.[at], counted[2]?.[at]]);
			}
		} finally {
			await archive.close();
		}
	});

	it("stands of the counts of a colour of a picture of one count of a colour", async () => {
		// The counts of a colour of the picture (`Palette `) stand of the counts of the walk of the engine
		// of the picture of one count of a colour, of the counts of a colour of the count of the walk of it.
		const palette = Buffer.from(
			Array.from({ length: 4 * 4 }, (_, at) => (at * 17 + 3) & 0xff),
		);
		const block = Array.from({ length: BLOCK_AREA }, (_, at) => at & 0xff);
		const data = buildPicture({
			sections: [
				fileHeaderSection(1),
				imageInfoSection(BLOCK, BLOCK, 8, {
					architecture: -4,
					formatType: 0x00000001,
					blockingDegree: 3,
				}),
			],
			frames: [
				section("Palette ", palette),
				frameSection(losslessFrame({ blocks: [block] })),
			],
		});
		const source = new BufferByteSource(data);
		const archive = await entisEriImageFormat.open(source, "picture.eri");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			const image = readBmpImage(
				await consume(await archive.openEntry(entry.id)),
			);
			if (!image) throw new Error("no bitmap of the walk");
			expect(image.bitsPerPixel).toBe(8);
			expect([...image.palette.subarray(0, palette.length)]).toEqual([
				...palette,
			]);
		} finally {
			await archive.close();
		}
	});

	it("stands of the counts of the walk of the engine of the places of a picture of no count of the walk of it", async () => {
		// The counts of the walk of the engine of the places of a picture of a count of sixteen places of a
		// colour and of the kinds 2 and 4 of the walk of the engine stand of no count of the walk of the
		// engine of this port at all, of the counts of the walk of the engine of the reference as well.
		const block = Array.from({ length: BLOCK_AREA }, (_, at) => at & 0xff);
		const pictures: [string, Buffer][] = [
			[
				"a count of sixteen places of a colour",
				buildPicture({
					sections: [
						fileHeaderSection(1),
						imageInfoSection(BLOCK, BLOCK, 16, {
							architecture: -4,
							formatType: 0x00000001,
							blockingDegree: 3,
						}),
					],
					frames: [frameSection(Buffer.alloc(4))],
				}),
			],
			[
				"the kind 2 of the walk of the places of it",
				buildPicture({
					sections: [
						fileHeaderSection(1),
						imageInfoSection(BLOCK, BLOCK, 8, {
							architecture: -4,
							formatType: 0x00000002,
							blockingDegree: 3,
						}),
					],
					frames: [
						frameSection(losslessFrame({ blocks: [block], walkVersion: 2 })),
					],
				}),
			],
			[
				"the kind 4 of the walk of the places of it",
				buildPicture({
					sections: [
						fileHeaderSection(1),
						imageInfoSection(BLOCK, BLOCK, 8, {
							architecture: -4,
							formatType: 0x00000002,
							blockingDegree: 3,
						}),
					],
					frames: [
						frameSection(losslessFrame({ blocks: [block], walkVersion: 4 })),
					],
				}),
			],
			[
				"the walks of the counts of a picture of the engine",
				buildPicture({
					sections: [
						fileHeaderSection(1),
						imageInfoSection(BLOCK, BLOCK, 24, {
							transformation: 0x00000005,
							architecture: -4,
							formatType: 0x00000001,
							blockingDegree: 3,
						}),
					],
					frames: [frameSection(Buffer.alloc(4))],
				}),
			],
			[
				"the counts of the walk of the engine of the kind `ArithmeticCode`",
				buildPicture({
					sections: [
						fileHeaderSection(1),
						imageInfoSection(BLOCK, BLOCK, 8, {
							architecture: 32,
							formatType: 0x00000002,
							blockingDegree: 3,
						}),
					],
					frames: [frameSection(Buffer.alloc(4))],
				}),
			],
		];
		for (const [name, data] of pictures) {
			const source = new BufferByteSource(data);
			const archive = await entisEriImageFormat.open(source, "picture.eri");
			try {
				const entry = archive.entries[0];
				if (!entry) throw new Error("no entry");
				const failure = await archive.openEntry(entry.id).then(
					() => undefined,
					(error: unknown) => error,
				);
				expect(failure, name).toMatchObject({ code: "UNSUPPORTED_FEATURE" });
			} finally {
				await archive.close();
			}
		}
		// A picture of the counts of the walk of the engine of the count of the walk of the picture of no
		// count of the walk of it at all stands of no picture of this engine: the counts of the walk of the
		// engine of the count of the walk of the sound of the engine itself stand of the counts of the walk
		// of the engine of the head of the picture, of no place of the walk of the picture at all.
		const broken = buildPicture({
			sections: [
				fileHeaderSection(1),
				imageInfoSection(BLOCK, BLOCK, 8, {
					architecture: -4,
					formatType: 0x00000002,
					blockingDegree: 3,
				}),
			],
			frames: [frameSection(losslessFrame({ blocks: [block], opTable: 1 }))],
		});
		const brokenSource = new BufferByteSource(broken);
		const brokenArchive = await entisEriImageFormat.open(
			brokenSource,
			"picture.eri",
		);
		try {
			const entry = brokenArchive.entries[0];
			if (!entry) throw new Error("no entry");
			const failure = await brokenArchive.openEntry(entry.id).then(
				() => undefined,
				(error: unknown) => error,
			);
			expect(failure).toBeInstanceOf(GarbroError);
			expect(failure).toMatchObject({ code: "INVALID_ARCHIVE" });
		} finally {
			await brokenArchive.close();
		}
	});

	it("turns away a name of another kind and a count of another kind", async () => {
		const other = buildPicture({
			sections: [imageInfoSection(2, 3, 32)],
			identifier: "Another Image",
		});
		expect(
			await entisEriImageFormat.detect(
				new BufferByteSource(other),
				"other.eri",
			),
		).toBe(false);
		const wrongId = buildPicture({
			sections: [imageInfoSection(2, 3, 32)],
			id: 0x01000100,
		});
		expect(
			await entisEriImageFormat.detect(
				new BufferByteSource(wrongId),
				"wrong.eri",
			),
		).toBe(false);
		// A file that stands of no section of a picture at all stands of no picture of this engine.
		const bare = Buffer.alloc(FIRST_SECTION_END);
		bare.write("Enti", 0, "latin1");
		bare.writeUInt32LE(0x03000100, 8);
		bare.write("Entis Rasterized Image", 0x10, "latin1");
		expect(
			await entisEriImageFormat.detect(new BufferByteSource(bare), "bare.eri"),
		).toBe(false);
	});
});
