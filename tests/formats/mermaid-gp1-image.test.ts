import { BufferByteSource } from "@garbro-mcp/core";
import { mermaidGp1ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const PIXEL_OFFSET = 54;
/** The reference writes a run past this count as a value repeated rather than as bytes. */
const RUN_LIMIT = 0x32;

/** One channel: bytes as they stand, or a value and how many times it is written. */
type Part = Buffer | [number, number];

function packChannel(parts: Part[]): Buffer {
	const output: number[] = [];
	for (const part of parts) {
		if (Buffer.isBuffer(part)) {
			for (let start = 0; start < part.length; start += RUN_LIMIT) {
				const chunk = part.subarray(start, start + RUN_LIMIT);
				output.push(chunk.length, ...chunk);
			}
		} else {
			const [value, count] = part;
			output.push(RUN_LIMIT + count, value);
		}
	}
	return Buffer.from(output);
}

function buildGp1(
	width: number,
	height: number,
	blue: Buffer,
	green: Buffer,
	red: Buffer,
): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeUInt32LE(width, 0);
	header.writeUInt32LE(height, 4);
	return Buffer.concat([header, blue, green, red]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function render(file: Buffer): Promise<Buffer> {
	const archive = await mermaidGp1ImageFormat.open(sourceOf(file), "image.gp1");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Mermaid image", () => {
	it("finds its files by their name alone", async () => {
		const file = buildGp1(
			2,
			2,
			packChannel([Buffer.from([1, 2, 3, 4])]),
			packChannel([Buffer.from([5, 6, 7, 8])]),
			packChannel([Buffer.from([9, 10, 11, 12])]),
		);
		expect(
			await mermaidGp1ImageFormat.detect(sourceOf(file), "image.gp1"),
		).toBe(true);
		// The reference keeps no word to find, so a file under another name is not its own.
		expect(
			await mermaidGp1ImageFormat.detect(sourceOf(file), "image.dat"),
		).toBe(false);
		expect(
			await mermaidGp1ImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1)),
				"image.gp1",
			),
		).toBe(false);
		const empty: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
		expect(
			await mermaidGp1ImageFormat.detect(sourceOf(empty), "image.gp1"),
		).toBe(false);
		// More pixels than the port will build a bitmap for.
		const huge: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
		huge.writeUInt32LE(0x10000, 0);
		huge.writeUInt32LE(0x10000, 4);
		expect(
			await mermaidGp1ImageFormat.detect(sourceOf(huge), "image.gp1"),
		).toBe(false);
	});

	it("puts the three channels back together as one image", async () => {
		const file = buildGp1(
			2,
			2,
			packChannel([Buffer.from([1, 2, 3, 4])]),
			packChannel([Buffer.from([5, 6, 7, 8])]),
			packChannel([Buffer.from([9, 10, 11, 12])]),
		);
		const archive = await mermaidGp1ImageFormat.open(
			sourceOf(file),
			"picture.gp1",
		);
		try {
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "run-length",
				width: 2,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(archive.entries[0]?.path).toBe("picture.bmp");
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
		const bmp = await render(file);
		expect(bmp.readUInt32LE(18)).toBe(2);
		// A negative height records the top down rows the reference builds.
		expect(bmp.readInt32LE(22)).toBe(-2);
		expect(bmp.readUInt16LE(28)).toBe(24);
		// Twenty four bit rows of two pixels are padded to four bytes, and the channels are blue, green, red.
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 6)).toEqual(
			Buffer.from([1, 5, 9, 2, 6, 10]),
		);
		expect(bmp.subarray(PIXEL_OFFSET + 8, PIXEL_OFFSET + 14)).toEqual(
			Buffer.from([3, 7, 11, 4, 8, 12]),
		);
	});

	it("reads runs and the longest run of bytes it can", async () => {
		const repeated: Buffer = Buffer.alloc(0x33, 0x77);
		const file = buildGp1(
			0x33 + 3,
			1,
			// Fifty bytes as they stand — the longest a count byte can ask for — and a run of three.
			packChannel([repeated, [0x11, 3]]),
			packChannel([[0x22, 1]]),
			packChannel([[0x33, 2]]),
		);
		const bmp = await render(file);
		expect(bmp.readUInt32LE(18)).toBe(0x33 + 3);
		const pixels = bmp.subarray(PIXEL_OFFSET);
		expect(pixels[0]).toBe(0x77);
		// Fifty bytes come as they stand and the fifty first on its own, so the run starts at the fifty second.
		expect(pixels[3 * 0x33]).toBe(0x11);
		expect(pixels[3 * (0x33 + 2)]).toBe(0x11);
	});

	it("keeps whatever the channels it could not fill were left with", async () => {
		// A count of nothing writes nothing, and the file ends in the middle of the blue channel.
		const file = buildGp1(
			2,
			1,
			Buffer.from([0x00, 0x01, 0x91]),
			Buffer.alloc(0),
			Buffer.alloc(0),
		);
		const bmp = await render(file);
		// The blue channel keeps the one byte it was given and the zeros behind it; the rest of the file is
		// already spent, so the other two channels are nothing at all.
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 6)).toEqual(
			Buffer.from([0x91, 0x00, 0x00, 0x00, 0x00, 0x00]),
		);
	});

	it("stops with an error where the reference would", async () => {
		const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
		header.writeUInt32LE(2, 0);
		header.writeUInt32LE(1, 4);
		// A run whose value is not in the file at all.
		await expect(
			render(Buffer.concat([header, Buffer.from([0x33])])),
		).rejects.toThrow(/Invalid Mermaid image channel/);
		// A run longer than the channel it is written into.
		await expect(
			render(Buffer.concat([header, Buffer.from([0x33 + 3, 0x01])])),
		).rejects.toThrow(/Invalid Mermaid image channel/);
		// More bytes written as they stand than the channel has room for.
		await expect(
			render(
				Buffer.concat([
					header,
					Buffer.from([0x32, ...Buffer.alloc(0x32, 0x05)]),
				]),
			),
		).rejects.toThrow(/Invalid Mermaid image channel/);
	});
});
