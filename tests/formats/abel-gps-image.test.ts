import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	abelGpsImageFormat,
	readGpsHeader,
	unpackGpsRle,
} from "../../packages/formats/src/abel/gps-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

/** Packs a stream of literals, which is all the reference's own LZSS reader has to unfold. */
function lzssLiterals(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const group = data.subarray(start, start + 8);
		chunks.push(Buffer.from([0xff]), group);
	}
	return Buffer.concat(chunks);
}

/** Packs a stream of whole three byte units, each followed by a control of nothing. */
function rleEncode(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let i = 0; i + 3 <= data.length; i += 3) {
		chunks.push(data.subarray(i, i + 3), Buffer.from([0]));
	}
	return Buffer.concat(chunks);
}

/** A three by one bitmap, whose length is a whole number of run length units. */
function bitmap(): Buffer {
	return writeBmp24(3, 1, Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]));
}

interface GpsOptions {
	compression?: number;
	marker?: number;
	gp2?: boolean;
	unpackedSize?: number;
}

/** A file: the full head of forty one bytes, then the packed bitmap. */
function gpsFile(payload: Buffer, options: GpsOptions = {}): Buffer {
	const head = Buffer.alloc(0x29);
	head.write(options.gp2 ? "GP2" : "GPS", 0, "latin1");
	head.writeUInt32LE(options.marker ?? 0, 4);
	head[0x10] = options.compression ?? 0;
	head.writeInt32LE(options.unpackedSize ?? bitmap().length, 0x11);
	head.writeInt32LE(payload.length, 0x15);
	head.writeUInt32LE(3, 0x19);
	head.writeUInt32LE(1, 0x1d);
	return Buffer.concat([head, payload]);
}

/** A file whose word at four is the marker: a short head of twenty five bytes and an LZSS stream. */
function shortGpsFile(payload: Buffer, options: GpsOptions = {}): Buffer {
	const head = Buffer.alloc(0x19);
	head.write("GPS", 0, "latin1");
	head.writeUInt32LE(0xcccccccc, 4);
	head.writeInt32LE(options.unpackedSize ?? bitmap().length, 9);
	head.writeInt32LE(payload.length, 0x0d);
	return Buffer.concat([head, payload]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await abelGpsImageFormat.open(
		new BufferByteSource(data),
		"pic.gps",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("ADVEngine compressed bitmap", () => {
	it("reads the head as the reference does", () => {
		expect(readGpsHeader(gpsFile(bitmap(), { compression: 2 }))).toEqual({
			headerSize: 0x29,
			compression: 2,
			unpackedSize: 66,
			packedSize: 66,
		});
		// The short head is always the plain LZSS stream.
		expect(readGpsHeader(shortGpsFile(bitmap()))).toEqual({
			headerSize: 0x19,
			compression: 2,
			unpackedSize: 66,
			packedSize: 66,
		});
		// The second kind keeps its unpacked size negated.
		expect(
			readGpsHeader(gpsFile(bitmap(), { gp2: true, unpackedSize: -67 }))
				?.unpackedSize,
		).toBe(66);
	});

	it("finds each kind of packing", async () => {
		const bmp = bitmap();
		const plain = gpsFile(bmp, { compression: 0 });
		const rle = gpsFile(rleEncode(bmp), { compression: 1 });
		const lzss = gpsFile(lzssLiterals(bmp), { compression: 2 });
		const lzssRle = gpsFile(lzssLiterals(rleEncode(bmp)), { compression: 3 });
		const short = shortGpsFile(lzssLiterals(bmp));
		for (const data of [plain, rle, lzss, lzssRle, short]) {
			expect(
				await abelGpsImageFormat.detect(new BufferByteSource(data), "pic.gps"),
			).toBe(true);
		}
		// A file that is not signed is refused.
		const wrong = Buffer.from(plain);
		wrong.write("XXX", 0, "latin1");
		expect(
			await abelGpsImageFormat.detect(new BufferByteSource(wrong), "pic.gps"),
		).toBe(false);
		// And so is one whose packed stream does not hold a bitmap.
		const empty = gpsFile(Buffer.alloc(0), { compression: 0 });
		expect(
			await abelGpsImageFormat.detect(new BufferByteSource(empty), "pic.gps"),
		).toBe(false);
	});

	it("reports the measurements of the bitmap behind the packing", async () => {
		const data = gpsFile(bitmap(), { compression: 0 });
		const handle = await abelGpsImageFormat.open(
			new BufferByteSource(data),
			"dir/pic.gps",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 3,
			height: 1,
			bitsPerPixel: 24,
			compression: 0,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			packing: 0,
		});
	});

	it("unfolds the bitmap again for every kind of packing", async () => {
		const bmp = bitmap();
		const cases = [
			gpsFile(bmp, { compression: 0 }),
			gpsFile(rleEncode(bmp), { compression: 1 }),
			gpsFile(lzssLiterals(bmp), { compression: 2 }),
			gpsFile(lzssLiterals(rleEncode(bmp)), { compression: 3 }),
			shortGpsFile(lzssLiterals(bmp)),
		];
		for (const data of cases) {
			expect((await extract(data)).equals(bmp)).toBe(true);
		}
	});

	it("reads a run length unit and the copy behind it", () => {
		// One unit of three bytes and a control of three, which adds six bytes of a copy that repeats itself.
		const out = unpackGpsRle(Buffer.from([0xaa, 0xbb, 0xcc, 0x03]), 9);
		expect(out.toString("hex")).toBe("aabbccaabbccaabbcc");
		// A control of nothing leaves the unit to stand on its own.
		expect(
			unpackGpsRle(Buffer.from([1, 2, 3, 0, 4, 5, 6, 0]), 6).toString("hex"),
		).toBe("010203040506");
		// A stream that stops inside a unit ends the walk.
		expect(unpackGpsRle(Buffer.from([1, 2]), 9).toString("hex")).toBe(
			"010200000000000000",
		);
	});

	it("declines a file whose bitmap is not a bitmap", async () => {
		const data = gpsFile(Buffer.from("not a bitmap"), { compression: 0 });
		expect(
			await abelGpsImageFormat.detect(new BufferByteSource(data), "pic.gps"),
		).toBe(false);
		await expect(
			abelGpsImageFormat.open(new BufferByteSource(data), "pic.gps"),
		).rejects.toThrow(GarbroError);
		await expect(
			abelGpsImageFormat.open(new BufferByteSource(data), "pic.gps"),
		).rejects.toThrow("Not an ADVEngine bitmap");
	});
});
