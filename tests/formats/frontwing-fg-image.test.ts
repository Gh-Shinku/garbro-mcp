import { Buffer } from "node:buffer";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { afterEach, describe, expect, it } from "vitest";
import {
	readBmpImage,
	writeBmp24,
} from "../../packages/formats/src/shared/bmp.js";
import { GREY_JPEG, GREY_PIXELS } from "../helpers/jpeg.js";
import { pngFile } from "../helpers/png.js";
import {
	assembleFwei,
	frontWingFweiImageFormat,
	frontWingFwgiImageFormat,
	readFwgiLayout,
} from "../../packages/formats/src/frontwing/fg-image.js";

const temporaryDirectories: string[] = [];

afterEach(async () => {
	await Promise.all(
		temporaryDirectories
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

/** The bitmap an older kind of FrontWing picture points at. */
const BITMAP = writeBmp24(
	2,
	1,
	Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
);

/** A FrontWing picture of the older kind: the head and the bitmap it points at. */
function fwgiFile(bitmap: Buffer = BITMAP): Buffer {
	const head = Buffer.alloc(0x1b0, 0x00);
	Buffer.from("FWGI", "latin1").copy(head, 0);
	head.writeInt32LE(1, 4);
	head.writeInt32LE(3, 0x0c);
	head.writeInt32LE(4, 0x10);
	head.writeUInt32LE(2, 0x1c);
	head.writeUInt32LE(1, 0x20);
	// The place of the bitmap stands four bytes before where it really is.
	head.writeUInt32LE(0x1b0 - 4, 0x128);
	head.writeUInt32LE(bitmap.length, 0x12c);
	return Buffer.concat([head, bitmap]);
}

/** The companion of the encoded kind: two pieces of the stream and a word that says whether it is packed. */
function fgeFile(input: {
	chunk1: Buffer;
	chunk2Offset: number;
	chunk2: Buffer;
	compressed: boolean;
}): Buffer {
	const fge = Buffer.alloc(0x818, 0x00);
	fge.writeInt32LE(input.chunk1.length, 0);
	input.chunk1.copy(fge, 4);
	fge.writeInt32LE(input.chunk2Offset, 0x404);
	fge.writeInt32LE(input.chunk2.length, 0x408);
	input.chunk2.copy(fge, 0x40c);
	fge.writeInt32LE(input.compressed ? 1 : 0, 0x810);
	return fge;
}

/**
 * An encoded picture and its companion, laid out so that both wear the same stream: the companion holds the
 * first piece and the last, the file itself holds the middle from its fifth byte.
 */
function fweiPair(stream: Buffer, compressed: boolean) {
	const packed = compressed ? deflateSync(stream) : stream;
	const first = Math.floor(packed.length / 3);
	const second = Math.floor((2 * packed.length) / 3);
	const head = Buffer.alloc(5, 0x00);
	Buffer.from("FWEI", "latin1").copy(head, 0);
	const fge = fgeFile({
		chunk1: packed.subarray(0, first),
		chunk2Offset: second,
		chunk2: packed.subarray(second),
		compressed,
	});
	return {
		fge,
		fg: Buffer.concat([head, packed.subarray(first, second)]),
	};
}

async function extract(
	format: typeof frontWingFwgiImageFormat,
	data: Buffer,
	sourcePath = "pic.fwgi",
): Promise<Buffer> {
	const handle = await format.open(new BufferByteSource(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("FrontWing image", () => {
	it("reads the head as the reference does", () => {
		const data = fwgiFile();
		expect(readFwgiLayout(data)).toEqual({
			width: 2,
			height: 1,
			offsetX: 3,
			offsetY: 4,
			dataOffset: 0x1b0,
			dataLength: BITMAP.length,
		});
	});

	it("gates on the word, the version and the places", () => {
		const good = fwgiFile();
		expect(readFwgiLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("FWGJ", 0, "latin1");
		expect(readFwgiLayout(mark)).toBeUndefined();
		const version = Buffer.from(good);
		version.writeInt32LE(2, 4);
		expect(readFwgiLayout(version)).toBeUndefined();
		const width = Buffer.from(good);
		width.writeUInt32LE(0, 0x1c);
		expect(readFwgiLayout(width)).toBeUndefined();
		// The bitmap has to stand inside the file.
		const short = Buffer.from(good);
		short.writeUInt32LE(0x1000, 0x12c);
		expect(readFwgiLayout(short)).toBeUndefined();
	});

	it("hands the bitmap the head points at on", async () => {
		const out = await extract(frontWingFwgiImageFormat, fwgiFile());
		expect(out.toString("hex")).toBe(BITMAP.toString("hex"));
	});

	it("reads a picture of another kind where the region holds one", async () => {
		// `FweiFormat.OpenImage` hands a region that is no bitmap to the decoder of the platform, which reads
		// whatever kind of picture it holds; this port reads the two kinds those decoders are used for.
		const jpeg = readBmpImage(
			await extract(frontWingFwgiImageFormat, fwgiFile(GREY_JPEG)),
		);
		if (!jpeg) throw new Error("no bitmap");
		expect([jpeg.width, jpeg.height]).toEqual([8, 8]);
		expect([...jpeg.pixels]).toEqual([...GREY_PIXELS]);
		const png = readBmpImage(
			await extract(
				frontWingFwgiImageFormat,
				fwgiFile(
					pngFile({
						width: 2,
						height: 1,
						colourType: 2,
						rows: [[1, 2, 3, 4, 5, 6]],
					}),
				),
			),
		);
		if (!png) throw new Error("no bitmap");
		expect([...png.pixels]).toEqual([3, 2, 1, 6, 5, 4]);
		// A region that is in neither of those kinds of picture stands turned away.
		await expect(
			extract(frontWingFwgiImageFormat, fwgiFile(Buffer.alloc(16, 0x11))),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("assembles the stream of the encoded kind out of its companion", () => {
		const stream = fwgiFile();
		const { fge, fg } = fweiPair(stream, false);
		expect(assembleFwei(fge, fg)?.toString("hex")).toBe(stream.toString("hex"));
		// A companion of the wrong size is refused.
		expect(assembleFwei(Buffer.alloc(0x10), fg)).toBeUndefined();
	});

	it("reads an encoded picture and its companion", async () => {
		const directory = await mkdtemp(
			resolve(tmpdir(), "garbro-frontwing-test-"),
		);
		temporaryDirectories.push(directory);
		const stream = fwgiFile();
		const { fge, fg } = fweiPair(stream, false);
		await writeFile(resolve(directory, "pic.fge"), fge);
		const out = await extract(
			frontWingFweiImageFormat,
			fg,
			resolve(directory, "pic.fg"),
		);
		expect(out.toString("hex")).toBe(BITMAP.toString("hex"));
	});

	it("unfolds an encoded picture the companion says is packed", async () => {
		const directory = await mkdtemp(
			resolve(tmpdir(), "garbro-frontwing-test-"),
		);
		temporaryDirectories.push(directory);
		const stream = fwgiFile();
		const { fge, fg } = fweiPair(stream, true);
		await writeFile(resolve(directory, "pic.fge"), fge);
		const out = await extract(
			frontWingFweiImageFormat,
			fg,
			resolve(directory, "pic.fg"),
		);
		expect(out.toString("hex")).toBe(BITMAP.toString("hex"));
	});

	it("refuses an encoded picture without its companion", async () => {
		const directory = await mkdtemp(
			resolve(tmpdir(), "garbro-frontwing-test-"),
		);
		temporaryDirectories.push(directory);
		const { fg } = fweiPair(fwgiFile(), false);
		const sourcePath = resolve(directory, "pic.fg");
		expect(
			await frontWingFweiImageFormat.detect(
				new BufferByteSource(fg),
				sourcePath,
			),
		).toBe(false);
		// The reference throws rather than passing the file over, and so does this port.
		await expect(
			frontWingFweiImageFormat.open(new BufferByteSource(fg), sourcePath),
		).rejects.toThrow(GarbroError);
		await expect(
			frontWingFweiImageFormat.open(new BufferByteSource(fg), sourcePath),
		).rejects.toThrow("missing the companion file");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = fwgiFile();
		data.write("FWGJ", 0, "latin1");
		await expect(
			frontWingFwgiImageFormat.open(new BufferByteSource(data), "pic.fwgi"),
		).rejects.toThrow("Not a FrontWing picture");
	});
});
