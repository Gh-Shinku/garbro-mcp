import { BufferByteSource } from "@garbro-mcp/core";
import { kgpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x1c;
const BASE_OFFSET = 0x14;

interface KgpOptions {
	key?: number;
	marker?: string;
	/** A non-zero value makes the header carry an offset field. */
	hasOffset?: boolean;
	/** Whether the graphic is actually in the file, for headers whose offset points outside it. */
	placeRegion?: boolean;
	offsetField?: number;
	width?: number;
	height?: number;
	colourType?: number;
	depth?: number;
	headerSize?: number;
}

function chunk(type: string, body: Buffer): Buffer {
	const length: Buffer = Buffer.alloc(4);
	length.writeUInt32BE(body.length, 0);
	return Buffer.concat([
		length,
		Buffer.from(type, "latin1"),
		body,
		Buffer.alloc(4, 0xbb),
	]);
}

/** A graphic whose header the format will read once it has been xored back. */
function buildPng(options: KgpOptions = {}): Buffer {
	const ihdr: Buffer = Buffer.alloc(13, 0x00);
	ihdr.writeUInt32BE(options.width ?? 4, 0);
	ihdr.writeUInt32BE(options.height ?? 3, 4);
	ihdr[8] = options.depth ?? 8;
	ihdr[9] = options.colourType ?? 2;
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", Buffer.alloc(4, 0x78)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

/** The stored file is the graphic xored with the single byte key the header carries. */
function buildKgp(options: KgpOptions = {}): Buffer {
	const key = options.key ?? 0x5a;
	const png = buildPng(options);
	const region: Buffer = Buffer.from(png.map((x) => x ^ key));
	const header: Buffer = Buffer.alloc(options.headerSize ?? HEADER_SIZE, 0x00);
	if (header.length >= HEADER_SIZE) {
		header.write(options.marker ?? "GRPH", 0, "latin1");
		header[4] = 0x3c;
		header[5] = 0x3c ^ key;
		header.writeInt32LE(region.length, 8);
		header[0x0c] = options.hasOffset ? 1 : 0;
		header.writeInt32LE(options.offsetField ?? 0, 0x10);
		header.writeInt32LE(7, 0x14);
		header.writeInt32LE(9, 0x18);
	}
	const offset = options.hasOffset
		? BASE_OFFSET + Math.trunc((options.offsetField ?? 0) / 0x10) * 0x18
		: BASE_OFFSET;
	// The graphic begins where the header says, and at the base offset that is **inside** the header: its bytes
	// cover the last eight of the twenty eight, which the reference never reads.
	// A file whose header points outside itself holds no graphic at all, which is what the probe then sees.
	const place = options.placeRegion ?? offset >= BASE_OFFSET;
	const body: Buffer = place
		? Buffer.alloc(Math.max(header.length, offset + region.length), 0x00)
		: Buffer.alloc(header.length, 0x00);
	header.copy(body, 0);
	if (place) region.copy(body, offset);
	return body;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.kgp"): Promise<Buffer> {
	const archive = await kgpImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("KScript image", () => {
	it("needs the marker, a full header and a readable graphic behind it", async () => {
		expect(await kgpImageFormat.detect(sourceOf(buildKgp()), "A.kgp")).toBe(
			true,
		);
		for (const options of [{ marker: "GRPX" }, { headerSize: 0x18 }]) {
			expect(
				await kgpImageFormat.detect(sourceOf(buildKgp(options)), "A.kgp"),
			).toBe(false);
		}
		// A header whose bytes do not compose the key it was xored with.
		const mismatched = buildKgp({ key: 0x11 });
		mismatched[5] = 0x11 ^ 0x22;
		expect(await kgpImageFormat.detect(sourceOf(mismatched), "A.kgp")).toBe(
			false,
		);
	});

	it("starts at the header's own offset, rounded down to a multiple of sixteen", async () => {
		expect(await kgpImageFormat.detect(sourceOf(buildKgp()), "A.kgp")).toBe(
			true,
		);
		for (const [offsetField, offset] of [
			[0x10, BASE_OFFSET + 0x18],
			[0x20, BASE_OFFSET + 0x30],
			// Twenty is not a multiple of sixteen: the reference truncates before it multiplies.
			[0x14, BASE_OFFSET + 0x18],
			[0x1f, BASE_OFFSET + 0x18],
		] as [number, number][]) {
			const file = buildKgp({ hasOffset: true, offsetField });
			expect(await kgpImageFormat.detect(sourceOf(file), "A.kgp")).toBe(true);
			const output = await extract(file);
			expect(output.length).toBe(file.length - offset);
			expect(output[0]).toBe(0x89);
		}
	});

	it("refuses an offset that leaves the file", async () => {
		for (const offsetField of [-0x10, 0x800]) {
			const file = buildKgp({
				hasOffset: true,
				offsetField,
				placeRegion: false,
			});
			expect(await kgpImageFormat.detect(sourceOf(file), "A.kgp")).toBe(false);
			await expect(extract(file)).rejects.toThrow();
		}
	});

	it("reads the size and the depth out of the decrypted graphic", async () => {
		const archive = await kgpImageFormat.open(
			sourceOf(buildKgp({ width: 12, height: 7, colourType: 6 })),
			"A.kgp",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 12,
				height: 7,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "png",
				width: 12,
				height: 7,
			});
		} finally {
			await archive.close();
		}
	});

	it("hands nothing but the graphic over, decrypted", async () => {
		const file = buildKgp({ width: 3, height: 2 });
		const png = buildPng({ width: 3, height: 2 });
		const output = await extract(file);
		// The header stays behind: the entry is the region the header points at, and nothing of the junk that
		// separates the two reaches the caller.
		expect(output.equals(png)).toBe(true);
		expect(output.length).toBe(png.length);
		expect(output.length).toBeLessThan(file.length);
		expect(output.subarray(0, 8).toString("latin1")).toBe("\x89PNG\r\n\x1a\n");
		// The unreadable region before the graphic is still in the file, xored.
		expect(file.subarray(0, 4).toString("latin1")).toBe("GRPH");
	});

	it("describes the region it hands over", async () => {
		const file = buildKgp({
			hasOffset: true,
			offsetField: 0x20,
			width: 2,
			height: 2,
		});
		const archive = await kgpImageFormat.open(sourceOf(file), "sub/CG_08.kgp");
		try {
			const entry = archive.entries[0];
			expect(entry?.path).toBe("CG_08.png");
			expect(entry?.sizeKnown).toBe(true);
			// The entry runs from where the graphic starts to the end of the file, so its size is what the
			// region holds and no part of the header behind it.
			expect(entry?.size).toBe(BigInt(file.length - (BASE_OFFSET + 0x30)));
		} finally {
			await archive.close();
		}
	});
});
