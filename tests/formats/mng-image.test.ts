import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	mngImageFormat,
	readMngImageLayout,
	readMngPicture,
} from "../../packages/formats/src/mng/mng-image.js";
import { readPngHeaderFields } from "../../packages/formats/src/shared/png.js";

const SIGNATURE = Buffer.from([0x8a, 0x4d, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** A chunk: its length and name in front, its own bytes, and a check word behind. */
function chunk(type: string, body: Buffer): Buffer {
	const head = Buffer.alloc(8, 0x00);
	head.writeUInt32BE(body.length, 0);
	head.write(type, 4, "latin1");
	return Buffer.concat([head, body, Buffer.alloc(4, 0x00)]);
}

function imageHeader(
	width: number,
	height: number,
	depth: number,
	colourType: number,
): Buffer {
	const body = Buffer.alloc(13, 0x00);
	body.writeUInt32BE(width, 0);
	body.writeUInt32BE(height, 4);
	body[8] = depth;
	body[9] = colourType;
	return chunk("IHDR", body);
}

interface MngFixture {
	width: number;
	height: number;
	/** The pictures the file holds, each with the size of its own frame. */
	frames: {
		width: number;
		height: number;
		depth: number;
		colourType: number;
		body: Buffer;
	}[];
	/** A chunk to slip in behind the canvas chunk, which the walk has to step over. */
	filler?: Buffer;
	chunks?: Buffer[];
	dataMarker?: Buffer;
	header?: Buffer;
	endWith?: "MEND" | "IEND" | "none";
}

function mngFile(options: MngFixture): { file: Buffer; frames: number[] } {
	const canvas = Buffer.alloc(28, 0x00);
	canvas.writeUInt32BE(options.width, 0);
	canvas.writeUInt32BE(options.height, 4);
	const parts: Buffer[] = [
		options.dataMarker
			? Buffer.concat([SIGNATURE.subarray(0, 4), options.dataMarker])
			: SIGNATURE,
		options.header ?? chunk("MHDR", canvas),
	];
	if (options.filler) parts.push(options.filler);
	const frames: number[] = [];
	for (const frame of options.frames) {
		frames.push(Buffer.concat(parts).length);
		parts.push(
			imageHeader(frame.width, frame.height, frame.depth, frame.colourType),
		);
		parts.push(chunk("IDAT", frame.body));
		parts.push(chunk("IEND", Buffer.alloc(0)));
	}
	for (const extra of options.chunks ?? []) parts.push(extra);
	if (options.endWith !== "none") {
		parts.push(chunk(options.endWith ?? "MEND", Buffer.alloc(0)));
	}
	return { file: Buffer.concat(parts), frames };
}

function simpleFrames(): MngFixture["frames"] {
	return [
		{
			width: 2,
			height: 3,
			depth: 8,
			colourType: 2,
			body: Buffer.from([1, 2, 3, 4]),
		},
	];
}

async function pictureOf(file: Buffer): Promise<Buffer> {
	const archive = await mngImageFormat.open(
		new BufferByteSource(file),
		"picture.mng",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("the picture has no entry");
		const chunks: Buffer[] = [];
		for await (const chunk of await archive.openEntry(entry.id)) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks);
	} finally {
		await archive.close();
	}
}

describe("MNG image", () => {
	it("names the canvas and finds the first picture's own chunk", () => {
		const { file, frames } = mngFile({
			width: 640,
			height: 480,
			frames: simpleFrames(),
		});
		const layout = readMngImageLayout(file);
		if (!layout) throw new Error("the fixture is not an MNG file");
		expect(layout.width).toBe(640);
		expect(layout.height).toBe(480);
		// The picture's bytes begin at its own chunk's header, as the reference counts them.
		expect(layout.pngOffset).toBe(frames[0]);
	});

	it("hands the first picture over as the PNG it holds", async () => {
		const { file } = mngFile({
			width: 640,
			height: 480,
			frames: simpleFrames(),
		});
		const layout = readMngImageLayout(file);
		if (!layout) throw new Error("the fixture is not an MNG file");
		const picture = readMngPicture(file, layout);
		expect(picture.subarray(0, 8)).toEqual(PNG_SIGNATURE);
		// The picture ends with the chunk that ends it, and carries nothing of the file behind it. The
		// chunk's check word stands behind its name, which is what the reference counts to as well.
		expect(picture.subarray(picture.length - 8, picture.length - 4)).toEqual(
			Buffer.from("IEND", "latin1"),
		);
		const fields = readPngHeaderFields(picture);
		// The frame's own header, which the engine leaves to the decoder beside it.
		expect(fields).toEqual({ width: 2, height: 3, bitsPerPixel: 24 });
		const extracted = await pictureOf(file);
		expect(extracted).toEqual(picture);
	});

	it("steps over the chunks an engine leaves between the canvas and the pictures", () => {
		const { file, frames } = mngFile({
			width: 4,
			height: 4,
			frames: simpleFrames(),
			filler: chunk("DEFI", Buffer.alloc(4, 0x11)),
			chunks: [chunk("BKGD", Buffer.alloc(6, 0x22))],
		});
		const layout = readMngImageLayout(file);
		if (!layout) throw new Error("the fixture is not an MNG file");
		expect(layout.pngOffset).toBe(frames[0]);
	});

	it("takes the first picture and leaves the others behind", () => {
		const frames = simpleFrames();
		frames.push({
			width: 7,
			height: 9,
			depth: 8,
			colourType: 6,
			body: Buffer.from([9, 9, 9]),
		});
		const { file, frames: offsets } = mngFile({
			width: 640,
			height: 480,
			frames,
		});
		const layout = readMngImageLayout(file);
		if (!layout) throw new Error("the fixture is not an MNG file");
		expect(layout.pngOffset).toBe(offsets[0]);
		const picture = readMngPicture(file, layout);
		expect(readPngHeaderFields(picture)).toEqual({
			width: 2,
			height: 3,
			bitsPerPixel: 24,
		});
		// The later picture's own header stands behind the first picture's end.
		expect(picture.includes(Buffer.from("IDAT" + "\u0000", "latin1"))).toBe(
			false,
		);
		expect(picture.length).toBeLessThan(offsets[1] ?? 0);
	});

	it("takes a picture of a file whose walk is bound", () => {
		const { file, frames } = mngFile({
			width: 8,
			height: 8,
			frames: simpleFrames(),
			endWith: "none",
		});
		// A file that stops behind its pictures still names the picture it holds.
		const layout = readMngImageLayout(file);
		expect(layout).toBeDefined();
		expect(layout?.pngOffset).toBe(frames[0]);
	});

	it("refuses a file it cannot read", () => {
		const base = mngFile({
			width: 4,
			height: 4,
			frames: simpleFrames(),
		}).file;
		expect(readMngImageLayout(base)).toBeDefined();
		// The four bytes a PNG carries behind its word.
		expect(
			readMngImageLayout(
				mngFile({
					width: 4,
					height: 4,
					frames: simpleFrames(),
					dataMarker: Buffer.from([0x0d, 0x0a, 0x1a, 0x0b]),
				}).file,
			),
		).toBeUndefined();
		// A first chunk that is not the canvas.
		expect(
			readMngImageLayout(
				mngFile({
					width: 4,
					height: 4,
					frames: simpleFrames(),
					header: chunk("IHDR", Buffer.alloc(13, 0x00)),
				}).file,
			),
		).toBeUndefined();
		// A canvas chunk with nothing in it to name a size.
		expect(
			readMngImageLayout(
				mngFile({
					width: 4,
					height: 4,
					frames: simpleFrames(),
					header: chunk("MHDR", Buffer.alloc(4, 0x00)),
				}).file,
			),
		).toBeUndefined();
		// A canvas of no width.
		expect(
			readMngImageLayout(
				mngFile({ width: 0, height: 4, frames: simpleFrames() }).file,
			),
		).toBeUndefined();
		// A file that ends before any picture begins.
		expect(
			readMngImageLayout(
				mngFile({ width: 4, height: 4, frames: [], endWith: "MEND" }).file,
			),
		).toBeUndefined();
		// A chunk whose length is not to be trusted: the first picture's own chunk, which stands behind
		// the canvas chunk and its check word.
		const canvas = 8 + 8 + 28 + 4;
		const runaway = Buffer.from(base);
		expect(runaway.readInt32BE(canvas)).toBe(13);
		runaway.writeInt32BE(-4, canvas);
		expect(readMngImageLayout(runaway)).toBeUndefined();
		// A file that stops inside a chunk header.
		expect(readMngImageLayout(base.subarray(0, 12))).toBeUndefined();
	});
});
