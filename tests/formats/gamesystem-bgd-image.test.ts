import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { gameSystemBgdImageFormat } from "../../packages/formats/src/gamesystem/bgd-image.js";

const HEADER_SIZE = 0x10;

const SHIFT_TABLE = [
	0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 2, 2, 1, 1, 0, 0,
	1, 1, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1, 1, 1, 2, 2, 2, 2, 1, 1,
];
const RGB_SHIFT = [
	1, 2, 4, 8, 0x10, 0x26, 0x50, 0xaa, -1, -2, -4, -8, -0x10, -0x26, -0x50,
	-0xaa, 2, 4, 6, 0x0c, 0x18, 0x30, 0x60, 0xc0, -2, -4, -6, -0x0c, -0x18, -0x30,
	-0x60, -0xc0, 5, 0x0a, 0x14, 0x1e, 0x32, 0x50, 0x82, 0xd2, -5, -0x0a, -0x14,
	-0x1e, -0x32, -0x50, -0x82, -0xd2,
];

/** A background: the length of everything behind the header, its width, its height, and the ops. */
function bgdFile(
	width: number,
	height: number,
	ops: Buffer,
	length?: number,
): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0);
	header.writeUInt32LE(length ?? ops.length, 0);
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	return Buffer.concat([header, ops]);
}

/**
 * What the picture the ops stand for holds, counted the way the reference counts it: two pixels to an op of
 * three bytes, six nibbles to the op, and every nibble a difference from the band the state names.
 */
function expectedPixels(ops: Buffer): Buffer {
	const count = ops.length / 3;
	const pixels: Buffer = Buffer.alloc(count * 6, 0x00);
	let destination = 0;
	let blue = 0;
	let green = 0;
	let red = 0;
	let s1 = 1;
	let s2 = 1;
	let s3 = 1;
	for (let i = 0; i < count; i += 1) {
		const op =
			(ops[i * 3] ?? 0) |
			((ops[i * 3 + 1] ?? 0) << 8) |
			((ops[i * 3 + 2] ?? 0) << 16);
		for (const [nibble, channel] of [
			[op & 0xf, 0],
			[(op >> 4) & 0xf, 1],
			[(op >> 8) & 0xf, 2],
		] as const) {
			s1 = channel === 0 ? (s1 << 4) | nibble : s1;
			s2 = channel === 1 ? (s2 << 4) | nibble : s2;
			s3 = channel === 2 ? (s3 << 4) | nibble : s3;
			const value =
				channel === 0
					? RGB_SHIFT[s1]
					: channel === 1
						? RGB_SHIFT[s2]
						: RGB_SHIFT[s3];
			if (channel === 0) blue += value ?? 0;
			else if (channel === 1) green += value ?? 0;
			else red += value ?? 0;
		}
		pixels[destination] = blue & 0xff;
		pixels[destination + 1] = green & 0xff;
		pixels[destination + 2] = red & 0xff;
		destination += 3;
		for (const [shift, channel] of [
			[16, 0],
			[20, 1],
			[12, 2],
		] as const) {
			const nibble = (op >> shift) & 0xf;
			s1 = channel === 0 ? (SHIFT_TABLE[s1] ?? 0) * 16 + nibble : s1;
			s2 = channel === 1 ? (SHIFT_TABLE[s2] ?? 0) * 16 + nibble : s2;
			s3 = channel === 2 ? (SHIFT_TABLE[s3] ?? 0) * 16 + nibble : s3;
			const value =
				channel === 0
					? RGB_SHIFT[s1]
					: channel === 1
						? RGB_SHIFT[s2]
						: RGB_SHIFT[s3];
			if (channel === 0) blue += value ?? 0;
			else if (channel === 1) green += value ?? 0;
			else red += value ?? 0;
		}
		pixels[destination] = blue & 0xff;
		pixels[destination + 1] = green & 0xff;
		pixels[destination + 2] = red & 0xff;
		destination += 3;
		s1 = SHIFT_TABLE[s1] ?? 0;
		s2 = SHIFT_TABLE[s2] ?? 0;
		s3 = SHIFT_TABLE[s3] ?? 0;
	}
	return pixels;
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.bgd"): Promise<Buffer> {
	const handle = await gameSystemBgdImageFormat.open(
		sourceOf(data),
		sourcePath,
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("'GameSystem' background image", () => {
	it("finds a background as long as its own word says", async () => {
		const data = bgdFile(2, 1, Buffer.alloc(3, 0));
		expect(
			await gameSystemBgdImageFormat.detect(sourceOf(data), "cg.bgd"),
		).toBe(true);
		// A word that does not account for the file leaves it alone, and so does a side of nothing.
		expect(
			await gameSystemBgdImageFormat.detect(
				sourceOf(bgdFile(2, 1, Buffer.alloc(3, 0), 2)),
			),
		).toBe(false);
		expect(
			await gameSystemBgdImageFormat.detect(
				sourceOf(bgdFile(0, 1, Buffer.alloc(3, 0))),
			),
		).toBe(false);
	});

	it("reports the measurements of the background", async () => {
		const handle = await gameSystemBgdImageFormat.open(
			sourceOf(bgdFile(4, 2, Buffer.alloc(12, 0))),
			"dir/cg.bgd",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 4,
			height: 2,
			bitsPerPixel: 24,
		});
	});

	it("counts a difference of nothing but the very first nibbles", async () => {
		// Every nibble of nothing: the first pixel takes the first entry of the band the state names, which is
		// two, and the pixel behind it takes the first entry of the band that follows, which is one.
		const out = await extract(bgdFile(2, 1, Buffer.alloc(3, 0)));
		expect(out.readUInt16LE(28)).toBe(24);
		expect(out.readInt32LE(22)).toBe(1);
		expect(out.subarray(54, 54 + 8)).toEqual(
			Buffer.from([2, 2, 2, 3, 3, 3, 0, 0]),
		);
	});

	it("counts the nibbles of an op in the order the reference counts them", async () => {
		const ops: Buffer = Buffer.from([0x21, 0x43, 0x65]);
		const out = await extract(bgdFile(2, 1, ops));
		expect(out.subarray(54, 54 + 6)).toEqual(expectedPixels(ops));
	});

	it("counts a whole background of ops", async () => {
		const ops: Buffer = Buffer.from([
			0x21, 0x43, 0x65, 0x78, 0x9a, 0xbc, 0xde, 0xf0, 0x12,
		]);
		const out = await extract(bgdFile(6, 1, ops));
		expect(out.subarray(54, 54 + 18)).toEqual(expectedPixels(ops));
	});

	it("leaves the odd pixel of a background with an odd count as it was", async () => {
		// Three pixels are one op and a half, and the op writes two of them.
		const out = await extract(bgdFile(3, 1, Buffer.alloc(3, 0)));
		expect(out.subarray(54, 54 + 12)).toEqual(
			Buffer.from([2, 2, 2, 3, 3, 3, 0, 0, 0, 0, 0, 0]),
		);
	});

	it("refuses a background cut short of the ops its measurements need", async () => {
		await expect(
			extract(bgdFile(4, 2, Buffer.alloc(3, 0), 12)),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});
});
