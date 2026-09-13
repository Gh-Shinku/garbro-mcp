import { BufferByteSource } from "@garbro-mcp/core";
import { mgfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x4d, 0x61, 0x6c, 0x69]);
const TAG = Buffer.from("MalieGF\0", "latin1");
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function crcBytes(seed: number): Buffer {
	const crc: Buffer = Buffer.alloc(4);
	crc.writeUInt32BE(seed >>> 0, 0);
	return crc;
}

function chunk(type: string, body: Buffer): Buffer {
	const header: Buffer = Buffer.alloc(8);
	header.writeUInt32BE(body.length, 0);
	header.write(type, 4, "latin1");
	return Buffer.concat([header, body, crcBytes(body.length * 7 + type.length)]);
}

/** A structurally well formed PNG, so the pass-through can be compared byte for byte. */
function buildPng(options: {
	width: number;
	height: number;
	bitDepth?: number;
	colourType?: number;
}): Buffer {
	const ihdr: Buffer = Buffer.alloc(13, 0);
	ihdr.writeUInt32BE(options.width, 0);
	ihdr.writeUInt32BE(options.height, 4);
	ihdr.writeUInt8(options.bitDepth ?? 8, 8);
	ihdr.writeUInt8(options.colourType ?? 2, 9);
	const scan: Buffer = Buffer.alloc(64);
	for (let i = 0; i < scan.length; i += 1) scan[i] = (i * 17 + 9) & 0xff;
	return Buffer.concat([
		PNG_SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", scan),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

/** The engine's file: the tag in place of the PNG signature, everything else identical. */
function buildMgf(png: Buffer): Buffer {
	return Buffer.concat([TAG, png.subarray(8)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await mgfImageFormat.open(sourceOf(stored), "CG01.MGF");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("malie mgf image", () => {
	it("declares the Mali signature and no extension", () => {
		expect(mgfImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("Mali");
		expect(mgfImageFormat.descriptor.extensions).toEqual([]);
	});

	it("restores the png signature and carries every other byte through", async () => {
		const png = buildPng({ width: 7, height: 5 });
		const stored = buildMgf(png);
		const source = sourceOf(stored);
		expect(await mgfImageFormat.detect(source, "CG01.MGF")).toBe(true);
		const archive = await mgfImageFormat.open(source, "CG01.MGF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.png"]);
			// Eight bytes are replaced by eight bytes, so the entry has the stored length.
			expect(archive.entries[0]?.sizeKnown).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "png",
				width: 7,
				height: 5,
				tag: "MalieGF",
				prefixSize: 8,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output).toEqual(png);
		expect(output.subarray(0, 8)).toEqual(PNG_SIGNATURE);
		// The chunk walk after the header is untouched, so the payload survives as it was stored.
		expect(output.subarray(8)).toEqual(stored.subarray(8));
	});

	it("reports the dimensions and depth of the image header", async () => {
		const stored = buildMgf(
			buildPng({ width: 321, height: 123, bitDepth: 8, colourType: 6 }),
		);
		const archive = await mgfImageFormat.open(sourceOf(stored), "CG01.MGF");
		try {
			expect(archive.metadata).toMatchObject({ width: 321, height: 123 });
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 321,
				height: 123,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
	});

	it("maps the color types to a pixel depth", async () => {
		const cases: Array<[number, number, number]> = [
			[8, 0, 8],
			[4, 3, 4],
			[16, 6, 64],
			[1, 3, 1],
		];
		for (const [bitDepth, colourType, expected] of cases) {
			const stored = buildMgf(
				buildPng({ width: 4, height: 4, bitDepth, colourType }),
			);
			const archive = await mgfImageFormat.open(sourceOf(stored), "CG01.MGF");
			try {
				expect(archive.entries[0]?.metadata).toMatchObject({
					bitsPerPixel: expected,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("does not check the eighth byte of the tag", async () => {
		// `AsciiEqual` compares the seven characters of `MalieGF`, so whatever follows them is accepted even
		// though the reference's own writer puts a zero there.
		const stored = buildMgf(buildPng({ width: 4, height: 4 }));
		stored[7] = 0xff;
		const source = sourceOf(stored);
		expect(await mgfImageFormat.detect(source, "CG01.MGF")).toBe(true);
		const output = await extract(stored);
		expect(output.subarray(0, 8)).toEqual(PNG_SIGNATURE);
	});

	it("declines a tag that is not the engine's", async () => {
		const stored = buildMgf(buildPng({ width: 4, height: 4 }));
		stored[6] = 0x47;
		expect(await mgfImageFormat.detect(sourceOf(stored), "CG01.MGF")).toBe(
			false,
		);
	});

	it("declines a body that is not a png", async () => {
		const png = buildPng({ width: 4, height: 4 });
		const wrongLength = buildMgf(png);
		wrongLength.writeUInt32BE(12, 8);
		expect(await mgfImageFormat.detect(sourceOf(wrongLength), "CG01.MGF")).toBe(
			false,
		);
		const wrongType = buildMgf(png);
		wrongType.write("IHXR", 12, "latin1");
		expect(await mgfImageFormat.detect(sourceOf(wrongType), "CG01.MGF")).toBe(
			false,
		);
	});

	it("declines a short file and zero dimensions", async () => {
		const stored = buildMgf(buildPng({ width: 4, height: 4 }));
		expect(
			await mgfImageFormat.detect(sourceOf(stored.subarray(0, 25)), "CG01.MGF"),
		).toBe(false);
		const zero = buildMgf(buildPng({ width: 0, height: 4 }));
		expect(await mgfImageFormat.detect(sourceOf(zero), "CG01.MGF")).toBe(false);
	});
});
