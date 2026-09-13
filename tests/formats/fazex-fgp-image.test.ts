import { BufferByteSource } from "@garbro-mcp/core";
import { fgpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x1b;
const MARKER = "FAZEX_GRAPHIC_FILE";

/** GARbro's default LZSS framing: a set control bit means a literal, eight to a control byte. */
function lzssLiterals(data: Buffer): Buffer {
	const out: number[] = [];
	for (let index = 0; index < data.length; index += 8) {
		out.push(0xff);
		for (let next = index; next < Math.min(index + 8, data.length); next += 1) {
			out.push(data[next] ?? 0);
		}
	}
	return Buffer.from(out);
}

function buildFgp(
	width: number,
	height: number,
	payload: Buffer,
	options: { marker?: string; headerSize?: number } = {},
): Buffer {
	const header: Buffer = Buffer.alloc(options.headerSize ?? HEADER_SIZE, 0x00);
	// A shorter header truncates the marker, and has no room for the dimensions at all.
	header.write((options.marker ?? MARKER).slice(0, header.length), 0, "latin1");
	if (header.length >= 0x1b) {
		header.writeUInt32LE(width, 0x13);
		header.writeUInt32LE(height, 0x17);
	}
	return Buffer.concat([header, lzssLiterals(payload)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.fgp"): Promise<Buffer> {
	const archive = await fgpImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("FazeX image", () => {
	it("needs the whole marker string", async () => {
		const payload: Buffer = Buffer.alloc(4, 0x00);
		expect(
			await fgpImageFormat.detect(sourceOf(buildFgp(1, 1, payload)), "A.fgp"),
		).toBe(true);
		for (const marker of [
			"FAZEX_GRAPHIC_FILX",
			"FAZEX_GRAPHIC_FIL",
			"FAZEX_GRAPHIC",
			"XFZEX_GRAPHIC_FILE",
		]) {
			expect(
				await fgpImageFormat.detect(
					sourceOf(buildFgp(1, 1, payload, { marker })),
					"A.fgp",
				),
			).toBe(false);
		}
		// A file too short to hold the header cannot be probed at all.
		expect(
			await fgpImageFormat.detect(
				sourceOf(buildFgp(1, 1, payload, { headerSize: 0x10 })),
				"A.fgp",
			),
		).toBe(false);
	});

	it("reads the dimensions from their unaligned offsets", async () => {
		const file = buildFgp(3, 2, Buffer.alloc(24, 0x00));
		// Filler in the byte a bitmap would use for the low half of its width: a reader at 0x12 would find
		// 0xaa000003, and one at 0x16 would find the height shifted up by eight, 0x200, rather than the
		// words at 0x13 and 0x17.
		file[0x12] = 0xaa;
		const archive = await fgpImageFormat.open(sourceOf(file), "A.fgp");
		try {
			expect(archive.metadata).toMatchObject({
				width: 3,
				height: 2,
				bitsPerPixel: 32,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 3,
				height: 2,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
	});

	it("assembles four planar channels and inverts the alpha", async () => {
		// Two rows of two pixels, one array per channel, in the order the stream stores them.
		const planes = [
			[0x10, 0x20, 0x30, 0x40], // blue
			[0x11, 0x21, 0x31, 0x41], // green
			[0x12, 0x22, 0x32, 0x42], // red
			[0x01, 0x02, 0x03, 0x04], // alpha, stored inverted
		];
		const output = await extract(buildFgp(2, 2, Buffer.from(planes.flat())));
		// A flipped image is written with a positive height.
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(54)).toEqual(
			Buffer.from([
				0x10, 0x11, 0x12, 0xfe, 0x20, 0x21, 0x22, 0xfd, 0x30, 0x31, 0x32, 0xfc,
				0x40, 0x41, 0x42, 0xfb,
			]),
		);
	});

	it("leaves the rest of the channels zeroed when the stream stops early", async () => {
		// Only the blue channel is present: the other two are black and the inverted alpha is opaque.
		const output = await extract(buildFgp(2, 1, Buffer.from([0x50, 0x60])));
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x50, 0x00, 0x00, 0xff, 0x60, 0x00, 0x00, 0xff]),
		);
	});

	it("lists its single bitmap entry", async () => {
		const file = buildFgp(2, 1, Buffer.alloc(8, 0x00));
		const archive = await fgpImageFormat.open(
			sourceOf(file),
			"sub/dir/CG_07.fgp",
		);
		try {
			const entry = archive.entries[0];
			expect(entry?.path).toBe("CG_07.bmp");
			expect(entry?.sizeKnown).toBe(false);
			expect(entry?.size).toBe(BigInt(file.length));
			expect(archive.metadata).toMatchObject({ image: "bmp" });
		} finally {
			await archive.close();
		}
	});

	it("accepts an empty image but refuses an absurd one", async () => {
		const empty = await extract(buildFgp(0, 0, Buffer.alloc(0)));
		expect(empty.length).toBe(54);
		const huge = buildFgp(0x20000000, 2, Buffer.alloc(8, 0x00));
		expect(await fgpImageFormat.detect(sourceOf(huge), "A.fgp")).toBe(true);
		await expect(extract(huge)).rejects.toThrow();
	});

	it("keeps the detection independent of the image size", async () => {
		// The probe only reads the marker, so a file with no room for pixels still detects.
		const file = Buffer.alloc(HEADER_SIZE, 0x00);
		file.write(MARKER, 0, "latin1");
		expect(await fgpImageFormat.detect(sourceOf(file), "A.fgp")).toBe(true);
		const output = await extract(file);
		expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
	});
});
