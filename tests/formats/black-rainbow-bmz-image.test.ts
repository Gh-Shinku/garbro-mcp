import { deflateSync } from "node:zlib";
import { BufferByteSource } from "@garbro-mcp/core";
import { bmzImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x5a, 0x4c, 0x43, 0x33]);
const HEADER_SIZE = 8;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;

const WIDTH = 4;
const HEIGHT = 2;
const STRIDE = 4;

function buildBmp(tail = 0): Buffer {
	const fileSize = DATA_OFFSET + STRIDE * HEIGHT;
	const bmp: Buffer = Buffer.alloc(fileSize + tail, 0x00);
	bmp.write("BM", 0, "latin1");
	bmp.writeUInt32LE(fileSize, 2);
	bmp.writeUInt32LE(DATA_OFFSET, 10);
	bmp.writeUInt32LE(40, 14);
	bmp.writeInt32LE(WIDTH, 18);
	bmp.writeInt32LE(HEIGHT, 22);
	bmp.writeUInt16LE(1, 26);
	bmp.writeUInt16LE(8, 28);
	bmp.writeUInt32LE(STRIDE * HEIGHT, 34);
	for (let i = 0; i < 256; i += 1) {
		bmp[BMP_HEADER_SIZE + i * 4] = i;
		bmp[BMP_HEADER_SIZE + i * 4 + 1] = (i * 5) & 0xff;
		bmp[BMP_HEADER_SIZE + i * 4 + 2] = (i * 11) & 0xff;
	}
	for (let i = 0; i < STRIDE * HEIGHT; i += 1)
		bmp[DATA_OFFSET + i] = (i * 27 + 5) & 0xff;
	for (let i = 0; i < tail; i += 1) bmp[fileSize + i] = 0x6b;
	return bmp;
}

function buildBmz(bmp = buildBmp(), declaredSize?: number): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(declaredSize ?? bmp.length, 4);
	return Buffer.concat([header, deflateSync(bmp)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("black rainbow bmz image", () => {
	it("declares the ZLC3 signature", () => {
		expect(bmzImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("ZLC3");
	});

	it("inflates a bitmap", async () => {
		const bmp = buildBmp();
		const stored = buildBmz(bmp);
		const source = sourceOf(stored);
		expect(await bmzImageFormat.detect(source, "CG01.BMZ")).toBe(true);
		const archive = await bmzImageFormat.open(source, "CG01.BMZ");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "zlib",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
				declaredSize: bmp.length,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(bmp);
		} finally {
			await archive.close();
		}
	});

	it("ignores the size word in the header", async () => {
		// The reference reads the header and never consults the size, so a wrong value changes nothing.
		const bmp = buildBmp();
		const stored = buildBmz(bmp, 0xdeadbeef);
		expect(stored.readUInt32LE(4)).toBe(0xdeadbeef);
		const archive = await bmzImageFormat.open(sourceOf(stored), "CG01.BMZ");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				bmp,
			);
			expect(archive.metadata).toMatchObject({ declaredSize: 0xdeadbeef });
		} finally {
			await archive.close();
		}
	});

	it("trims data past the declared bitmap size", async () => {
		const bmp = buildBmp(24);
		const stored = buildBmz(bmp);
		const archive = await bmzImageFormat.open(sourceOf(stored), "CG01.BMZ");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(bmp.length - 24);
			expect(output).toEqual(bmp.subarray(0, bmp.length - 24));
		} finally {
			await archive.close();
		}
	});

	it("declines a payload that is not a bitmap", async () => {
		const bmp = buildBmp();
		const header = buildBmz(bmp).subarray(0, HEADER_SIZE);
		const stored = Buffer.concat([
			header,
			deflateSync(Buffer.from("not a bitmap at all", "latin1")),
		]);
		expect(await bmzImageFormat.detect(sourceOf(stored), "CG01.BMZ")).toBe(
			false,
		);
	});

	it("declines a corrupted stream, a wrong signature and a short header", async () => {
		const corrupted = buildBmz();
		corrupted[HEADER_SIZE + 3] = (corrupted[HEADER_SIZE + 3] ?? 0) ^ 0xff;
		expect(await bmzImageFormat.detect(sourceOf(corrupted), "CG01.BMZ")).toBe(
			false,
		);
		const wrong = buildBmz();
		wrong[0] = 0x59;
		expect(await bmzImageFormat.detect(sourceOf(wrong), "CG01.BMZ")).toBe(
			false,
		);
		expect(
			await bmzImageFormat.detect(
				sourceOf(buildBmz().subarray(0, HEADER_SIZE - 1)),
				"CG01.BMZ",
			),
		).toBe(false);
	});

	it("declines zero dimensions", async () => {
		// A zero sized bitmap is accepted by the metadata helper but describes nothing.
		const bmp = buildBmp();
		bmp.writeInt32LE(0, 18);
		const stored = buildBmz(bmp);
		expect(await bmzImageFormat.detect(sourceOf(stored), "CG01.BMZ")).toBe(
			false,
		);
	});
});
