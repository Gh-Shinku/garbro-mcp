import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	nexasGrpImageFormat,
	readGrpLayout,
	unpackGrp,
} from "../../packages/formats/src/nexas/grp-image.js";

const HEADER_SIZE = 0x11;

interface GrpOptions {
	version?: number;
	bitsPerPixel?: number;
	width?: number;
	height?: number;
	unpackedSize?: number;
}

/**
 * A file: the head and then whatever stands behind it. The first version's pixels stand at the thirteenth
 * byte, which is inside the seventeen byte head the reference reads, so its head is only thirteen bytes long.
 */
function grpFile(body: Buffer, options: GrpOptions = {}): Buffer {
	const version = options.version ?? 2;
	const head = Buffer.alloc(version < 2 ? 0xd : HEADER_SIZE);
	head.write("GR", 0, "latin1");
	head[2] = 0x30 + version;
	head.writeUInt16LE(options.bitsPerPixel ?? 24, 3);
	head.writeUInt32LE(options.width ?? 2, 5);
	head.writeUInt32LE(options.height ?? 2, 9);
	if (version > 1) {
		head.writeInt32LE(options.unpackedSize ?? 12, 0xd);
	}
	const file = Buffer.concat([head, body]);
	if (file.length >= HEADER_SIZE) return file;
	return Buffer.concat([file, Buffer.alloc(HEADER_SIZE - file.length)]);
}

/** A packed stream: the control bits apart from the literals and the copies they govern. */
function packed(
	controlByte: number,
	declaredBits: number,
	data: Buffer,
): Buffer {
	return Buffer.concat([
		Buffer.from([declaredBits, 0, 0, 0]),
		Buffer.from([controlByte]),
		Buffer.alloc(4),
		data,
	]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await nexasGrpImageFormat.open(
		new BufferByteSource(data),
		"pic.grp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** A literal of two pixels, then a copy of both from two pixels behind. */
const DATA_24 = Buffer.from([1, 2, 3, 0x11, 0x12, 0x13, 0xa5, 0x00]);

describe("NeXAS engine image", () => {
	it("reads the head as the reference does", () => {
		expect(readGrpLayout(grpFile(Buffer.alloc(0)))).toEqual({
			version: 2,
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			unpackedSize: 12,
		});
		// The first version gives no size of its own, so it is the measurements at the depth, and an eight bit
		// picture carries its colour map inside that size.
		const first = grpFile(Buffer.alloc(0), {
			version: 1,
			bitsPerPixel: 8,
			width: 4,
			height: 2,
		});
		expect(readGrpLayout(first)).toEqual({
			version: 1,
			width: 4,
			height: 2,
			bitsPerPixel: 8,
			unpackedSize: 8 + 0x300,
		});
	});

	it("finds each version and declines the rest", async () => {
		for (const version of [1, 2, 3]) {
			const data = grpFile(Buffer.alloc(0), { version });
			expect(
				await nexasGrpImageFormat.detect(new BufferByteSource(data), "pic.grp"),
			).toBe(true);
		}
		// Only the first three versions are read.
		const fourth = grpFile(Buffer.alloc(0), { version: 4 });
		expect(readGrpLayout(fourth)).toBeUndefined();
		// So is a file that does not begin with the two letters.
		const other = Buffer.from(grpFile(Buffer.alloc(0)));
		other.write("XX", 0, "latin1");
		expect(readGrpLayout(other)).toBeUndefined();
		// And a depth the reader does not know.
		const odd = grpFile(Buffer.alloc(0), { bitsPerPixel: 4 });
		expect(
			await nexasGrpImageFormat.detect(new BufferByteSource(odd), "pic.grp"),
		).toBe(false);
	});

	it("reports the measurements of the picture", async () => {
		const handle = await nexasGrpImageFormat.open(
			new BufferByteSource(grpFile(packed(0x40, 7, DATA_24))),
			"dir/pic.grp",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			version: 2,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 2,
			height: 2,
		});
	});

	it("unfolds a picture of the second version with a five bit count", async () => {
		const out = await extract(grpFile(packed(0x40, 7, DATA_24)));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.readInt32LE(0x12)).toBe(2);
		expect(out.readInt32LE(0x16)).toBe(-2);
		// Two rows of two pixels, each padded to eight bytes.
		expect(out.subarray(54).toString("hex")).toBe(
			"01020311121300000102031112130000",
		);
	});

	it("unfolds a picture of the third version with a three bit count", async () => {
		// The count stands in three bits and the distance in the rest, so the word is `0x2d`.
		const data = Buffer.from([1, 2, 3, 0x11, 0x12, 0x13, 0x2d, 0x00]);
		const out = await extract(grpFile(packed(0x40, 7, data), { version: 3 }));
		expect(out.subarray(54, 70).toString("hex")).toBe(
			"01020311121300000102031112130000",
		);
	});

	it("unfolds a picture of the first version as it stands", async () => {
		const pixels = Buffer.from([
			1, 2, 3, 0x11, 0x12, 0x13, 0x21, 0x22, 0x23, 0x31, 0x32, 0x33,
		]);
		const out = await extract(
			grpFile(pixels, { version: 1, unpackedSize: 12 }),
		);
		// Two rows of two pixels, each padded to four bytes.
		expect(out.subarray(54, 70).toString("hex")).toBe(
			"01020311121300002122233132330000",
		);
	});

	it("reads the colour map of an eight bit picture from the end of its pixels", async () => {
		const pixels = Buffer.alloc(4 + 0x300);
		pixels[0] = 0;
		pixels[1] = 1;
		pixels[2] = 0;
		pixels[3] = 1;
		// The colour map stands in the last seven hundred and sixty eight bytes, three bytes an entry, red,
		// green and blue.
		for (let index = 0; index < 0x100; index += 1) {
			pixels[4 + index * 3] = index;
			pixels[4 + index * 3 + 1] = (index + 1) & 0xff;
			pixels[4 + index * 3 + 2] = (index + 2) & 0xff;
		}
		const out = await extract(
			grpFile(pixels, {
				version: 1,
				bitsPerPixel: 8,
				width: 2,
				height: 2,
				unpackedSize: 4 + 0x300,
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		// The entries of the bitmap stand blue, green, red, nothing.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0201000003020100");
	});

	it("unfolds each kind of command of the packed walk", () => {
		const layout = {
			version: 2,
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			unpackedSize: 12,
		};
		// Two literals and a copy of both from two pixels behind.
		const out = unpackGrp(grpFile(packed(0x40, 7, DATA_24)), layout);
		expect(out.toString("hex")).toBe("010203111213010203111213");
	});

	it("refuses a copy that reaches outside the picture and a stream that stops", () => {
		const layout = {
			version: 2,
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			unpackedSize: 12,
		};
		// A copy at the very start has nothing behind it.
		expect(() =>
			unpackGrp(grpFile(packed(0x01, 1, Buffer.from([0x00, 0x00]))), layout),
		).toThrow("past its own end");
		// A stream that stops where a literal is wanted.
		expect(() =>
			unpackGrp(grpFile(packed(0x00, 1, Buffer.alloc(0))), layout),
		).toThrow(GarbroError);
	});
});
