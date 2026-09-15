import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { amaterasuGrpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE_BYTES = Buffer.from([0x47, 0x52, 0x50, 0x00]);
const HEADER_SIZE = 12;
const BMP_HEADER_SIZE = 54;

interface GrpOptions {
	width?: number;
	height?: number;
	offsetX?: number;
	offsetY?: number;
	/** The picture, four bytes to the pixel, the first row of the file being the bottom one. */
	pixels?: Buffer;
	/** Bytes behind the picture, which the reference never reads. */
	tail?: Buffer;
	/** Writes the header itself, for a file that is not this format's. */
	header?: (header: Buffer) => void;
}

function buildGrpFile(options: GrpOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const pixels =
		options.pixels ?? Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1));
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE_BYTES.copy(header, 0);
	header.writeInt16LE(options.offsetX ?? 0, 4);
	header.writeInt16LE(options.offsetY ?? 0, 6);
	header.writeUInt16LE(width, 8);
	header.writeUInt16LE(height, 10);
	options.header?.(header);
	return Buffer.concat([header, pixels, options.tail ?? Buffer.alloc(0)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer): Promise<Buffer> {
	const archive = await amaterasuGrpImageFormat.open(
		sourceOf(file),
		"CG01.grp",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The four bytes of a pixel of a picture that needs no row padding. */
function pixelAt(bmp: Buffer, x: number, y: number, width: number): number[] {
	const offset = BMP_HEADER_SIZE + (y * width + x) * 4;
	return [
		bmp[offset] ?? 0,
		bmp[offset + 1] ?? 0,
		bmp[offset + 2] ?? 0,
		bmp[offset + 3] ?? 0,
	];
}

describe("Amaterasu GRP image", () => {
	it("takes a file of its signature and refuses the rest", async () => {
		expect(amaterasuGrpImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE_BYTES },
		]);
		expect(
			await amaterasuGrpImageFormat.detect(sourceOf(buildGrpFile()), "a.grp"),
		).toBe(true);
		// A file of no measurements is still this format's: the reference checks nothing in its header, and the
		// picture itself is what fails to be built.
		expect(
			await amaterasuGrpImageFormat.detect(
				sourceOf(
					buildGrpFile({ width: 0, height: 0, pixels: Buffer.alloc(0) }),
				),
				"a.grp",
			),
		).toBe(true);
		expect(
			await amaterasuGrpImageFormat.detect(
				sourceOf(
					buildGrpFile({
						header: (header) => header.write("GRA", 0, "latin1"),
					}),
				),
				"a.grp",
			),
		).toBe(false);
		expect(
			await amaterasuGrpImageFormat.detect(
				sourceOf(buildGrpFile({ header: (h) => h.writeUInt8(1, 3) })),
				"a.grp",
			),
		).toBe(false);
		expect(
			await amaterasuGrpImageFormat.detect(sourceOf(Buffer.alloc(8)), "a.grp"),
		).toBe(false);
	});

	it("turns a bottom up picture into a top down bitmap", async () => {
		const file = buildGrpFile({
			offsetX: -2,
			offsetY: 11,
			pixels: Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1)),
		});
		const archive = await amaterasuGrpImageFormat.open(
			sourceOf(file),
			"CG01.grp",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
				offsetX: -2,
				offsetY: 11,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "none",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(32);
		// The reference reads the rows of the file from the last one to the first.
		expect(bmp.readInt32LE(22)).toBe(-2);
		expect(pixelAt(bmp, 0, 0, 2)).toEqual([9, 10, 11, 12]);
		expect(pixelAt(bmp, 1, 0, 2)).toEqual([13, 14, 15, 16]);
		expect(pixelAt(bmp, 0, 1, 2)).toEqual([1, 2, 3, 4]);
		expect(pixelAt(bmp, 1, 1, 2)).toEqual([5, 6, 7, 8]);
	});

	it("stops when the picture is not all there", async () => {
		const file = buildGrpFile({ pixels: Buffer.alloc(15, 0x33) });
		const archive = await amaterasuGrpImageFormat.open(
			sourceOf(file),
			"CG01.grp",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Truncated Amaterasu GRP image",
			});
		} finally {
			await archive.close();
		}
	});

	it("never reads behind the picture", async () => {
		const file = buildGrpFile({
			pixels: Buffer.from(Array.from({ length: 16 }, (_, i) => i + 1)),
			tail: Buffer.alloc(32, 0xff),
		});
		const bmp = await extract(file);
		expect(bmp.length).toBe(BMP_HEADER_SIZE + 16);
		expect(pixelAt(bmp, 1, 1, 2)).toEqual([5, 6, 7, 8]);
	});

	it("refuses a picture of no pixels", async () => {
		const file = buildGrpFile({ width: 0, height: 0, pixels: Buffer.alloc(0) });
		const archive = await amaterasuGrpImageFormat.open(
			sourceOf(file),
			"CG01.grp",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "UNSUPPORTED_FEATURE",
				message: "Unsupported Amaterasu GRP image size 0x0",
			});
		} finally {
			await archive.close();
		}
	});

	it("refuses a picture larger than it will hold", async () => {
		const file = buildGrpFile({
			width: 0xffff,
			height: 0xffff,
			pixels: Buffer.alloc(16, 0x00),
		});
		const archive = await amaterasuGrpImageFormat.open(
			sourceOf(file),
			"CG01.grp",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "LIMIT_EXCEEDED",
			});
		} finally {
			await archive.close();
		}
	});
});
