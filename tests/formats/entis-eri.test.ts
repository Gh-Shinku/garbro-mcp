import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { entisEriFormat } from "../../packages/formats/src/entis/eri.js";

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
function imageInfoSection(width: number, height: number): Buffer {
	const body = Buffer.alloc(IMAGE_INFO_SIZE);
	body.writeInt32LE(0x00020100, 0);
	body.writeInt32LE(0x03020000, 4);
	body.writeInt32LE(-16, 8);
	body.writeInt32LE(0x00010300, 0xc);
	body.writeInt32LE(width, 0x10);
	body.writeInt32LE(height, 0x14);
	body.writeInt32LE(8, 0x18);
	body.writeInt32LE(0, 0x1c);
	body.writeInt32LE(0, 0x20);
	body.writeBigUInt64LE(0n, 0x24);
	body.writeBigUInt64LE(0n, 0x2c);
	body.writeInt32LE(8, 0x34);
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
	options: { frameCount?: number; identifier?: string; id?: number } = {},
): Buffer {
	const body = Buffer.alloc(BODY_SIZE);
	fileHeaderSection(options.frameCount ?? frames.length).copy(body, 0);
	imageInfoSection(0x40, 0x30).copy(body, 0x24);
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
	it("lists frames and extracts them verbatim", async () => {
		const first = Buffer.from("first frame bytes");
		const second = Buffer.from("second frame bytes");
		const file = buildEri([
			{ id: "ImageFrm", data: first },
			{ id: "DiffeFrm", data: second },
		]);
		const source = sourceOf(file);
		expect(await entisEriFormat.detect(source, "image.eri")).toBe(true);
		const archive = await entisEriFormat.open(source, "image.eri");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"image#0000",
				"image#0001",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				first.length,
				second.length,
			]);
			expect(archive.entries[1]?.metadata).toMatchObject({
				type: "image",
				isDiff: true,
				frameIndex: 1,
			});
			expect(archive.metadata).toMatchObject({
				entryCount: 2,
				frameCount: 2,
				width: 0x40,
				height: 0x30,
				bpp: 8,
				streamPos: String(FIRST_SECTION_END + BODY_SIZE),
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				first,
			);
		} finally {
			await archive.close();
		}
	});

	it("skips stream and palette records", async () => {
		const frame = Buffer.from("frame with neighbours");
		const file = buildEri([
			// A stream record advances by its header alone, so it holds no payload here.
			{ id: "Stream  ", data: Buffer.alloc(0) },
			{ id: "Palette ", data: Buffer.alloc(0x408) },
			{ id: "ImageFrm", data: frame },
		]);
		const source = sourceOf(file);
		const archive = await entisEriFormat.open(source, "picture.eri");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"picture#0000",
			]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				frame,
			);
		} finally {
			await archive.close();
		}
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
