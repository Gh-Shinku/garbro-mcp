import { BufferByteSource } from "@garbro-mcp/core";
import { pgaImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("PGAP", "ascii");
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const KEY = Buffer.from("PGAECODE", "ascii");
const PREFIX_SIZE = 11;
const HEADER_SIZE = 26;

function crcBytes(seed: number): Buffer {
	const crc: Buffer = Buffer.alloc(4);
	crc.writeUInt32BE(seed >>> 0, 0);
	return crc;
}

function chunk(type: string, body: Buffer): Buffer {
	const header: Buffer = Buffer.alloc(8);
	header.writeUInt32BE(body.length, 0);
	header.write(type, 4, "latin1");
	return Buffer.concat([header, body, crcBytes(body.length * 5 + 3)]);
}

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
	const scan: Buffer = Buffer.alloc(96);
	for (let i = 0; i < scan.length; i += 1) scan[i] = (i * 29 + 7) & 0xff;
	return Buffer.concat([
		PNG_SIGNATURE,
		chunk("IHDR", ihdr),
		chunk("IDAT", scan),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

/** The reference's writer: three tag bytes, eight obfuscated bytes, then the body from offset sixteen. */
function obfuscate(png: Buffer): Buffer {
	const prefix: Buffer = Buffer.alloc(PREFIX_SIZE, 0x00);
	prefix.write("PGA", 0, "latin1");
	for (let i = 0; i < KEY.length; i += 1)
		prefix[3 + i] = (png[8 + i] ?? 0) ^ (KEY[i] ?? 0);
	return Buffer.concat([prefix, png.subarray(16)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await pgaImageFormat.open(sourceOf(stored), "CG01.PGA");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("palette pga image", () => {
	it("declares the PGAP signature and no extension", () => {
		expect(pgaImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("PGAP");
		expect(pgaImageFormat.descriptor.extensions).toEqual([]);
	});

	it("restores a whole png from an obfuscated one", async () => {
		const png = buildPng({ width: 9, height: 4 });
		const stored = obfuscate(png);
		expect(await pgaImageFormat.detect(sourceOf(stored), "CG01.PGA")).toBe(
			true,
		);
		const archive = await pgaImageFormat.open(sourceOf(stored), "CG01.PGA");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.png"]);
			expect(archive.entries[0]?.encrypted).toBe(true);
			// Eleven stored bytes become a sixteen byte header, so the entry is five bytes longer.
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.metadata).toMatchObject({
				image: "png",
				width: 9,
				height: 4,
				obfuscation: "PGAECODE",
				prefixSize: PREFIX_SIZE,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output).toEqual(png);
		expect(output.length).toBe(stored.length + 5);
	});

	it("has a P as the fourth byte because the chunk length starts with a zero", async () => {
		const stored = obfuscate(buildPng({ width: 3, height: 3 }));
		expect(stored.subarray(0, 4)).toEqual(SIGNATURE);
		// The fourth byte is the `IHDR` length's top byte, which is zero, exclusive orred with `P`.
		expect(stored[3]).toBe(0x00 ^ 0x50);
	});

	it("reports the dimensions and depth of the image header", async () => {
		const stored = obfuscate(
			buildPng({ width: 511, height: 257, bitDepth: 16, colourType: 6 }),
		);
		const archive = await pgaImageFormat.open(sourceOf(stored), "CG01.PGA");
		try {
			expect(archive.metadata).toMatchObject({ width: 511, height: 257 });
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 511,
				height: 257,
				bitsPerPixel: 64,
			});
		} finally {
			await archive.close();
		}
	});

	it("maps the color types to a pixel depth", async () => {
		const cases: Array<[number, number, number]> = [
			[8, 0, 8],
			[4, 3, 4],
			[2, 4, 4],
		];
		for (const [bitDepth, colourType, expected] of cases) {
			const stored = obfuscate(
				buildPng({ width: 4, height: 4, bitDepth, colourType }),
			);
			const archive = await pgaImageFormat.open(sourceOf(stored), "CG01.PGA");
			try {
				expect(archive.entries[0]?.metadata).toMatchObject({
					bitsPerPixel: expected,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("declines a wrong tag and an unrestorable header", async () => {
		const stored = obfuscate(buildPng({ width: 4, height: 4 }));
		const wrongTag = Buffer.from(stored);
		wrongTag[2] = 0x58;
		expect(await pgaImageFormat.detect(sourceOf(wrongTag), "CG01.PGA")).toBe(
			false,
		);
		// A wrong key leaves the chunk length and type unreadable.
		const wrongKey = Buffer.from(stored);
		wrongKey[3] = (wrongKey[3] ?? 0) ^ 0xff;
		expect(await pgaImageFormat.detect(sourceOf(wrongKey), "CG01.PGA")).toBe(
			false,
		);
	});

	it("declines a short file and zero dimensions", async () => {
		const stored = obfuscate(buildPng({ width: 4, height: 4 }));
		expect(
			await pgaImageFormat.detect(
				sourceOf(stored.subarray(0, HEADER_SIZE - 1)),
				"CG01.PGA",
			),
		).toBe(false);
		const zero = obfuscate(buildPng({ width: 0, height: 4 }));
		expect(await pgaImageFormat.detect(sourceOf(zero), "CG01.PGA")).toBe(false);
	});

	it("carries the body through byte for byte", async () => {
		const png = buildPng({ width: 5, height: 5 });
		const stored = obfuscate(png);
		const output = await extract(stored);
		// Everything from the sixteenth byte of the PNG onward is a straight copy of the file from eleven.
		expect(output.subarray(16)).toEqual(stored.subarray(PREFIX_SIZE));
		expect(output.subarray(0, 8)).toEqual(PNG_SIGNATURE);
		expect(output.subarray(8, 16)).toEqual(png.subarray(8, 16));
	});
});
