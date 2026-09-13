import { BufferByteSource } from "@garbro-mcp/core";
import { cp3ImageDescriptor, cp3ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x3c;
const BMP_HEADER_SIZE = 54;

interface Built {
	file: Buffer;
	pixels: Buffer;
	width: number;
	height: number;
}

/** Builds a CP3X frame: the header carries the dimensions of the first frame. */
function buildCp3(width = 0x28, height = 0x14): Built {
	const pixels: Buffer = Buffer.alloc(width * height * 4);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 5) & 0xff;
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x21);
	head.write("CP3X", 0, "latin1");
	head.writeInt32LE(1, 8);
	head.writeUInt32LE(width, 0x34);
	head.writeUInt32LE(height, 0x38);
	return { file: Buffer.concat([head, pixels]), pixels, width, height };
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("seraphim cp3 image", () => {
	it("declares the CP3X signature for the registry", () => {
		expect(cp3ImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("CP3X", "ascii") },
		]);
	});

	it("wraps the first frame in a bottom up bitmap", async () => {
		const built = buildCp3();
		const source = sourceOf(built.file);
		expect(await cp3ImageFormat.detect(source, "EV01.CP3")).toBe(true);
		const archive = await cp3ImageFormat.open(source, "EV01.CP3");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["EV01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x28,
				height: 0x14,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 0x28,
				height: 0x14,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_HEADER_SIZE + built.pixels.length);
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.readUInt32LE(2)).toBe(output.length);
			expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE);
			expect(output.readUInt32LE(14)).toBe(40);
			expect(output.readInt32LE(18)).toBe(0x28);
			// `CreateFlipped` keeps the stored row order, so the height stays positive.
			expect(output.readInt32LE(22)).toBe(0x14);
			expect(output.readUInt16LE(26)).toBe(1);
			expect(output.readUInt16LE(28)).toBe(32);
			expect(output.readUInt32LE(30)).toBe(0);
			expect(output.readUInt32LE(34)).toBe(built.pixels.length);
			expect(output.subarray(BMP_HEADER_SIZE)).toEqual(built.pixels);
		} finally {
			await archive.close();
		}
	});

	it("reads the dimensions of the first frame even when more follow", async () => {
		const built = buildCp3(4, 2);
		// A second frame header at 0x3C + pixels; the image view must ignore it.
		const second = Buffer.alloc(0x10, 0x31);
		second.writeUInt32LE(0x20, 8);
		second.writeUInt32LE(0x20, 12);
		const file = Buffer.concat([
			built.file,
			second,
			Buffer.alloc(0x20 * 0x20 * 4),
		]);
		const archive = await cp3ImageFormat.open(sourceOf(file), "EV02.CP3");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 4,
				height: 2,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_HEADER_SIZE + 4 * 2 * 4);
		} finally {
			await archive.close();
		}
	});

	it("keeps the reference tag under its own id", () => {
		// `ArcCP3.cs` holds the multi-frame opener with the same tag and description, so only the ids
		// tell the two implementations apart; the catalog test checks that they stay unique.
		expect(cp3ImageDescriptor.name).toBe("Seraphim engine multi-frame image");
		expect(cp3ImageDescriptor.id).toBe("seraphim-cp3-image");
	});

	it("declines a file without the signature", async () => {
		const { file } = buildCp3();
		file[0] = 0x44;
		expect(await cp3ImageFormat.detect(sourceOf(file), "EV01.CP3")).toBe(false);
	});

	it("declines a zero dimension", async () => {
		const { file } = buildCp3();
		file.writeUInt32LE(0, 0x34);
		expect(await cp3ImageFormat.detect(sourceOf(file), "EV01.CP3")).toBe(false);
	});

	it("declines dimensions that do not fit the file", async () => {
		const { file } = buildCp3();
		file.writeUInt32LE(0x1000, 0x38);
		expect(await cp3ImageFormat.detect(sourceOf(file), "EV01.CP3")).toBe(false);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await cp3ImageFormat.detect(sourceOf(Buffer.alloc(0x20)), "EV01.CP3"),
		).toBe(false);
	});
});
