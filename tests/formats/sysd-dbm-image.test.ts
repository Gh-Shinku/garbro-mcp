import { BufferByteSource } from "@garbro-mcp/core";
import { dbmImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x18;
const DATA_OFFSET = 0x21;
const BMP_HEADER_SIZE = 54;

/** A literal only LZSS stream: every control bit set, then the bytes. */
function lzssLiterals(data: Buffer): Buffer {
	const out: number[] = [];
	for (let i = 0; i < data.length; i += 8) {
		out.push(0xff);
		for (let j = i; j < Math.min(i + 8, data.length); j += 1) {
			out.push(data[j] ?? 0);
		}
	}
	return Buffer.from(out);
}

interface DbmOptions {
	version?: number;
	width?: number;
	height?: number;
	packed?: boolean;
	pixels?: Buffer;
	unpackedSize?: number;
	/** Overrides the size word at offset 4, which normally has to match the file. */
	fileSize?: number;
}

function buildDbm(options: DbmOptions = {}): Buffer {
	const {
		version = 0x00,
		width = 2,
		height = 2,
		packed = false,
		pixels = Buffer.alloc(width * height * 3, 0x40),
	} = options;
	const stored = packed ? lzssLiterals(pixels) : pixels;
	const unpackedSize = options.unpackedSize ?? pixels.length;
	const header: Buffer = Buffer.alloc(DATA_OFFSET, 0x00);
	header[0] = 0x44;
	header[1] = 0x4d;
	header[2] = version;
	header.writeUInt16LE(width, 0x0a);
	header.writeUInt16LE(height, 0x0c);
	header[0x18] = packed ? 0x01 : 0x00;
	header.writeInt32LE(stored.length + 9, 0x19);
	header.writeInt32LE(unpackedSize, 0x1d);
	const file = Buffer.concat([header, stored]);
	file.writeUInt32LE(options.fileSize ?? file.length, 4);
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer, name = "IMAGE.DBM"): Promise<Buffer> {
	const archive = await dbmImageFormat.open(sourceOf(stored), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

function body(output: Buffer): Buffer {
	return output.subarray(BMP_HEADER_SIZE);
}

describe("sysd dbm bitmap", () => {
	it("registers the marker with three version bytes", () => {
		expect(
			dbmImageFormat.detection?.signatures?.map((signature) =>
				Buffer.from(signature.bytes).toString("hex"),
			),
		).toEqual(["444d00", "444d01", "444d04"]);
	});

	it("declines a version byte outside the three registered ones", async () => {
		// The dispatcher gates on the signatures, so a direct call has to check the marker itself.
		for (const version of [0x02, 0x03, 0x05, 0xff]) {
			const stored = buildDbm({ version });
			expect(await dbmImageFormat.detect(sourceOf(stored), "IMAGE.DBM")).toBe(
				false,
			);
		}
		const accepted = buildDbm({ version: 0x04 });
		expect(await dbmImageFormat.detect(sourceOf(accepted), "IMAGE.DBM")).toBe(
			true,
		);
	});

	it("requires the size word to account for the whole file", async () => {
		const stored = buildDbm({ fileSize: 0x1000 });
		expect(await dbmImageFormat.detect(sourceOf(stored), "IMAGE.DBM")).toBe(
			false,
		);
	});

	it("copies an unpacked image and pads its rows", async () => {
		// Three pixels a row is nine bytes, which needs three bytes of padding to reach a bitmap's stride.
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
			0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12,
		]);
		const stored = buildDbm({ width: 3, height: 2, pixels });
		const source = sourceOf(stored);
		const archive = await dbmImageFormat.open(source, "IMAGE.DBM");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["IMAGE.bmp"]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(24);
		// `CreateFlipped` is a bitmap's own convention: a positive height.
		expect(output.readInt32LE(22)).toBe(2);
		expect(body(output)).toEqual(
			Buffer.from([
				0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x00, 0x00, 0x00,
				0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x00, 0x00, 0x00,
			]),
		);
	});

	it("decompresses a packed image", async () => {
		const pixels = Buffer.from([
			0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x29,
		]);
		const packed = buildDbm({ width: 3, height: 1, packed: true, pixels });
		const unpacked = buildDbm({ width: 3, height: 1, pixels });
		expect(body(await extract(packed))).toEqual(body(await extract(unpacked)));
	});

	it("leaves the tail transparent when the stream is short", async () => {
		// The reference allocates the buffer from the header and reads into it, so a short stream is not an
		// error: whatever is missing stays zeroed. Four of six pixels arrive, packed and raw alike.
		const wanted = 6;
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x0b, 0x0c,
		]);
		const raw = buildDbm({
			width: 3,
			height: 2,
			pixels,
			unpackedSize: wanted * 3,
		});
		const packed = buildDbm({
			width: 3,
			height: 2,
			packed: true,
			pixels,
			unpackedSize: wanted * 3,
		});
		// Two rows of three pixels: the three pixels that arrived, then zeros — with the row padding a bitmap
		// wants, so nine bytes a row becomes twelve.
		expect(body(await extract(raw))).toEqual(
			Buffer.from([
				0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x00, 0x00, 0x00,
				0x0a, 0x0b, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			]),
		);
		expect(body(await extract(packed))).toEqual(body(await extract(raw)));
	});

	it("accepts an empty bitmap and declines files that are too short", async () => {
		const empty = buildDbm({ width: 0, height: 0, pixels: Buffer.alloc(0) });
		expect(await dbmImageFormat.detect(sourceOf(empty), "IMAGE.DBM")).toBe(
			true,
		);
		expect((await extract(empty)).length).toBe(BMP_HEADER_SIZE);
		expect(
			await dbmImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1)),
				"IMAGE.DBM",
			),
		).toBe(false);
		// A file whose size word agrees with its length but which stops before the pixel header still lists,
		// because the metadata read needs only twenty four bytes, and fails on extraction.
		const truncated: Buffer = Buffer.alloc(HEADER_SIZE + 1, 0x00);
		truncated[0] = 0x44;
		truncated[1] = 0x4d;
		truncated.writeUInt16LE(2, 0x0a);
		truncated.writeUInt16LE(2, 0x0c);
		truncated.writeUInt32LE(truncated.length, 4);
		expect(await dbmImageFormat.detect(sourceOf(truncated), "IMAGE.DBM")).toBe(
			true,
		);
		const archive = await dbmImageFormat.open(sourceOf(truncated), "IMAGE.DBM");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});
});
