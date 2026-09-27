import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { kaguyaPltFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { expectArchive } from "../helpers/archive.js";

const FIRST_FRAME_OFFSET = 0x16;
const FRAME_HEADER_SIZE = 0x14;

interface Frame {
	width: number;
	height: number;
	depth: number;
	/** Pixels are filled with this byte so frames can be told apart. */
	fill: number;
	/** The places of the file of the frame, in the order the file holds them: the rows stand bottom up. */
	pixels?: Buffer;
}

/** Frames carry a 0x14-byte header giving depth, width and height, then their pixels. */
function buildPlt(frames: readonly Frame[]): {
	archive: Buffer;
	contents: Buffer[];
	firstFrameOffset: number;
} {
	const contents: Buffer[] = [];
	for (const frame of frames) {
		const imageSize = frame.depth * frame.width * frame.height;
		const header = Buffer.alloc(FRAME_HEADER_SIZE);
		header.writeUInt32LE(frame.width, 8);
		header.writeUInt32LE(frame.height, 0x0c);
		header.writeUInt32LE(frame.depth, 0x10);
		const pixels = frame.pixels ?? Buffer.alloc(imageSize, frame.fill);
		if (pixels.length !== imageSize)
			throw new Error("places do not stand of the frame");
		contents.push(Buffer.concat([header, pixels]));
	}
	const body = Buffer.concat(contents);
	const archive = Buffer.alloc(FIRST_FRAME_OFFSET + body.length);
	archive.write("PL00", 0, "ascii");
	archive.writeInt16LE(frames.length, 4);
	body.copy(archive, FIRST_FRAME_OFFSET);
	return { archive, contents, firstFrameOffset: FIRST_FRAME_OFFSET };
}

/** The bitmap a frame of a picture stands of, read back through the matching reader of this project. */
async function placesOfFrame(
	archive: Buffer,
	path: string,
): Promise<{
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: number[];
}> {
	const handle = await kaguyaPltFormat.open(
		new BufferByteSource(archive),
		"anim.plt",
	);
	const entry = handle.entries.find((item) => item.path === path);
	if (!entry) throw new Error(`no frame ${path}`);
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("no bitmap");
	return {
		width: image.width,
		height: image.height,
		bitsPerPixel: image.bitsPerPixel,
		pixels: [...image.pixels],
	};
}

describe("KaGuYa PLT animation resource", () => {
	it("derives frame sizes from the depth, width and height", async () => {
		// Two rows of four pixels of three places of a colour, the last row of the file standing first, and a
		// picture of four places of a colour of two rows of two pixels.
		const rows: number[] = [];
		for (let place = 0; place < 24; place += 1) rows.push(place + 1);
		const { archive, contents } = buildPlt([
			{ width: 4, height: 2, depth: 3, fill: 0, pixels: Buffer.from(rows) },
			{ width: 2, height: 2, depth: 4, fill: 0x22 },
		]);
		const handle = await kaguyaPltFormat.open(
			new BufferByteSource(archive),
			"anim.plt",
		);
		expect(
			handle.entries.map((entry) => ({
				path: entry.path,
				size: entry.size,
			})),
		).toEqual([
			{ path: "anim#00", size: BigInt(contents[0]?.length ?? 0) },
			{ path: "anim#01", size: BigInt(contents[1]?.length ?? 0) },
		]);
		const first = await placesOfFrame(archive, "anim#00");
		expect(first).toMatchObject({
			width: 4,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(first.pixels).toEqual([...rows.slice(12), ...rows.slice(0, 12)]);
		expect(await placesOfFrame(archive, "anim#01")).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			pixels: new Array(16).fill(0x22),
		});
	});

	it("turns away a frame of a count of places of a colour the engine knows not", async () => {
		const { archive } = buildPlt([
			{ width: 2, height: 2, depth: 1, fill: 0x11 },
		]);
		const handle = await kaguyaPltFormat.open(
			new BufferByteSource(archive),
			"anim.plt",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(
			/stands of 1 places of a colour/,
		);
	});

	it("rejects a foreign signature", async () => {
		const { archive } = buildPlt([{ width: 1, height: 1, depth: 1, fill: 0 }]);
		archive.write("PL10", 0, "ascii");
		await expectArchive({
			format: kaguyaPltFormat,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty frame count", async () => {
		const { archive } = buildPlt([{ width: 1, height: 1, depth: 1, fill: 0 }]);
		archive.writeInt16LE(0, 4);
		await expectArchive({
			format: kaguyaPltFormat,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});

	it("rejects a frame that runs past the file", async () => {
		const { archive, firstFrameOffset } = buildPlt([
			{ width: 4, height: 4, depth: 4, fill: 0 },
		]);
		// Widening the first frame's declared width makes its derived span leave the file.
		archive.writeUInt32LE(0x100, firstFrameOffset + 8);
		await expectArchive({
			format: kaguyaPltFormat,
			archive,
			sourcePath: "anim.plt",
			detected: false,
			entries: [],
		});
	});
});
