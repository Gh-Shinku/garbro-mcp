import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decryptGgp,
	ikuraGgpImageFormat,
	readGgpLayout,
} from "../../packages/formats/src/ikura/ggp-image.js";

const HEADER_SIZE = 0x24;
const KEY = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]);

/** A portable network graphic header, which is all of one this project reads. */
function pngHeader(
	width: number,
	height: number,
	depth = 8,
	colourType = 6,
): Buffer<ArrayBuffer> {
	const out: Buffer<ArrayBuffer> = Buffer.alloc(33, 0x00);
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(out, 0);
	out.writeUInt32BE(13, 8);
	out.write("IHDR", 12, "latin1");
	out.writeUInt32BE(width, 16);
	out.writeUInt32BE(height, 20);
	out[24] = depth;
	out[25] = colourType;
	return out;
}

/** A picture the key is laid over, byte by byte, from the first byte of the key round and round. */
function encrypted(png: Buffer<ArrayBuffer>, key: Buffer = KEY): Buffer {
	return decryptGgp(png, key);
}

interface FileParts {
	width?: number;
	height?: number;
	depth?: number;
	colourType?: number;
	key?: Buffer;
	/** The place the picture stands at, with nothing between the header and it by default. */
	offset?: number;
	/** Junk to stand between the header and the picture. */
	padding?: number;
	/** A length other than the one the picture really is. */
	length?: number;
	letters?: string;
	payload?: Buffer<ArrayBuffer>;
}

/** A whole file: the fake header, whatever stands between it and the picture, and the picture itself. */
function ggpFile(parts: FileParts = {}): Buffer {
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	head.write(parts.letters ?? "GGPFAIKE", 0, "latin1");
	const key = parts.key ?? KEY;
	// The key is the first eight bytes of the header laid over the eight bytes at offset `0x0C`, so the file
	// holds whatever makes that come out as the key it was given.
	for (let index = 0; index < 8; index += 1) {
		head[0x0c + index] = (head[index] ?? 0) ^ (key[index] ?? 0);
	}
	const png: Buffer<ArrayBuffer> =
		parts.payload ??
		pngHeader(
			parts.width ?? 4,
			parts.height ?? 2,
			parts.depth,
			parts.colourType,
		);
	const padding: Buffer = Buffer.alloc(parts.padding ?? 0, 0xee);
	const offset = parts.offset ?? HEADER_SIZE + padding.length;
	head.writeUInt32LE(offset, 0x14);
	head.writeUInt32LE(parts.length ?? png.length, 0x18);
	return Buffer.concat([head, padding, encrypted(png, key)]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.ggp"): Promise<Buffer> {
	const handle = await ikuraGgpImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Digital Romance System encrypted picture format", () => {
	it("finds a picture by its four bytes and the letters behind them", async () => {
		const data = ggpFile();
		expect(await ikuraGgpImageFormat.detect(sourceOf(data), "cg.ggp")).toBe(
			true,
		);
		expect(readGgpLayout(data)?.key.equals(KEY)).toBe(true);
		// The reference checks the letters rather than only the word the signature is packed into.
		expect(
			await ikuraGgpImageFormat.detect(
				sourceOf(ggpFile({ letters: "GGPFBEAR" })),
				"cg.ggp",
			),
		).toBe(false);
		// A file too short to hold a header, or one whose picture stands outside it, is turned away.
		expect(readGgpLayout(Buffer.alloc(HEADER_SIZE - 1, 0x00))).toBeUndefined();
		expect(readGgpLayout(ggpFile({ offset: 0x40 }))).toBeUndefined();
		expect(readGgpLayout(ggpFile({ length: 0x1000 }))).toBeUndefined();
		expect(readGgpLayout(ggpFile({ length: 0 }))).toBeUndefined();
	});

	it("turns away a picture that is not a portable network graphic behind the letters", async () => {
		// The bytes behind the header stand as they are, so what comes out of the key is not a picture.
		const data = ggpFile({ payload: Buffer.alloc(33, 0x00) });
		expect(await ikuraGgpImageFormat.detect(sourceOf(data), "cg.ggp")).toBe(
			false,
		);
	});

	it("reports the measurements of the picture behind the header", async () => {
		const handle = await ikuraGgpImageFormat.open(
			sourceOf(ggpFile({ width: 9, height: 7 })),
			"dir/cg.ggp",
		);
		expect(handle.entries[0]?.path).toBe("cg.png");
		expect(handle.entries[0]?.size).toBe(BigInt(33));
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 9,
			height: 7,
			bitsPerPixel: 32,
		});
		expect(handle.metadata).toMatchObject({
			image: "png",
			compression: "xor",
			width: 9,
			height: 7,
		});
	});

	it("reads the depth the colour kind of the picture gives it", async () => {
		const grey = await ikuraGgpImageFormat.open(
			sourceOf(ggpFile({ depth: 16, colourType: 0 })),
			"cg.gg",
		);
		expect(grey.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 16 });
		const indexed = await ikuraGgpImageFormat.open(
			sourceOf(ggpFile({ depth: 4, colourType: 3 })),
			"cg.gg",
		);
		expect(indexed.entries[0]?.metadata).toMatchObject({ bitsPerPixel: 24 });
	});

	it("finds the key by laying the first bytes of the header over the ones behind them", () => {
		const head: Buffer = Buffer.alloc(HEADER_SIZE + 8, 0x00);
		head.write("GGPFAIKE", 0, "latin1");
		// 'G'^'A' = 0x06, 'G'^'B' = 0x05, 'P'^'C' = 0x13, 'F'^'D' = 0x02, 'A'^'J' = 0x0B, and the last three
		// bytes of the letters laid over the same bytes again, which come to nothing.
		Buffer.from([0x41, 0x42, 0x43, 0x44, 0x4a, 0x49, 0x4b, 0x45]).copy(
			head,
			0x0c,
		);
		head.writeUInt32LE(HEADER_SIZE, 0x14);
		head.writeUInt32LE(8, 0x18);
		expect(readGgpLayout(head)?.key.toString("hex")).toBe("060513020b000000");
	});

	it("lays the picture over with the key, walking the key round and round", async () => {
		const payload = Buffer.alloc(100, 0x5a);
		for (let index = 0; index < payload.length; index += 1) {
			payload[index] = index & 0xff;
		}
		const png = pngHeader(4, 2);
		Buffer.concat([payload]).copy(png, 33, 0, 0);
		const data = ggpFile({
			payload: Buffer.concat([png, payload.subarray(0, 67)]),
		});
		const out = await extract(data);
		expect(out.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
		// The bytes behind the header come back exactly as they stood before the key was laid over them.
		expect(out.subarray(33).toString("hex")).toBe(
			Buffer.concat([payload.subarray(0, 67)]).toString("hex"),
		);
	});

	it("reads a picture that stands behind a gap in the file", async () => {
		const data = ggpFile({ padding: 0x20 });
		expect(await ikuraGgpImageFormat.detect(sourceOf(data), "cg.ggp")).toBe(
			true,
		);
		expect(await extract(data)).toEqual(pngHeader(4, 2));
	});

	it("gives back the picture the file holds", async () => {
		const data = ggpFile({ width: 4, height: 2 });
		expect(await extract(data)).toEqual(pngHeader(4, 2));
	});

	it("refuses a picture that is not a portable network graphic where it is extracted", async () => {
		// Reading the picture of such a file, which detection turns away, is refused rather than passed on.
		const data = ggpFile({ payload: Buffer.alloc(33, 0x00) });
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"GGP picture does not hold a portable network graphic",
		);
	});
});
