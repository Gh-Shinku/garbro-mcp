import { BufferByteSource } from "@garbro-mcp/core";
import { kslImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x4b, 0x53, 0x4c, 0x4d]);
const HEADER_SIZE = 0x14;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const BMP_DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;

const WIDTH = 3;
const HEIGHT = 2;
const STRIDE = 4;
const KEY_BYTES = [0x5a, 0xa5] as const;
const KEY = KEY_BYTES[0] ^ KEY_BYTES[1];

function buildPlain(width = WIDTH, height = HEIGHT): Buffer {
	const plain: Buffer = Buffer.alloc(width * height);
	for (let i = 0; i < plain.length; i += 1) plain[i] = (i * 41 + 7) & 0xff;
	return plain;
}

function buildKsl(options: {
	keyBytes?: number[];
	plain?: Buffer;
	width?: number;
	height?: number;
	dataLength?: number;
	tail?: number;
}): Buffer {
	const keyBytes = options.keyBytes ?? KEY_BYTES;
	const width = options.width ?? WIDTH;
	const height = options.height ?? HEIGHT;
	const plain = options.plain ?? buildPlain(width, height);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header[4] = keyBytes[0] ?? 0;
	header[5] = keyBytes[1] ?? 0;
	header.writeInt32LE(options.dataLength ?? plain.length, 8);
	header.writeUInt32LE(width, 0x0c);
	header.writeUInt32LE(height, 0x10);
	const key = (keyBytes[0] ?? 0) ^ (keyBytes[1] ?? 0);
	const masked = Buffer.from(plain);
	for (let i = 0; i < masked.length; i += 1) masked[i] = (masked[i] ?? 0) ^ key;
	return Buffer.concat([header, masked, Buffer.alloc(options.tail ?? 0, 0x99)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("kscript ksl image", () => {
	it("declares the KSLM signature", () => {
		expect(kslImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("KSLM");
	});

	it("unmasks a gray image", async () => {
		const plain = buildPlain();
		const stored = buildKsl({ plain });
		const source = sourceOf(stored);
		expect(await kslImageFormat.detect(source, "CG01.KSL")).toBe(true);
		const archive = await kslImageFormat.open(source, "CG01.KSL");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 8,
				encrypted: true,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(8);
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			expect(output.length).toBe(BMP_DATA_OFFSET + STRIDE * HEIGHT);
			const body = output.subarray(BMP_DATA_OFFSET);
			for (let row = 0; row < HEIGHT; row += 1) {
				expect(body.subarray(row * STRIDE, row * STRIDE + WIDTH)).toEqual(
					plain.subarray(row * WIDTH, (row + 1) * WIDTH),
				);
				expect(body.subarray(row * STRIDE + WIDTH, (row + 1) * STRIDE)).toEqual(
					Buffer.alloc(STRIDE - WIDTH),
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("derives the key from the exclusive or of two header bytes", async () => {
		// A different byte pair with the same exclusive or has to produce the same image.
		const plain = buildPlain();
		const first = buildKsl({ plain });
		const second = buildKsl({ plain, keyBytes: [0x00, KEY] });
		expect(KEY).toBe(0xff);
		const a = await kslImageFormat.open(sourceOf(first), "CG01.KSL");
		const b = await kslImageFormat.open(sourceOf(second), "CG01.KSL");
		try {
			const entryA = a.entries[0];
			const entryB = b.entries[0];
			if (!entryA || !entryB) throw new Error("missing entry");
			const outA = await consumeBuffer(await a.openEntry(entryA.id));
			const outB = await consumeBuffer(await b.openEntry(entryB.id));
			expect(outA).toEqual(outB);
		} finally {
			await a.close();
			await b.close();
		}
	});

	it("ignores payload past the image", async () => {
		// The declared length covers the six pixels plus sixteen extra bytes.
		const plain = buildPlain();
		const stored = buildKsl({ plain, dataLength: plain.length + 16, tail: 16 });
		const archive = await kslImageFormat.open(sourceOf(stored), "CG01.KSL");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(BMP_DATA_OFFSET + STRIDE * HEIGHT);
		} finally {
			await archive.close();
		}
	});

	it("lists a file with a short payload but fails to extract it", async () => {
		// `ReadBytes` throws when the stream cannot supply the declared count.
		const plain = buildPlain();
		const stored = buildKsl({ plain, dataLength: plain.length + 8 }).subarray(
			0,
			HEADER_SIZE + plain.length,
		);
		expect(await kslImageFormat.detect(sourceOf(stored), "CG01.KSL")).toBe(
			true,
		);
		const archive = await kslImageFormat.open(sourceOf(stored), "CG01.KSL");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("lists a negative declared length but fails to extract it", async () => {
		const stored = buildKsl({ plain: buildPlain(), dataLength: -1 });
		expect(await kslImageFormat.detect(sourceOf(stored), "CG01.KSL")).toBe(
			true,
		);
		const archive = await kslImageFormat.open(sourceOf(stored), "CG01.KSL");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines zero dimensions and short files", async () => {
		expect(
			await kslImageFormat.detect(
				sourceOf(buildKsl({ width: 0, plain: Buffer.alloc(0) })),
				"CG01.KSL",
			),
		).toBe(false);
		expect(
			await kslImageFormat.detect(
				sourceOf(buildKsl({ height: 0, plain: Buffer.alloc(0) })),
				"CG01.KSL",
			),
		).toBe(false);
		const short = buildKsl({}).subarray(0, HEADER_SIZE - 1);
		expect(await kslImageFormat.detect(sourceOf(short), "CG01.KSL")).toBe(
			false,
		);
	});

	it("declines a different signature", async () => {
		const stored = buildKsl({});
		stored[3] = 0x4e;
		expect(await kslImageFormat.detect(sourceOf(stored), "CG01.KSL")).toBe(
			false,
		);
	});
});
