import { BufferByteSource } from "@garbro-mcp/core";
import { aoImageFormat, apImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x14;
const BMP_HEADER_SIZE = 54;
/** Two pixels a row, four bytes each. */
const ROW_BYTES = 8;

function rows(...values: number[][]): Buffer {
	return Buffer.from(values.flat());
}

interface AoOptions {
	marker?: string;
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	offsetX?: number;
	offsetY?: number;
	pixels?: Buffer;
}

function buildAo(options: AoOptions = {}): Buffer {
	const { marker = "AO", width = 2, height = 2, bitsPerPixel = 32 } = options;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(marker, 0, "latin1");
	header.writeUInt32LE(width, 2);
	header.writeUInt32LE(height, 6);
	header.writeInt16LE(bitsPerPixel, 10);
	header.writeInt32LE(options.offsetX ?? 0, 0x0c);
	header.writeInt32LE(options.offsetY ?? 0, 0x10);
	return Buffer.concat([
		header,
		options.pixels ??
			rows(
				[0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18],
				[0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28],
			),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "SP_001.AO"): Promise<Buffer> {
	const archive = await aoImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("kaguya ao image", () => {
	it("has no signature and declares the one extension", () => {
		expect(aoImageFormat.detection?.signatures).toEqual([]);
		expect(aoImageFormat.descriptor.extensions).toEqual(["sp_"]);
	});

	it("separates itself from the base format by its marker alone", async () => {
		// The two formats are identical apart from the marker and the origin, so both probes must reject the
		// other's files.
		const ao = buildAo();
		const ap = buildAo({ marker: "AP" });
		expect(await aoImageFormat.detect(sourceOf(ao), "A.AO")).toBe(true);
		expect(await aoImageFormat.detect(sourceOf(ap), "A.AO")).toBe(false);
		expect(await apImageFormat.detect(sourceOf(ap), "A.AP")).toBe(true);
		expect(await apImageFormat.detect(sourceOf(ao), "A.AP")).toBe(false);
		// The header is four bytes longer, so an AO file is not a valid AP file either way round.
		expect(await apImageFormat.detect(sourceOf(ao), "A.AP")).toBe(false);
	});

	it("reads a signed origin into the metadata and reverses the rows", async () => {
		const file = buildAo({ offsetX: -4, offsetY: 7 });
		const source = sourceOf(file);
		expect(await aoImageFormat.detect(source, "SP_001.AO")).toBe(true);
		const archive = await aoImageFormat.open(source, "SP_001.AO");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"SP_001.bmp",
			]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
				offsetX: -4,
				offsetY: 7,
			});
			expect(archive.metadata).toMatchObject({ offsetX: -4, offsetY: 7 });
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			rows(
				[0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28],
				[0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18],
			),
		);
		expect(output.length).toBe(BMP_HEADER_SIZE + ROW_BYTES * 2);
	});

	it("applies the same depth and dimension rules as the base format", async () => {
		expect(
			await aoImageFormat.detect(
				sourceOf(buildAo({ bitsPerPixel: 24 })),
				"A.AO",
			),
		).toBe(true);
		for (const bitsPerPixel of [0, 16, 33, -24]) {
			expect(
				await aoImageFormat.detect(sourceOf(buildAo({ bitsPerPixel })), "A.AO"),
			).toBe(false);
		}
		expect(
			await aoImageFormat.detect(sourceOf(buildAo({ width: 0x8001 })), "A.AO"),
		).toBe(false);
		expect(
			await aoImageFormat.detect(
				sourceOf(buildAo({ width: 0, height: 0, pixels: Buffer.alloc(0) })),
				"A.AO",
			),
		).toBe(true);
	});

	it("fails on extraction when a row is short", async () => {
		const file = buildAo();
		const truncated = file.subarray(0, file.length - 1);
		expect(await aoImageFormat.detect(sourceOf(truncated), "A.AO")).toBe(true);
		const archive = await aoImageFormat.open(sourceOf(truncated), "A.AO");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines a file shorter than its twenty byte header", async () => {
		// The base format's header is twelve bytes, so these files are old enough to be recognised by it but
		// not long enough for this one.
		for (const size of [12, HEADER_SIZE - 1]) {
			const file = buildAo().subarray(0, size);
			expect(await aoImageFormat.detect(sourceOf(file), "A.AO")).toBe(false);
		}
	});
});
