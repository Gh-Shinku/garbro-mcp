import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { entisEriFormat } from "../../packages/formats/src/entis/eri.js";
import { withCompanionFiles } from "../helpers/companion.js";
import {
	BLOCK,
	BLOCK_AREA,
	countedPicture,
	losslessFrame,
} from "../helpers/eri.js";

const HEADER_SIZE = 0x40;
const FIRST_SECTION_END = 0x50;
/** The nested sections need slack, because the reader counts down the section body length. */
const BODY_SIZE = 0x90;
const IMAGE_INFO_SIZE = 0x44;

function section(id: string, body: Buffer): Buffer {
	const header = Buffer.alloc(0x10);
	header.write(id.padEnd(8, " "), 0, "latin1");
	header.writeBigInt64LE(BigInt(body.length), 8);
	return Buffer.concat([header, body]);
}

/** A `FileHdr ` section with one header per frame. */
function fileHeaderSection(frameCount: number): Buffer {
	const body = Buffer.alloc(0x14);
	body.writeInt32LE(0x00020100, 0);
	body.writeInt32LE(0, 4);
	body.writeInt32LE(1, 8);
	body.writeInt32LE(frameCount, 0xc);
	body.writeInt32LE(0, 0x10);
	return section("FileHdr ", body);
}

/** An `ImageInf` section describing a small palette image. */
function imageInfoSection(
	width: number,
	height: number,
	options: {
		version?: number;
		transformation?: number;
		architecture?: number;
		formatType?: number;
		bpp?: number;
		blockingDegree?: number;
	} = {},
): Buffer {
	const body = Buffer.alloc(IMAGE_INFO_SIZE);
	body.writeInt32LE(options.version ?? 0x00020100, 0);
	body.writeInt32LE(options.transformation ?? 0x03020000, 4);
	body.writeInt32LE(options.architecture ?? -16, 8);
	body.writeInt32LE(options.formatType ?? 0x00010300, 0xc);
	body.writeInt32LE(width, 0x10);
	body.writeInt32LE(height, 0x14);
	body.writeInt32LE(options.bpp ?? 8, 0x18);
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

interface EriFrame {
	id: "ImageFrm" | "DiffeFrm" | "Stream  " | "Palette ";
	data: Buffer;
}

/**
 * Builds an Entis multi-frame image: the fixed header, the metadata section, then the chain of frame
 * sections whose lengths determine the layout.
 */
function buildEri(
	frames: EriFrame[],
	options: {
		frameCount?: number;
		identifier?: string;
		id?: number;
		info?: Parameters<typeof imageInfoSection>[2];
		width?: number;
		height?: number;
		description?: string;
		bodySize?: number;
	} = {},
): Buffer {
	const body = Buffer.alloc(options.bodySize ?? BODY_SIZE);
	fileHeaderSection(options.frameCount ?? frames.length).copy(body, 0);
	imageInfoSection(
		options.width ?? 0x40,
		options.height ?? 0x30,
		options.info,
	).copy(body, 0x24);
	if (options.description !== undefined) {
		section("descript", Buffer.from(options.description, "latin1")).copy(
			body,
			0x78,
		);
	}
	const head = Buffer.alloc(FIRST_SECTION_END);
	head.write("Enti", 0, "latin1");
	head.writeUInt32LE(options.id ?? 0x03000100, 8);
	head.write(options.identifier ?? "Entis Rasterized Image", 0x10, "latin1");
	head.write("Header  ", HEADER_SIZE, "latin1");
	head.writeBigInt64LE(BigInt(body.length), HEADER_SIZE + 8);
	const sections = frames.map((frame) => section(frame.id, frame.data));
	return Buffer.concat([head, body, ...sections]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("entis multi-frame image", () => {
	it("stands of the counts of the walk of the engine of the places of the frames of a picture", async () => {
		// The places of the frames of a picture of the engine stand of the counts of the walk of the engine
		// of the places of the count of the walk of the picture itself (`EriMultiImage.GetFrame`): the
		// places of a frame stand of the counts of the walk of the engine of every place of the count of the
		// walk of it over each other, and the places of a frame behind a frame stand of the places of the
		// frame in front of it as well.
		// The places of a frame behind a frame stand of the places of the frame in front of it where the
		// picture stands of counts of a colour of its own of three places of them and up: the reference
		// stands of a picture of one count of a colour of the counts of the walk of the engine of the count
		// of the walk of the picture of its own at all.
		const first = Array.from(
			{ length: BLOCK_AREA * 3 },
			(_, at) => (at * 7) & 0xff,
		);
		const second = Array.from(
			{ length: BLOCK_AREA * 3 },
			(_, at) => (at * 5 + 3) & 0xff,
		);
		const countedFirst = countedPicture([first], BLOCK, BLOCK, 3);
		const countedSecond = countedPicture([second], BLOCK, BLOCK, 3);
		const file = buildEri(
			[
				{
					id: "ImageFrm",
					data: losslessFrame({ blocks: [first], operationTree: true }),
				},
				{
					id: "DiffeFrm",
					data: losslessFrame({ blocks: [second], operationTree: true }),
				},
			],
			{
				info: {
					version: 0x00020200,
					architecture: -4,
					formatType: 0x00000001,
					bpp: 24,
					blockingDegree: 3,
				},
				width: BLOCK,
				height: BLOCK,
			},
		);
		const source = sourceOf(file);
		expect(await entisEriFormat.detect(source, "image.eri")).toBe(true);
		const archive = await entisEriFormat.open(source, "image.eri");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"image#0000.bmp",
				"image#0001.bmp",
			]);
			expect(archive.metadata).toMatchObject({
				entryCount: 2,
				frameCount: 2,
				width: BLOCK,
				height: BLOCK,
				bpp: 24,
				streamPos: String(FIRST_SECTION_END + BODY_SIZE),
			});
			const [firstEntry, secondEntry] = archive.entries;
			if (!firstEntry || !secondEntry) throw new Error("missing entry");
			const image = readBmpImage(
				await consumeBuffer(await archive.openEntry(firstEntry.id)),
			);
			if (!image) throw new Error("no bitmap of the walk");
			expect(image).toMatchObject({ width: BLOCK, height: BLOCK });
			const planes = countedFirst;
			const countedFrame: number[] = [];
			for (let at = 0; at < BLOCK_AREA; at += 1) {
				for (let place = 0; place < 3; place += 1) {
					countedFrame.push(planes[place]?.[at] ?? 0);
				}
			}
			expect([...image.pixels]).toEqual(countedFrame);
			// The places of the frame behind the frame in front of it stand of the places of the frame in
			// front of them, of the places of the count of the walk of the frame itself.
			const counted: number[] = [];
			for (let at = 0; at < BLOCK_AREA; at += 1) {
				for (let place = 0; place < 3; place += 1) {
					counted.push(
						((countedFirst[place]?.[at] ?? 0) +
							(countedSecond[place]?.[at] ?? 0)) &
							0xff,
					);
				}
			}
			const diff = readBmpImage(
				await consumeBuffer(await archive.openEntry(secondEntry.id)),
			);
			if (!diff) throw new Error("no bitmap of the walk");
			expect([...diff.pixels]).toEqual(counted);
		} finally {
			await archive.close();
		}
	});

	it("skips stream and palette records", async () => {
		// The places of a count of the walk of the engine (`Stream  `) stand of no count of the walk of the
		// engine of their own, and the counts of a colour of the picture (`Palette `) stand of the counts of
		// the walk of the engine of the count of the walk of the picture itself.
		const frame = Array.from(
			{ length: BLOCK_AREA },
			(_, at) => (at * 11) & 0xff,
		);
		const palette = Buffer.from(
			Array.from({ length: 4 * 4 }, (_, at) => (at * 13 + 7) & 0xff),
		);
		const file = buildEri(
			[
				// A stream record advances by its header alone, so it holds no payload here.
				{ id: "Stream  ", data: Buffer.alloc(0) },
				{ id: "Palette ", data: palette },
				{ id: "ImageFrm", data: losslessFrame({ blocks: [frame] }) },
			],
			{
				info: { architecture: -4, formatType: 0x00000002, blockingDegree: 3 },
				width: BLOCK,
				height: BLOCK,
			},
		);
		const source = sourceOf(file);
		const archive = await entisEriFormat.open(source, "picture.eri");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"picture#0000.bmp",
			]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const image = readBmpImage(
				await consumeBuffer(await archive.openEntry(entry.id)),
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

	it("stands of the places of a picture of the engine in front of the places of a picture", async () => {
		// The places of a picture of the engine stand of the counts of the walk of the engine of the places
		// of the picture in front of it (`reference-file`, of the name of the picture of the counts of the
		// walk of the engine of the picture itself): the counts of the walk of the engine of the places of
		// the picture in front of it stand of the counts of the walk of the engine of every count of a
		// colour of the picture itself.
		const frame = Array.from(
			{ length: BLOCK_AREA * 3 },
			(_, at) => (at * 3 + 1) & 0xff,
		);
		const reference = Array.from(
			{ length: BLOCK_AREA * 3 },
			(_, at) => (at * 7 + 5) & 0xff,
		);
		const counted = countedPicture([frame], BLOCK, BLOCK, 3);
		const countedReference = countedPicture([reference], BLOCK, BLOCK, 3);
		const picture = buildEri(
			[
				{
					id: "ImageFrm",
					data: losslessFrame({ blocks: [frame], operationTree: true }),
				},
			],
			{
				info: {
					version: 0x00020200,
					architecture: -4,
					formatType: 0x00000001,
					bpp: 24,
					blockingDegree: 3,
				},
				width: BLOCK,
				height: BLOCK,
				description: "#reference-file\nref.eri\n",
				bodySize: 0xa0,
			},
		);
		const base = buildEri(
			[
				{
					id: "ImageFrm",
					data: losslessFrame({ blocks: [reference], operationTree: true }),
				},
			],
			{
				info: {
					version: 0x00020200,
					architecture: -4,
					formatType: 0x00000001,
					bpp: 24,
					blockingDegree: 3,
				},
				width: BLOCK,
				height: BLOCK,
			},
		);
		await withCompanionFiles(
			"picture.eri",
			{ "picture.eri": picture, "ref.eri": base },
			async (path) => {
				const source = await FileByteSource.open(path);
				const archive = await entisEriFormat.open(source, path);
				try {
					const entry = archive.entries[0];
					if (!entry) throw new Error("missing entry");
					const image = readBmpImage(
						await consumeBuffer(await archive.openEntry(entry.id)),
					);
					if (!image) throw new Error("no bitmap of the walk");
					const expected: number[] = [];
					for (let at = 0; at < BLOCK_AREA; at += 1) {
						for (let place = 0; place < 3; place += 1) {
							expected.push(
								((counted[place]?.[at] ?? 0) +
									(countedReference[place]?.[at] ?? 0)) &
									0xff,
							);
						}
					}
					expect([...image.pixels]).toEqual(expected);
				} finally {
					await archive.close();
				}
			},
		);
	});

	it("stops after the declared frame count", async () => {
		const file = buildEri(
			[
				{ id: "ImageFrm", data: Buffer.from("kept") },
				{ id: "ImageFrm", data: Buffer.from("ignored") },
			],
			{ frameCount: 1 },
		);
		const source = sourceOf(file);
		const archive = await entisEriFormat.open(source, "image.eri");
		try {
			expect(archive.entries.length).toBe(1);
			expect(Number(archive.entries[0]?.size)).toBe(4);
		} finally {
			await archive.close();
		}
	});

	it("declines an unknown identifier", async () => {
		const file = buildEri([{ id: "ImageFrm", data: Buffer.from("x") }], {
			identifier: "Some Other Format....",
		});
		expect(await entisEriFormat.detect(sourceOf(file), "image.eri")).toBe(
			false,
		);
	});

	it("declines an unsupported id word", async () => {
		const file = buildEri([{ id: "ImageFrm", data: Buffer.from("x") }], {
			id: 0x04000100,
		});
		expect(await entisEriFormat.detect(sourceOf(file), "image.eri")).toBe(
			false,
		);
	});

	it("declines a file without frames", async () => {
		const file = buildEri([{ id: "Stream  ", data: Buffer.alloc(0) }], {
			frameCount: 1,
		});
		expect(await entisEriFormat.detect(sourceOf(file), "image.eri")).toBe(
			false,
		);
	});

	it("declines a frame that does not fit in the file", async () => {
		const file = buildEri([{ id: "ImageFrm", data: Buffer.from("x") }]);
		// A frame section whose declared length runs past the end of the file.
		file.writeBigInt64LE(0x10000n, FIRST_SECTION_END + BODY_SIZE + 8);
		expect(await entisEriFormat.detect(sourceOf(file), "image.eri")).toBe(
			false,
		);
	});
});
