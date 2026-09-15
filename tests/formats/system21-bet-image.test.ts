import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	betImageFormat,
	lzBetImageFormat,
} from "../../packages/formats/src/system21/bet-image.js";

const HEADER_SIZE = 10;
const SZDD_HEADER_SIZE = 0x0e;
const PALETTE_SIZE = 0x400;

/** The ring of the format starts one short of its end, which the reference asks for by name. */
const FRAME_INIT_POSITION = 0x1000 - 0x10;

function paletteOf(): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE, 0);
	for (let index = 0; index < 256; index += 1) {
		palette[index * 4] = index;
		palette[index * 4 + 1] = 255 - index;
		palette[index * 4 + 2] = index ^ 0x5a;
	}
	return palette;
}

interface BetParts {
	width: number;
	height: number;
	bitsPerPixel: number;
	pixels: Buffer;
	palette?: boolean;
}

/** The picture: the header, the colour map of an eight bit one, and the pixels, every byte turned over. */
function betBody(parts: BetParts): Buffer {
	const rowBytes = (parts.width * parts.bitsPerPixel) / 8;
	const pixels: Buffer = Buffer.from(parts.pixels);
	for (let index = 0; index < pixels.length; index += 1) {
		pixels[index] = (pixels[index] ?? 0) ^ 0xff;
	}
	const body: Buffer[] = [];
	if (parts.palette) body.push(paletteOf());
	body.push(pixels.subarray(0, rowBytes * parts.height));
	return Buffer.concat(body);
}

function betFile(parts: BetParts): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0);
	header.writeUInt32LE(parts.width, 0);
	header.writeUInt32LE(parts.height, 4);
	header.writeUInt16LE(parts.bitsPerPixel, 8);
	return Buffer.concat([header, betBody(parts)]);
}

/** The Microsoft variant of LZSS: control bytes least significant bit first, a set bit a byte of its own. */
class LzssWriter {
	readonly #groups: Array<{ control: number; payload: number[] }> = [];
	#control = 0;
	#payload: number[] = [];
	#ops = 0;

	literal(byte: number): this {
		this.#control |= 1 << this.#ops;
		this.#payload.push(byte & 0xff);
		return this.#advance();
	}

	match(offset: number, count: number): this {
		// The place is written in twelve bits across the two bytes, and the count behind it in four.
		const low = offset & 0xff;
		const high = (((offset >> 8) & 0x0f) << 4) | ((count - 3) & 0x0f);
		this.#payload.push(low, high);
		return this.#advance();
	}

	#advance(): this {
		this.#ops += 1;
		if (this.#ops === 8) this.#flush();
		return this;
	}

	#flush(): void {
		if (0 === this.#ops) return;
		this.#groups.push({ control: this.#control, payload: this.#payload });
		this.#control = 0;
		this.#payload = [];
		this.#ops = 0;
	}

	finish(): Buffer {
		this.#flush();
		const bytes: number[] = [];
		for (const { control, payload } of this.#groups) {
			bytes.push(control, ...payload);
		}
		return Buffer.from(bytes);
	}
}

function literalsOf(data: Buffer): Buffer {
	const writer = new LzssWriter();
	for (const byte of data) writer.literal(byte);
	return writer.finish();
}

/** The picture behind the fourteen byte header of the packed format. */
function szddFile(uncompressedSize: number, packed: Buffer): Buffer {
	const header: Buffer = Buffer.alloc(SZDD_HEADER_SIZE, 0);
	header.write("SZDD", 0, "latin1");
	header[4] = 0x41;
	header[5] = 0x5f;
	header.writeUInt32LE(uncompressedSize, 6);
	return Buffer.concat([header, packed]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(
	format: typeof betImageFormat,
	data: Buffer,
	sourcePath = "cg.bet",
): Promise<Buffer> {
	const handle = await format.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("System21 image format", () => {
	const pixels: Buffer = Buffer.alloc(4 * 3 * 3, 0);
	for (let index = 0; index < pixels.length; index += 1) {
		pixels[index] = (index * 11) & 0xff;
	}

	it("finds a picture by the name of its file", async () => {
		const data = betFile({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
			pixels,
		});
		expect(await betImageFormat.detect(sourceOf(data), "cg.bet")).toBe(true);
		expect(await betImageFormat.detect(sourceOf(data), "cg.bin")).toBe(false);
	});

	it("declines a depth or a measurement the reference does not read", async () => {
		for (const parts of [
			{ width: 4, height: 3, bitsPerPixel: 16 },
			{ width: 4, height: 3, bitsPerPixel: 32 },
			{ width: 0, height: 3, bitsPerPixel: 24 },
			{ width: 4, height: 0, bitsPerPixel: 24 },
			{ width: 0x8001, height: 3, bitsPerPixel: 24 },
			{ width: 4, height: 0x8001, bitsPerPixel: 24 },
		]) {
			const data = betFile({ ...parts, pixels: Buffer.alloc(16) });
			expect(await betImageFormat.detect(sourceOf(data), "cg.bet")).toBe(false);
		}
	});

	it("reports what the header says about the picture", async () => {
		const data = betFile({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
			pixels,
		});
		const handle = await betImageFormat.open(sourceOf(data), "dir/cg.bet");
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			type: "image",
			width: 4,
			height: 3,
			bitsPerPixel: 24,
		});
	});

	it("turns the pixels over and keeps their rows bottom up", async () => {
		const data = betFile({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
			pixels,
		});
		const out = await extract(betImageFormat, data);
		// The rows of the picture are stored bottom up, which the height of the bitmap says by its sign.
		expect(out.readInt32LE(22)).toBeGreaterThan(0);
		const stored = Buffer.from(pixels);
		expect(out.subarray(54, 54 + 36)).toEqual(stored);
	});

	it("keeps the colour map as it stands", async () => {
		const palette = paletteOf();
		const indexed: Buffer = Buffer.from([0, 1, 2, 3, 4, 5, 6, 7]);
		const data = betFile({
			width: 4,
			height: 2,
			bitsPerPixel: 8,
			palette: true,
			pixels: indexed,
		});
		const out = await extract(betImageFormat, data);
		expect(out.subarray(54, 54 + PALETTE_SIZE)).toEqual(palette);
		expect(out.subarray(54 + PALETTE_SIZE, 54 + PALETTE_SIZE + 8)).toEqual(
			indexed,
		);
		// And the bytes of the file were stored turned over.
		expect(data[HEADER_SIZE + PALETTE_SIZE]).toBe((indexed[0] ?? 0) ^ 0xff);
		expect(data.readUInt8(HEADER_SIZE + PALETTE_SIZE + 1)).toBe(
			(indexed[1] ?? 0) ^ 0xff,
		);
	});

	it("refuses a picture cut short of its pixels or colour map", async () => {
		const whole = betFile({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
			pixels,
		});
		await expect(
			extract(betImageFormat, whole.subarray(0, whole.length - 2)),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
		const indexed = betFile({
			width: 2,
			height: 2,
			bitsPerPixel: 8,
			palette: true,
			pixels: Buffer.alloc(4),
		});
		await expect(
			extract(
				betImageFormat,
				Buffer.concat([
					indexed.subarray(0, HEADER_SIZE),
					indexed.subarray(HEADER_SIZE, HEADER_SIZE + 0x200),
				]),
			),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});

	it("finds the same picture behind a stream of its own", async () => {
		const data = betFile({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
			pixels,
		});
		const packed = szddFile(data.length, literalsOf(data));
		expect(await lzBetImageFormat.detect(sourceOf(packed), "cg.bet")).toBe(
			true,
		);
		// The reference is told apart by the name of the file here as well.
		expect(await lzBetImageFormat.detect(sourceOf(packed), "cg.bin")).toBe(
			false,
		);
		expect(await extract(lzBetImageFormat, packed)).toEqual(
			await extract(betImageFormat, data),
		);
	});

	it("reports what the picture behind the stream says about itself", async () => {
		const data = betFile({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
			pixels,
		});
		const packed = szddFile(data.length, literalsOf(data));
		const handle = await lzBetImageFormat.open(sourceOf(packed), "dir/cg.bet");
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
		});
	});

	it("refuses a stream that does not unfold to a picture", async () => {
		const packed = szddFile(0, literalsOf(Buffer.alloc(64, 0x41)));
		expect(await lzBetImageFormat.detect(sourceOf(packed), "cg.bet")).toBe(
			false,
		);
		await expect(extract(lzBetImageFormat, packed)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});

	it("starts its ring one short of the end, which a place of a whole frame reaches", async () => {
		// An eight bit picture whose header is written a byte at a time, and then a run of three bytes that
		// reaches to the very start of the ring, where the first byte of the picture was written. With the
		// ring starting anywhere else, the run would read the fill byte instead.
		const indexed: Buffer = Buffer.from([0x11, 0x22, 0x33, 0x44]);
		const data = betFile({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			palette: true,
			pixels: indexed,
		});
		const writer = new LzssWriter();
		for (const byte of data.subarray(0, HEADER_SIZE)) writer.literal(byte);
		writer.match(FRAME_INIT_POSITION, 3);
		for (const byte of data.subarray(HEADER_SIZE + 3)) writer.literal(byte);
		const out = await extract(
			lzBetImageFormat,
			szddFile(data.length, writer.finish()),
		);
		// The three bytes the run copies are the first three of the picture, over the colour map.
		const expected: Buffer = Buffer.from(data);
		expected[HEADER_SIZE] = data[0] ?? 0;
		expected[HEADER_SIZE + 1] = data[1] ?? 0;
		expected[HEADER_SIZE + 2] = data[2] ?? 0;
		expect(out).toEqual(await extract(betImageFormat, expected));
	});

	it("refuses a picture behind a stream that ends inside it", async () => {
		const data = betFile({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
			pixels,
		});
		const packed = szddFile(
			data.length,
			literalsOf(data.subarray(0, data.length - 6)),
		);
		await expect(extract(lzBetImageFormat, packed)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});
});
