import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readMfcLayout,
	unpackMfcAlpha,
	vitaminMfcImageFormat,
} from "../../packages/formats/src/vitamin/mfc-image.js";

const HEADER_SIZE = 0x18;
const SBI_HEADER_SIZE = 0x20;

interface SbiOptions {
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	packed?: boolean;
	palette?: boolean;
}

/** A colour map whose entry `i` is the three bytes `i`, `i + 1`, `i + 2`. */
function paletteBytes(): Buffer {
	const palette = Buffer.alloc(0x300);
	for (let i = 0; i < 0x100; i += 1) {
		palette[i * 3] = i;
		palette[i * 3 + 1] = (i + 1) & 0xff;
		palette[i * 3 + 2] = (i + 2) & 0xff;
	}
	return palette;
}

function sbiBase(body: Buffer, options: SbiOptions = {}): Buffer {
	const bitsPerPixel = options.bitsPerPixel ?? 32;
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const hasPalette = options.palette ?? false;
	const head = Buffer.alloc(SBI_HEADER_SIZE);
	Buffer.from("SBI\n", "latin1").copy(head, 0);
	head[4] = 1;
	head[5] = 0;
	head[6] = bitsPerPixel;
	head.writeUInt16LE(width, 7);
	head.writeUInt16LE(height, 9);
	head[0xf] = hasPalette ? 0 : 1;
	head[0x10] = options.packed ? 1 : 0;
	const parts = hasPalette ? [paletteBytes(), body] : [body];
	head.writeInt32LE(
		SBI_HEADER_SIZE + parts.reduce((total, part) => total + part.length, 0),
		0xb,
	);
	return Buffer.concat([head, ...parts]);
}

/** A file: the head, the run length coded alpha channel and then the base picture. */
function mfcFile(alpha: Buffer, base: Buffer): Buffer {
	const head = Buffer.alloc(HEADER_SIZE);
	Buffer.from("MFC\n", "latin1").copy(head, 0);
	head[4] = 1;
	head[5] = 0;
	head[6] = 1;
	head[7] = 4;
	head.writeInt32LE(HEADER_SIZE + alpha.length, 12);
	return Buffer.concat([head, alpha, base]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await vitaminMfcImageFormat.open(
		new BufferByteSource(data),
		"pic.mfc",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Vitamin picture with alpha", () => {
	it("reads the head and the base picture it points at", () => {
		const layout = readMfcLayout(
			mfcFile(Buffer.from([2, 0xa7, 0x3f]), sbiBase(Buffer.alloc(16))),
		);
		expect(layout).toEqual({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			alphaSize: HEADER_SIZE + 3,
		});
	});

	it("gates on the four marker bytes and the base picture", async () => {
		const data = mfcFile(
			Buffer.from([2, 0xa7, 0x3f]),
			sbiBase(Buffer.alloc(16)),
		);
		expect(
			await vitaminMfcImageFormat.detect(new BufferByteSource(data), "pic.mfc"),
		).toBe(true);
		for (let index = 0; index < 4; index += 1) {
			const odd = Buffer.from(data);
			odd[4 + index] = 9;
			expect(readMfcLayout(odd)).toBeUndefined();
		}
		// A base picture that is not a Vitamin picture is refused.
		const wrongBase = mfcFile(Buffer.from([2, 0xa7, 0x3f]), Buffer.alloc(16));
		expect(readMfcLayout(wrongBase)).toBeUndefined();
	});

	it("reports the measurements of the base picture", async () => {
		const handle = await vitaminMfcImageFormat.open(
			new BufferByteSource(
				mfcFile(Buffer.from([2, 0xa7, 0x3f]), sbiBase(Buffer.alloc(16))),
			),
			"dir/pic.mfc",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "rle",
		});
	});

	it("writes the colour of a thirty two bit base with the alpha of the channel", async () => {
		const rows = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
		const out = await extract(
			mfcFile(Buffer.from([2, 0xa7, 0x3f]), sbiBase(rows)),
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// The rows stand bottom up, and the low nibble of every alpha byte comes first, widened by its own
		// four bits.
		expect(out.subarray(54, 70).toString("hex")).toBe(
			"090a0b770d0e0faa010203ff05060733",
		);
	});

	it("widens the colour of a twenty four bit base", async () => {
		const rows = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
		const out = await extract(
			mfcFile(
				Buffer.from([2, 0xff, 0x00]),
				sbiBase(rows, { bitsPerPixel: 24 }),
			),
		);
		// Two rows of two pixels; the first row of the stream becomes the last row of the picture.
		expect(out.subarray(54, 70).toString("hex")).toBe(
			"090a0bff0c0d0eff0102030004050600",
		);
	});

	it("reads a run length coded alpha channel", () => {
		// A control of nothing is a literal run, a control above 0x80 a repeat of the byte behind it.
		expect(
			unpackMfcAlpha(Buffer.from([3, 1, 2, 3]), 0, 4, 3).toString("hex"),
		).toBe("010203");
		expect(
			unpackMfcAlpha(Buffer.from([0x83, 0x55]), 0, 2, 3).toString("hex"),
		).toBe("555555");
		// The walk is bounded by the size the head declares.
		expect(
			unpackMfcAlpha(Buffer.from([3, 1, 2, 3, 9]), 0, 2, 3).toString("hex"),
		).toBe("010203");
		expect(() => unpackMfcAlpha(Buffer.from([0x84, 1]), 0, 2, 3)).toThrow(
			GarbroError,
		);
	});

	it("refuses an alpha channel that does not hold a whole number of pixels", async () => {
		// An odd number of pixels leaves half an alpha byte for the last of them.
		const base = sbiBase(Buffer.alloc(3), {
			width: 1,
			height: 1,
			bitsPerPixel: 24,
		});
		const data = mfcFile(Buffer.from([1, 0x0f]), base);
		const handle = await vitaminMfcImageFormat.open(
			new BufferByteSource(data),
			"pic.mfc",
		);
		await expect(handle.openEntry("0")).rejects.toThrow(
			"whole number of pixels",
		);
	});
});
