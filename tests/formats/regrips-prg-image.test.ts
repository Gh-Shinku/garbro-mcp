import { BufferByteSource } from "@garbro-mcp/core";
import {
	PNG_SIGNATURE,
	decryptRegrips,
	prgImageFormat,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { pngFile } from "../helpers/png.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { readPngImage } from "../../packages/formats/src/shared/png-image.js";

interface PngOptions {
	width?: number;
	height?: number;
	depth?: number;
	colourType?: number;
	signature?: Buffer;
	/** Chunks after the header, which the port passes through without walking. */
	tail?: boolean;
}

function chunk(type: string, body: Buffer): Buffer {
	const length: Buffer = Buffer.alloc(4);
	length.writeUInt32BE(body.length, 0);
	return Buffer.concat([
		length,
		Buffer.from(type, "latin1"),
		body,
		Buffer.alloc(4, 0xaa),
	]);
}

function buildPng(options: PngOptions = {}): Buffer {
	const ihdr: Buffer = Buffer.alloc(13, 0x00);
	ihdr.writeUInt32BE(options.width ?? 8, 0);
	ihdr.writeUInt32BE(options.height ?? 4, 4);
	ihdr[8] = options.depth ?? 8;
	ihdr[9] = options.colourType ?? 6;
	const parts: Buffer[] = [
		options.signature ?? PNG_SIGNATURE,
		chunk("IHDR", ihdr),
	];
	if (options.tail !== false) {
		parts.push(chunk("sBIT", Buffer.alloc(3, 0x08)));
		parts.push(chunk("IDAT", Buffer.alloc(6, 0x78)));
		parts.push(chunk("IEND", Buffer.alloc(0)));
	}
	return Buffer.concat(parts);
}

/** The stored file is the graphic with every byte xored, which is all the encryption there is. */
function buildRegrips(png: Buffer): Buffer {
	return decryptRegrips(png);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.prg"): Promise<Buffer> {
	const archive = await prgImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

async function metadataOf(
	file: Buffer,
): Promise<Record<string, unknown> | undefined> {
	const archive = await prgImageFormat.open(sourceOf(file), "A.prg");
	try {
		return archive.entries[0]?.metadata;
	} finally {
		await archive.close();
	}
}

describe("Regrips encrypted image", () => {
	it("probes the decrypted graphic, not the stored bytes", async () => {
		const png = buildPng();
		expect(
			await prgImageFormat.detect(sourceOf(buildRegrips(png)), "A.prg"),
		).toBe(true);
		// The plain graphic is not this format, and neither is a file that only starts like one.
		expect(await prgImageFormat.detect(sourceOf(png), "A.prg")).toBe(false);
		// Four xored signature bytes and nothing else: the probe must look further than the signature.
		const signatureOnly: Buffer = Buffer.from(
			Array.from(PNG_SIGNATURE.subarray(0, 4), (x) => x ^ 0xff).concat(
				Array.from({ length: 29 }, () => 0x00),
			),
		);
		expect(await prgImageFormat.detect(sourceOf(signatureOnly), "A.prg")).toBe(
			false,
		);
		expect(
			await prgImageFormat.detect(sourceOf(Buffer.alloc(8, 0xff)), "A.prg"),
		).toBe(false);
	});

	it("maps the colour type and the bit depth the way the reference does", async () => {
		const cases: [number, number, number][] = [
			[8, 2, 24],
			[16, 6, 64],
			[1, 3, 24],
			[2, 0, 2],
			[8, 4, 16],
		];
		for (const [depth, colourType, bitsPerPixel] of cases) {
			const meta = await metadataOf(
				buildRegrips(buildPng({ depth, colourType })),
			);
			expect(meta).toMatchObject({ width: 8, height: 4, bitsPerPixel });
		}
	});

	it("refuses a depth or colour type outside the known sets", async () => {
		for (const options of [
			{ depth: 3, colourType: 2 },
			{ depth: 8, colourType: 1 },
			{ depth: 8, colourType: 7 },
		]) {
			const file = buildRegrips(buildPng(options));
			expect(await prgImageFormat.detect(sourceOf(file), "A.prg")).toBe(false);
			await expect(extract(file)).rejects.toThrow();
		}
	});

	it("reads the places of the picture the graphic holds", async () => {
		// A whole portable network graphic, of the four places of a colour a place, so the walk of the graphic
		// reads its places and the walk of the bitmap hands them over as a bitmap of its own.
		const rows = [
			Array.from({ length: 3 * 4 }, (_, at) => (at * 7 + 3) & 0xff),
			Array.from({ length: 3 * 4 }, (_, at) => (at * 11 + 5) & 0xff),
		];
		const png = pngFile({ width: 3, height: 2, colourType: 6, rows });
		const output = await extract(buildRegrips(png));
		const picture = readBmpImage(output);
		const expected = await readPngImage(png);
		expect(picture).toMatchObject({
			width: 3,
			height: 2,
			bitsPerPixel: 32,
		});
		expect(expected).not.toBeUndefined();
		expect([...(picture?.pixels ?? [])]).toEqual([...(expected?.pixels ?? [])]);
	});

	it("names the entry after the graphic and knows the size", async () => {
		const archive = await prgImageFormat.open(
			sourceOf(buildRegrips(buildPng())),
			"sub/CG_07.prg",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_07.png");
			expect(archive.entries[0]?.sizeKnown).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "png",
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
	});

	it("needs a complete header before it accepts a file", async () => {
		const png = buildPng({ tail: false });
		expect(png.length).toBe(33);
		expect(
			await prgImageFormat.detect(sourceOf(buildRegrips(png)), "A.prg"),
		).toBe(true);
		// The fields end at offset twenty nine, so anything shorter cannot be read.
		const short = buildRegrips(png).subarray(0, 28);
		expect(await prgImageFormat.detect(sourceOf(short), "A.prg")).toBe(false);
		await expect(extract(short)).rejects.toThrow();
	});
});
