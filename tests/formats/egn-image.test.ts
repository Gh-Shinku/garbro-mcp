import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";
import {
	egnImageFormat,
	readEgnLayout,
	unpackEgn,
} from "../../packages/formats/src/unknown/egn-image.js";

/** The bitmap an LZSS-compressed picture holds. */
const BITMAP = writeBmp24(
	2,
	1,
	Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
);

/** A walk of literals alone: a control byte of eight set bits before every eight bytes. */
function literalLzss(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let start = 0; start < data.length; start += 8) {
		parts.push(Buffer.from([0xff]), data.subarray(start, start + 8));
	}
	return Buffer.concat(parts);
}

/**
 * A picture of the long form: the head is the inverse of a word whose mode and flag are nought, which is
 * `0xFFFFFFFF`, and the size of the stream stands behind it as a word of its own the other way round.
 */
function egnFile(bitmap: Buffer = BITMAP): Buffer {
	const head = Buffer.alloc(8, 0x00);
	head.writeUInt32LE(0xffffffff, 0);
	head.writeInt32BE(bitmap.length, 4);
	return Buffer.concat([head, literalLzss(bitmap)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await egnImageFormat.open(
		new BufferByteSource(data),
		"pic.egn",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("LZSS-compressed BMP image", () => {
	it("reads the head as the reference does", () => {
		const data = egnFile();
		expect(readEgnLayout(data)).toMatchObject({
			mode: 0,
			flag: 0,
			dataOffset: 8,
			unpackedSize: BITMAP.length,
			width: 2,
			height: 1,
			bitsPerPixel: 24,
		});
	});

	it("gates on the mode, the size and the bitmap behind the stream", () => {
		const good = egnFile();
		expect(readEgnLayout(good)).toBeDefined();
		// A word whose mode is not nought is turned away, the fourth to sixth bits of the inverse being set.
		const mode = Buffer.from(good);
		// A mode of seven leaves the fourth to sixth bits of the **inverse** set.
		mode.writeUInt32LE(0xffffff8f, 0);
		expect(readEgnLayout(mode)).toBeUndefined();
		// A size of nothing is refused as well.
		const none = Buffer.from(good);
		none.writeInt32BE(0, 4);
		expect(readEgnLayout(none)).toBeUndefined();
		// And so is a stream that does not unfold into a bitmap at all.
		const other = Buffer.from(good);
		other.writeInt32BE(4, 4);
		other.fill(0x00, 8);
		expect(readEgnLayout(other)).toBeUndefined();
	});

	it("takes the stream of the short form four bytes in", () => {
		// Where the seventh bit of the inverse is set, the stream stands four bytes in and its size is the
		// highest three bytes of the word the other way round — so the size always reaches past the sixteen
		// millionth byte, which is what this kind of head is for.
		const size = 0xff0000;
		const signature =
			(((size & 0xff) << 24) |
				(((size >>> 8) & 0xff) << 16) |
				(((size >>> 16) & 0xff) << 8) |
				0x80) >>>
			0;
		const head = Buffer.alloc(4, 0x00);
		head.writeUInt32LE(~signature >>> 0, 0);
		const data = Buffer.concat([head, literalLzss(BITMAP)]);
		expect(readEgnLayout(data)).toMatchObject({
			mode: 0,
			flag: 0,
			dataOffset: 4,
			unpackedSize: size,
			width: 2,
			height: 1,
		});
	});

	it("unfolds a walk of literals and of steps back", () => {
		const output = Buffer.alloc(4, 0x00);
		// Two literals stand, and then a step of two bytes from two places back — which the flag of nought
		// counts as a word whose highest twelve bits are the count less three and whose lowest twelve are the
		// places behind the walk.
		expect(
			unpackEgn(
				Buffer.from([0xc0, 0xaa, 0xbb, 0x10, 0x02]),
				0,
				output.length,
				0,
			).toString("hex"),
		).toBe("aabbaabb");
	});

	it("hands the bitmap out as the bitmap it is", async () => {
		const out = await extract(egnFile());
		expect(out.toString("hex")).toBe(BITMAP.toString("hex"));
	});

	it("declines a file that does not hold a picture", async () => {
		const data = egnFile();
		data.writeUInt32LE(0xffffff8f, 0);
		await expect(
			egnImageFormat.open(new BufferByteSource(data), "pic.egn"),
		).rejects.toThrow(GarbroError);
		await expect(
			egnImageFormat.open(new BufferByteSource(data), "pic.egn"),
		).rejects.toThrow("Not an LZSS-compressed bitmap");
	});
});
