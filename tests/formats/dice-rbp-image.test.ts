import { BufferByteSource } from "@garbro-mcp/core";
import { rbpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x14;

interface RbpOptions {
	width?: number;
	height?: number;
	depth?: number;
	dataOffset?: number;
	marker?: string;
	headerSize?: number;
	body?: Buffer;
	/** Bytes to place between the header and the pixels. */
	gap?: number;
}

function buildRbp(options: RbpOptions = {}): Buffer {
	const header: Buffer = Buffer.alloc(options.headerSize ?? HEADER_SIZE, 0x00);
	header.write(options.marker ?? "RBP1", 0, "latin1");
	const gap = options.gap ?? 0;
	if (header.length >= HEADER_SIZE) {
		header.writeInt32LE(options.depth ?? 1, 4);
		header.writeUInt32LE(options.width ?? 4, 8);
		header.writeUInt32LE(options.height ?? 1, 0x0c);
		header.writeInt32LE(options.dataOffset ?? HEADER_SIZE + gap, 0x10);
	}
	return Buffer.concat([
		header,
		Buffer.alloc(gap, 0x00),
		options.body ?? Buffer.alloc(0),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.rbp"): Promise<Buffer> {
	const archive = await rbpImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Dice image", () => {
	it("needs the marker and a header that fits", async () => {
		expect(await rbpImageFormat.detect(sourceOf(buildRbp()), "A.rbp")).toBe(
			true,
		);
		expect(
			await rbpImageFormat.detect(
				sourceOf(buildRbp({ marker: "RBP2" })),
				"A.rbp",
			),
		).toBe(false);
		expect(
			await rbpImageFormat.detect(
				sourceOf(buildRbp({ headerSize: 0x10 })),
				"A.rbp",
			),
		).toBe(false);
	});

	it("takes a depth word of one as twenty four bits", async () => {
		for (const depth of [1]) {
			const archive = await rbpImageFormat.open(
				sourceOf(buildRbp({ depth })),
				"A.rbp",
			);
			try {
				expect(archive.metadata).toMatchObject({ bitsPerPixel: 24 });
			} finally {
				await archive.close();
			}
		}
		for (const depth of [0, 2, -1, 0x100]) {
			const archive = await rbpImageFormat.open(
				sourceOf(buildRbp({ depth })),
				"A.rbp",
			);
			try {
				expect(archive.metadata).toMatchObject({ bitsPerPixel: 32 });
			} finally {
				await archive.close();
			}
		}
	});

	it("expands the five bit channels and the six bit alpha", async () => {
		// One word a pixel, little endian, with five bits a channel and six bits of alpha above them.
		const body: Buffer = Buffer.from([
			0x1f, 0x1f, 0x1f, 0xff, 0xff, 0xff, 0x3f, 0x3f, 0x3f, 0x0f, 0x1e, 0x3d,
		]);
		const output = await extract(buildRbp({ width: 4, height: 1, body }));
		expect(output.readUInt16LE(28)).toBe(32);
		// The reference hands this image over unflipped.
		expect(output.readInt32LE(22)).toBe(-1);
		expect(output.subarray(54)).toEqual(
			Buffer.from([
				0xf8, 0xe0, 0x18, 0x7d, 0xf8, 0xfc, 0xf8, 0x08, 0xf8, 0xe4, 0x38, 0xff,
				0x78, 0xc0, 0x18, 0xf6,
			]),
		);
	});

	it("scales a stored alpha plane from six bits", async () => {
		const body: Buffer = Buffer.from([
			0x11, 0x22, 0x33, 0x00, 0x44, 0x55, 0x66, 0x01, 0x77, 0x88, 0x99, 0x20,
			0xaa, 0xbb, 0xcc, 0x3f,
		]);
		const output = await extract(
			buildRbp({ depth: 0, width: 4, height: 1, body }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(54)).toEqual(
			Buffer.from([
				0x11, 0x22, 0x33, 0x00, 0x44, 0x55, 0x66, 0x04, 0x77, 0x88, 0x99, 0x81,
				0xaa, 0xbb, 0xcc, 0xff,
			]),
		);
	});

	it("starts reading where the header says", async () => {
		const body: Buffer = Buffer.from([0x00, 0x00, 0x00]);
		const output = await extract(
			buildRbp({ width: 1, height: 1, gap: 12, body }),
		);
		expect(output.subarray(54)).toEqual(Buffer.from([0x00, 0x00, 0x00, 0x00]));
	});

	it("fails on a short colour plane but blanks a short alpha plane", async () => {
		// Three bytes are missing from the colour plane, which the reference's reader would hit.
		const short = buildRbp({
			width: 4,
			height: 1,
			body: Buffer.alloc(9, 0x00),
		});
		expect(await rbpImageFormat.detect(sourceOf(short), "A.rbp")).toBe(true);
		await expect(extract(short)).rejects.toThrow();
		// The thirty two bit branch reads what it can and leaves the rest blank.
		const blunted = buildRbp({
			depth: 4,
			width: 2,
			height: 1,
			body: Buffer.alloc(2, 0x7f),
		});
		const output = await extract(blunted);
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x7f, 0x7f, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]),
		);
	});

	it("refuses an offset outside the file, and lists its entry", async () => {
		for (const dataOffset of [-4, 0x8000]) {
			const file = buildRbp({ dataOffset });
			expect(await rbpImageFormat.detect(sourceOf(file), "A.rbp")).toBe(true);
			await expect(extract(file)).rejects.toThrow();
		}
		const file = buildRbp({ width: 2, height: 2 });
		const archive = await rbpImageFormat.open(sourceOf(file), "sub/CG_04.rbp");
		try {
			const entry = archive.entries[0];
			expect(entry?.path).toBe("CG_04.bmp");
			expect(entry?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
