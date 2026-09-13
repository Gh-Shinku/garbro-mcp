import { BufferByteSource } from "@garbro-mcp/core";
import { gefImageDescriptor, gefImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

// The reference's own header is twelve bytes; the PNG signature follows immediately at 0xC.
const HEADER_SIZE = 0xc;
const PNG_OFFSET = 0xc;
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

interface Built {
	file: Buffer;
	png: Buffer;
	width: number;
	height: number;
}

/** Builds a PNG with the requested dimensions, then the sixteen byte header in front of it. */
function buildGef(width = 0x30, height = 0x20, signature = 0x00010100): Built {
	const ihdr: Buffer = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr.writeUInt8(8, 8);
	ihdr.writeUInt8(2, 9);
	const chunk: Buffer = Buffer.alloc(8);
	chunk.writeUInt32BE(13, 0);
	chunk.write("IHDR", 4, "latin1");
	const png: Buffer = Buffer.concat([
		PNG_SIGNATURE,
		chunk,
		ihdr,
		Buffer.alloc(0x18, 0x7e),
	]);
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x21);
	head.writeUInt32LE(signature, 0);
	head.writeUInt32LE(width, 4);
	head.writeUInt32LE(height, 8);
	return { file: Buffer.concat([head, png]), png, width, height };
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("yellowcap gef image", () => {
	it("declares both signature variants", () => {
		expect(gefImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x00, 0x01, 0x01, 0x00]) },
			{ bytes: Buffer.from([0x00, 0x01, 0x01, 0xff]) },
		]);
		expect(gefImageDescriptor.extensions).toEqual(["gef"]);
	});

	it("extracts the embedded png unchanged", async () => {
		const built = buildGef();
		const source = sourceOf(built.file);
		expect(await gefImageFormat.detect(source, "EV01.GEF")).toBe(true);
		const archive = await gefImageFormat.open(source, "EV01.GEF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["EV01.png"]);
			expect(archive.metadata).toMatchObject({
				image: "png",
				width: 0x30,
				height: 0x20,
				bitDepth: 8,
				colorType: 2,
				channels: 3,
				bitsPerPixel: 24,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x30,
				height: 0x20,
				bitsPerPixel: 24,
			});
			// The embedded stream is the PNG itself, so the length matches exactly.
			expect(archive.entries[0]?.size).toBe(BigInt(built.png.length));
			expect(built.file.length - PNG_OFFSET).toBe(built.png.length);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(built.png);
			// The sixteen byte header is not part of the extracted stream.
			expect(output.subarray(0, 4)).toEqual(PNG_SIGNATURE.subarray(0, 4));
		} finally {
			await archive.close();
		}
	});

	it("accepts the variant signature", async () => {
		const built = buildGef(0x40, 0x40, 0xff010100);
		expect(await gefImageFormat.detect(sourceOf(built.file), "EV02.GEF")).toBe(
			true,
		);
		const archive = await gefImageFormat.open(sourceOf(built.file), "EV02.GEF");
		try {
			expect(archive.metadata).toMatchObject({ width: 0x40, height: 0x40 });
		} finally {
			await archive.close();
		}
	});

	it("declines a png whose dimensions differ from the header", async () => {
		const built = buildGef();
		// Patch the copy inside the file: `Buffer.concat` does not share memory with `png`.
		built.file.writeUInt32BE(0x31, HEADER_SIZE + 0x10);
		expect(await gefImageFormat.detect(sourceOf(built.file), "EV01.GEF")).toBe(
			false,
		);
	});

	it("declines a file whose png signature is missing", async () => {
		const built = buildGef();
		built.file[PNG_OFFSET] = 0x88;
		expect(await gefImageFormat.detect(sourceOf(built.file), "EV01.GEF")).toBe(
			false,
		);
	});

	it("declines an unknown signature word", async () => {
		const built = buildGef(0x30, 0x20, 0x00010101);
		expect(await gefImageFormat.detect(sourceOf(built.file), "EV01.GEF")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header plus the png header", async () => {
		const built = buildGef();
		expect(
			await gefImageFormat.detect(
				sourceOf(built.file.subarray(0, PNG_OFFSET + 0x1c)),
				"EV01.GEF",
			),
		).toBe(false);
	});
});
