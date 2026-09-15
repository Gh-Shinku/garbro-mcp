import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { gameresJpegImageFormat } from "../../packages/formats/src/gameres/jpeg-image.js";

interface JpegParts {
	width: number;
	height: number;
	bits: number;
	components: number;
	/** Whether the segment a camera writes first stands in front of the frame. */
	app0?: boolean;
	/** A segment that is not a frame, which the walk has to step over. */
	comment?: boolean;
}

function jpegOf(parts: JpegParts): Buffer {
	const segments: Buffer[] = [Buffer.from([0xff, 0xd8])];
	if (parts.app0 !== false) {
		const app0: Buffer = Buffer.alloc(2 + 2 + 14, 0);
		app0.writeUInt16BE(0xffe0, 0);
		app0.writeUInt16BE(16, 2);
		app0.write("JFIF\0", 4, "latin1");
		segments.push(app0);
	}
	if (parts.comment) {
		const comment: Buffer = Buffer.alloc(2 + 2 + 4, 0);
		comment.writeUInt16BE(0xfffe, 0);
		comment.writeUInt16BE(6, 2);
		comment.write("note", 4, "latin1");
		segments.push(comment);
	}
	// The frame: the marker, its length, the bits a sample, the measurements and the component count.
	const frame: Buffer = Buffer.alloc(2 + 2 + 6 + parts.components * 3, 0);
	frame.writeUInt16BE(0xffc0, 0);
	frame.writeUInt16BE(2 + 6 + parts.components * 3, 2);
	frame[4] = parts.bits;
	frame.writeUInt16BE(parts.height, 5);
	frame.writeUInt16BE(parts.width, 7);
	frame[9] = parts.components;
	segments.push(frame);
	return Buffer.concat(segments);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.jpg"): Promise<Buffer> {
	const handle = await gameresJpegImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("JPEG image file format", () => {
	const picture = jpegOf({
		width: 0x0140,
		height: 0x00f0,
		bits: 8,
		components: 3,
	});

	it("finds a picture behind the word of the format", async () => {
		expect(
			await gameresJpegImageFormat.detect(sourceOf(picture), "cg.jpg"),
		).toBe(true);
		// The reference registers the word of nothing beside it, so a picture that steps over the segment a
		// camera writes first is read as well.
		const bare = jpegOf({
			width: 8,
			height: 8,
			bits: 8,
			components: 3,
			app0: false,
		});
		expect(await gameresJpegImageFormat.detect(sourceOf(bare), "cg.jpg")).toBe(
			true,
		);
		// And one whose walk has to step over a segment that is not a frame.
		const noted = jpegOf({
			width: 8,
			height: 8,
			bits: 8,
			components: 3,
			comment: true,
		});
		expect(await gameresJpegImageFormat.detect(sourceOf(noted), "cg.jpg")).toBe(
			true,
		);
	});

	it("declines a file that does not walk as a picture", async () => {
		expect(
			await gameresJpegImageFormat.detect(sourceOf(Buffer.alloc(64, 0x41))),
		).toBe(false);
		expect(
			await gameresJpegImageFormat.detect(sourceOf(Buffer.from([0xff, 0xd8]))),
		).toBe(false);
		const noFrame: Buffer = Buffer.concat([
			Buffer.from([0xff, 0xd8]),
			Buffer.from([0xff, 0xdb, 0x00, 0x04, 0x00, 0x00]),
		]);
		expect(await gameresJpegImageFormat.detect(sourceOf(noFrame))).toBe(false);
	});

	it("reads the depth as the bits of a sample times the colours of a pixel", async () => {
		const handle = await gameresJpegImageFormat.open(
			sourceOf(picture),
			"dir/cg.jpeg",
		);
		expect(handle.entries[0]?.path).toBe("cg.jpg");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 0x0140,
			height: 0x00f0,
			bitsPerPixel: 24,
		});
		const grey = jpegOf({ width: 5, height: 4, bits: 8, components: 1 });
		const greyHandle = await gameresJpegImageFormat.open(
			sourceOf(grey),
			"cg.jpg",
		);
		expect(greyHandle.entries[0]?.metadata).toMatchObject({
			width: 5,
			height: 4,
			bitsPerPixel: 8,
		});
	});

	it("hands the picture out as it stands", async () => {
		expect(await extract(picture)).toEqual(picture);
	});

	it("refuses a file that is not a picture", async () => {
		await expect(
			extract(Buffer.from([0xff, 0xd8]), "cg.jpg"),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});
});
