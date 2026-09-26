// The Entis rasterized picture port, against pictures built in the test: the head of a picture of the
// engine (the word of the format, the identifier of the kind of it and the name of it) and the sections of
// the head of it (`FileHdr` and `ImageInf`, of the counts of the picture and of the kind of the places of
// it). The head of the picture stands of the same walk as the archives of the engine; the places of the
// picture themselves stand of the walks of the engine (`EriReader`), which this port refuses.
import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { entisEriImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

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
function imageInfoSection(width: number, height: number, bpp: number): Buffer {
	const body = Buffer.alloc(IMAGE_INFO_SIZE);
	body.writeInt32LE(0x00020100, 0);
	body.writeInt32LE(0x03020000, 4); // the kind of the walk of the places of a colour
	body.writeInt32LE(-16, 8); // the walk of the places of the engine
	body.writeInt32LE(0x00010300, 0xc); // the kind of the places of the picture
	body.writeInt32LE(width, 0x10);
	body.writeInt32LE(height, 0x14);
	body.writeInt32LE(bpp, 0x18);
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

/** A picture of the engine: the head of it and the sections of the head of the picture. */
function buildPicture(input: {
	sections: Buffer[];
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
	return Buffer.concat([head, body]);
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
			// The places of the picture stand of the walks of the engine, which this port holds no walk of.
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "UNSUPPORTED_FEATURE",
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
