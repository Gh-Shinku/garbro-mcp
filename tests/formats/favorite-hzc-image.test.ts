import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	favoriteHzcImageFormat,
	readHzcLayout,
} from "../../packages/formats/src/favorite/hzc-image.js";

const HEADER_SIZE = 0x2c;
/** The compressed stream begins behind the twelve byte block the head size is measured from. */
const STREAM_BASE = 12;
const HEADER_SIZE_FIELD_VALUE = 0x20;

interface HzcOptions {
	type?: number;
	width?: number;
	height?: number;
	offsetX?: number;
	offsetY?: number;
	headerSize?: number;
	tag?: string;
}

/** A file: the head, its own reach and then a zlib stream of the pixels. */
function hzcFile(pixels: Buffer, options: HzcOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 1;
	const head = Buffer.alloc(HEADER_SIZE);
	Buffer.from("hzc1", "latin1").copy(head, 0);
	head.writeInt32LE(pixels.length, 4);
	head.writeInt32LE(options.headerSize ?? HEADER_SIZE_FIELD_VALUE, 8);
	Buffer.from(options.tag ?? "NVSG", "latin1").copy(head, 0x0c);
	head.writeUInt16LE(options.type ?? 0, 0x12);
	head.writeUInt16LE(width, 0x14);
	head.writeUInt16LE(height, 0x16);
	head.writeInt16LE(options.offsetX ?? 0, 0x18);
	head.writeInt16LE(options.offsetY ?? 0, 0x1a);
	const headerSize = options.headerSize ?? HEADER_SIZE_FIELD_VALUE;
	const gap = Buffer.alloc(
		Math.max(0, headerSize - (HEADER_SIZE - STREAM_BASE)),
	);
	return Buffer.concat([head, gap, deflateSync(pixels)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await favoriteHzcImageFormat.open(
		new BufferByteSource(data),
		"pic.hzc",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Favorite View Point picture", () => {
	it("reads the head as the reference does", () => {
		const layout = readHzcLayout(hzcFile(Buffer.alloc(6), {}));
		expect(layout).toEqual({
			width: 2,
			height: 1,
			offsetX: 0,
			offsetY: 0,
			type: 0,
			bitsPerPixel: 24,
			unpackedSize: 6,
			headerSize: HEADER_SIZE_FIELD_VALUE,
		});
	});

	it("gives each kind its own depth", () => {
		expect(
			readHzcLayout(hzcFile(Buffer.alloc(8), { type: 1 }))?.bitsPerPixel,
		).toBe(32);
		expect(
			readHzcLayout(hzcFile(Buffer.alloc(8), { type: 2 }))?.bitsPerPixel,
		).toBe(32);
		expect(
			readHzcLayout(hzcFile(Buffer.alloc(2), { type: 3 }))?.bitsPerPixel,
		).toBe(8);
		expect(
			readHzcLayout(hzcFile(Buffer.alloc(2), { type: 4 }))?.bitsPerPixel,
		).toBe(8);
	});

	it("finds a picture by its signature and its tag", async () => {
		const data = hzcFile(Buffer.alloc(6), {});
		expect(
			await favoriteHzcImageFormat.detect(
				new BufferByteSource(data),
				"pic.hzc",
			),
		).toBe(true);
		// The four bytes at 0x0c have to be NVSG.
		const wrongTag = hzcFile(Buffer.alloc(6), { tag: "NVSF" });
		expect(
			await favoriteHzcImageFormat.detect(
				new BufferByteSource(wrongTag),
				"pic.hzc",
			),
		).toBe(false);
		// And the signature has to stand.
		const wrongSignature = Buffer.from(data);
		wrongSignature[0] = 0x48;
		expect(
			await favoriteHzcImageFormat.detect(
				new BufferByteSource(wrongSignature),
				"pic.hzc",
			),
		).toBe(false);
	});

	it("writes out the first kind twenty four bits a pixel", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6]);
		const out = await extract(hzcFile(pixels, {}));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.readInt32LE(0x12)).toBe(2);
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(54).toString("hex")).toBe("0102030405060000");
	});

	it("writes out the second kind thirty two bits a pixel", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const out = await extract(hzcFile(pixels, { type: 1 }));
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.subarray(54).toString("hex")).toBe("0102030405060708");
	});

	it("writes out the fourth kind as monochrome", async () => {
		const pixels = Buffer.from([0, 1]);
		const out = await extract(
			hzcFile(pixels, { type: 4, width: 2, height: 1 }),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		// The two colours of the reference's own palette stand first.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("00000000ffffff00");
		// Two pixels padded to four bytes.
		expect(out.subarray(0x436).toString("hex")).toBe("00010000");
	});

	it("reports the measurements and the placement", async () => {
		const handle = await favoriteHzcImageFormat.open(
			new BufferByteSource(
				hzcFile(Buffer.alloc(6), { offsetX: 3, offsetY: -2 }),
			),
			"dir/pic.hzc",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			offsetX: 3,
			offsetY: -2,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "zlib",
			kind: 0,
		});
	});

	it("declines a stream that does not unfold to the picture", async () => {
		// The declared kind is five, which the reference's own decoder refuses.
		const unsupported = hzcFile(Buffer.alloc(2), { type: 5 });
		const handle = await favoriteHzcImageFormat.open(
			new BufferByteSource(unsupported),
			"pic.hzc",
		);
		await expect(handle.openEntry("0")).rejects.toThrow("is not supported");
		// A stream that unfolds short of the picture is refused as well.
		const short = hzcFile(Buffer.alloc(3), {});
		const shortHandle = await favoriteHzcImageFormat.open(
			new BufferByteSource(short),
			"pic.hzc",
		);
		await expect(shortHandle.openEntry("0")).rejects.toThrow(GarbroError);
		await expect(shortHandle.openEntry("0")).rejects.toThrow("cut short");
	});
});
