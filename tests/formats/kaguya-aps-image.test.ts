import { BufferByteSource } from "@garbro-mcp/core";
import { aps3ImageFormat, apsImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const BMP_HEADER_SIZE = 54;

/** MSB first, the ordering the KaGuYa codec reads. */
class MsbWriter {
	#bytes: number[] = [];
	#current = 0;
	#bitCount = 0;

	writeBit(bit: number): void {
		this.#current = (this.#current << 1) | (bit & 1);
		this.#bitCount += 1;
		if (this.#bitCount === 8) {
			this.#bytes.push(this.#current);
			this.#current = 0;
			this.#bitCount = 0;
		}
	}

	writeBits(value: number, count: number): void {
		for (let index = count - 1; index >= 0; index -= 1) {
			this.writeBit((value >> index) & 1);
		}
	}

	finish(): Buffer {
		if (this.#bitCount > 0) {
			this.#bytes.push((this.#current << (8 - this.#bitCount)) & 0xff);
		}
		return Buffer.from(this.#bytes);
	}
}

function lzLiterals(data: Buffer): Buffer {
	const writer = new MsbWriter();
	for (const byte of data) {
		writer.writeBit(1);
		writer.writeBits(byte, 8);
	}
	return writer.finish();
}

/** An inner AP image: bottom row first, four bytes a pixel. */
function buildAp(width: number, height: number, pixels: Buffer): Buffer {
	const header: Buffer = Buffer.alloc(12, 0x00);
	header.write("AP", 0, "latin1");
	header.writeUInt32LE(width, 2);
	header.writeUInt32LE(height, 6);
	header.writeInt16LE(32, 10);
	return Buffer.concat([header, pixels]);
}

interface Tile {
	name: string;
	x: number;
	y: number;
	farX: number;
	farY: number;
}

interface ApsOptions {
	names?: string[];
	tiles?: Tile[];
	payload?: Buffer;
	/** One means the payload is packed with the KaGuYa LZ codec. */
	compression?: number;
	nameCount?: number;
	tileCount?: number;
	nameLengthOverride?: number;
}

function buildAps(options: ApsOptions = {}): Buffer {
	const names = options.names ?? ["head", "body"];
	const tiles = options.tiles ?? [
		{ name: "head", x: 10, y: 10, farX: 15, farY: 15 },
	];
	const payload = options.payload ?? buildAp(2, 2, Buffer.alloc(16, 0x33));
	const compression = options.compression ?? 0;
	const parts: Buffer[] = [];
	const count = Buffer.alloc(2, 0x00);
	count.writeInt16LE(options.nameCount ?? names.length, 0);
	parts.push(count);
	for (const name of names) {
		const encoded = Buffer.from(name, "latin1");
		const length: Buffer = Buffer.alloc(4, 0x00);
		length.writeInt32LE(options.nameLengthOverride ?? encoded.length, 0);
		parts.push(length, encoded);
	}
	const tiles2 = Buffer.alloc(2, 0x00);
	tiles2.writeInt16LE(options.tileCount ?? tiles.length, 0);
	parts.push(tiles2);
	for (const tile of tiles) {
		const encoded = Buffer.from(tile.name, "latin1");
		const length: Buffer = Buffer.alloc(4, 0x00);
		length.writeInt32LE(encoded.length, 0);
		const body: Buffer = Buffer.alloc(0x0c + 16 + 0x28, 0x00);
		body.writeInt32LE(tile.x, 0x0c);
		body.writeInt32LE(tile.y, 0x10);
		body.writeInt32LE(tile.farX, 0x14);
		body.writeInt32LE(tile.farY, 0x18);
		parts.push(length, encoded, body);
	}
	const header: Buffer = Buffer.alloc(compression === 1 ? 10 : 6, 0x00);
	header.writeInt16LE(compression, 0);
	if (compression === 1) header.writeUInt32LE(lzLiterals(payload).length, 2);
	header.writeUInt32LE(payload.length, compression === 1 ? 6 : 2);
	parts.push(header);
	parts.push(compression === 1 ? lzLiterals(payload) : payload);
	return Buffer.concat(parts);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "PARTS.APS"): Promise<Buffer> {
	const archive = await apsImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("kaguya aps tiled image", () => {
	it("has no signature and declares two extensions", () => {
		expect(apsImageFormat.detection?.signatures).toEqual([]);
		expect(apsImageFormat.descriptor.extensions).toEqual(["aps", "parts"]);
	});

	it("is identified by the shape of its two tables", async () => {
		const good = buildAps();
		expect(await apsImageFormat.detect(sourceOf(good), "A.APS")).toBe(true);
		// The counts have to be between one and a thousand, and every name between one and 260 bytes.
		for (const broken of [
			buildAps({ nameCount: 0 }),
			buildAps({ nameCount: 1001 }),
			buildAps({ tileCount: 0 }),
			buildAps({ tileCount: 1001 }),
			buildAps({ nameLengthOverride: 0 }),
			buildAps({ nameLengthOverride: 261 }),
		]) {
			expect(await apsImageFormat.detect(sourceOf(broken), "A.APS")).toBe(
				false,
			);
		}
		expect(
			await apsImageFormat.detect(sourceOf(Buffer.alloc(1)), "A.APS"),
		).toBe(false);
	});

	it("does not accept the newer container's files", async () => {
		// The two generations share a payload but nothing else; the newer signature reads as a name count far
		// above the ceiling, so the two probes separate without either needing the other's help.
		const newer = Buffer.concat([
			Buffer.from([0x04, 0x41, 0x50, 0x53, 0x33]),
			Buffer.alloc(4, 0x00),
			Buffer.alloc(6, 0x00),
			Buffer.alloc(4, 0x00),
		]);
		expect(await apsImageFormat.detect(sourceOf(newer), "A.APS")).toBe(false);
		expect(await aps3ImageFormat.detect(sourceOf(buildAps()), "A.APS")).toBe(
			false,
		);
	});

	it("unions every tile, origin included, and reverses the payload's rows", async () => {
		const pixels = Buffer.from([
			0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x21, 0x22, 0x23, 0x24,
			0x25, 0x26, 0x27, 0x28,
		]);
		const file = buildAps({ payload: buildAp(2, 2, pixels) });
		const source = sourceOf(file);
		const archive = await apsImageFormat.open(source, "PARTS.APS");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["PARTS.bmp"]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			// Every tile counts here, so the union starts at the origin and reaches fifteen.
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 15,
				height: 15,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([
				0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27, 0x28, 0x11, 0x12, 0x13, 0x14,
				0x15, 0x16, 0x17, 0x18,
			]),
		);
	});

	it("decompresses a packed payload with the same codec", async () => {
		const inner = buildAp(2, 2, Buffer.alloc(16, 0x33));
		const plain = await extract(buildAps({ payload: inner }));
		const compressed = await extract(
			buildAps({ payload: inner, compression: 1 }),
		);
		expect(compressed).toEqual(plain);
	});

	it("declines a compression mode it does not know", async () => {
		const file = buildAps({ compression: 2 });
		expect(await apsImageFormat.detect(sourceOf(file), "A.APS")).toBe(false);
	});

	it("fails when the payload is not an AP image", async () => {
		const file = buildAps({ payload: Buffer.alloc(24, 0x5a) });
		expect(await apsImageFormat.detect(sourceOf(file), "A.APS")).toBe(true);
		const archive = await apsImageFormat.open(sourceOf(file), "A.APS");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});
});
