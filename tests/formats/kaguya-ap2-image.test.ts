import { BufferByteSource } from "@garbro-mcp/core";
import { ap2ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const METADATA_SIZE = 0x14;
const DATA_OFFSET = 0x18;
const BMP_HEADER_SIZE = 54;

interface Ap2Options {
	width?: number;
	height?: number;
	offsetX?: number;
	offsetY?: number;
	pixels?: Buffer;
	/** The four bytes at 0x14, which the reference never reads. */
	gap?: number;
	trailing?: number;
}

function buildAp2(options: Ap2Options = {}): Buffer {
	const { width = 2, height = 2 } = options;
	const header: Buffer = Buffer.alloc(DATA_OFFSET, 0x00);
	header.write("AP-2", 0, "latin1");
	header.writeInt32LE(options.offsetX ?? 0, 4);
	header.writeInt32LE(options.offsetY ?? 0, 8);
	header.writeUInt32LE(width, 0x0c);
	header.writeUInt32LE(height, 0x10);
	header.fill(options.gap ?? 0, 0x14, DATA_OFFSET);
	const pixels =
		options.pixels ??
		Buffer.from(
			Array.from({ length: width * height * 4 }, (_x, i) => (i + 1) & 0xff),
		);
	const file = Buffer.concat([header, pixels]);
	return options.trailing
		? Buffer.concat([file, Buffer.alloc(options.trailing, 0x5a)])
		: file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_001.ALP"): Promise<Buffer> {
	const archive = await ap2ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("kaguya ap-2 image", () => {
	it("registers the four byte signature and the alp extension", () => {
		expect(ap2ImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x41, 0x50, 0x2d, 0x32]) },
		]);
		expect(ap2ImageFormat.descriptor.extensions).toEqual(["alp"]);
	});

	it("reads a signed origin and thirty two bit pixels without reversing them", async () => {
		const file = buildAp2({ offsetX: 12, offsetY: -8 });
		const source = sourceOf(file);
		expect(await ap2ImageFormat.detect(source, "CG_001.ALP")).toBe(true);
		const archive = await ap2ImageFormat.open(source, "CG_001.ALP");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"CG_001.bmp",
			]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
				offsetX: 12,
				offsetY: -8,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(32);
		// `CreateFlipped`: a positive height and the pixels in storage order.
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([
				0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
				0x0d, 0x0e, 0x0f, 0x10,
			]),
		);
	});

	it("never reads the four bytes before the pixels", async () => {
		// The metadata read ends at 0x14 and the pixels start at 0x18, so whatever sits between them is
		// invisible — a fact worth pinning, since a friendlier reader might treat it as a field.
		const zeros = await extract(buildAp2({ gap: 0x00 }));
		const junk = await extract(buildAp2({ gap: 0xa5 }));
		expect(junk).toEqual(zeros);
	});

	it("fails on extraction when the pixel stream is short", async () => {
		const file = buildAp2();
		const truncated = file.subarray(0, file.length - 1);
		expect(await ap2ImageFormat.detect(sourceOf(truncated), "A.ALP")).toBe(
			true,
		);
		const archive = await ap2ImageFormat.open(sourceOf(truncated), "A.ALP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("ignores bytes after the pixels and accepts a bare metadata header when empty", async () => {
		expect(await extract(buildAp2({ trailing: 8 }))).toEqual(
			await extract(buildAp2()),
		);
		// Zero dimensions mean a zero length read, so a file of exactly the metadata size is complete.
		const empty = buildAp2({ width: 0, height: 0, pixels: Buffer.alloc(0) });
		expect((await extract(empty)).length).toBe(BMP_HEADER_SIZE);
	});

	it("applies the dimension ceiling but not a zero check", async () => {
		expect(
			await ap2ImageFormat.detect(
				sourceOf(buildAp2({ width: 0x8001 })),
				"A.ALP",
			),
		).toBe(false);
		expect(
			await ap2ImageFormat.detect(
				sourceOf(buildAp2({ height: 0x8001 })),
				"A.ALP",
			),
		).toBe(false);
		expect(
			await ap2ImageFormat.detect(
				sourceOf(buildAp2({ width: 0, height: 0, pixels: Buffer.alloc(0) })),
				"A.ALP",
			),
		).toBe(true);
		// The metadata read is twenty bytes long, so anything shorter is declined.
		expect(
			await ap2ImageFormat.detect(
				sourceOf(Buffer.alloc(METADATA_SIZE - 1)),
				"A.ALP",
			),
		).toBe(false);
	});
});
