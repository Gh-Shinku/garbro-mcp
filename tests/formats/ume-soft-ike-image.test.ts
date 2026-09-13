import { BufferByteSource } from "@garbro-mcp/core";
import { ikeAudioFormat, ikeImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x9d, 0x89, 0x69, 0x6b]);
const STREAM_OFFSET = 0x0d;
const MARKER_OFFSET = 0x0f;
const SIZE_BYTES_OFFSET = 10;
const BMP_HEADER_SIZE = 54;

/** The Ike bit stream writer, shared with the BIN and audio fixtures. */
class IkeWriter {
	readonly out: number[] = [];
	#word = 0;
	#bits = 0;
	#bytes: number[] = [];

	bit(value: number): void {
		this.#word |= (value & 1) << this.#bits;
		this.#bits += 1;
		if (this.#bits === 16) this.#flush();
	}

	byte(value: number): void {
		this.#bytes.push(value & 0xff);
	}

	#flush(): void {
		this.out.push(this.#word & 0xff, (this.#word >> 8) & 0xff, ...this.#bytes);
		this.#word = 0;
		this.#bits = 0;
		this.#bytes = [];
	}

	finish(): Buffer {
		if (this.#bits > 0 || this.#bytes.length > 0) this.#flush();
		return Buffer.from(this.out);
	}
}

function encodeIkeLiterals(content: Buffer): Buffer {
	const writer = new IkeWriter();
	for (const byte of content) {
		writer.bit(1);
		writer.byte(byte);
	}
	return writer.finish();
}

function encodeIkeSize(size: number): Buffer {
	return Buffer.from([(size >>> 16) << 2, size & 0xff, (size >>> 8) & 0xff]);
}

/** A plain top-down twenty four bit bitmap. */
function buildBmp24(width: number, height: number, pixels: Buffer): Buffer {
	const stride = (width * 3 + 3) & ~3;
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(BMP_HEADER_SIZE + stride * height, 2);
	header.writeUInt32LE(BMP_HEADER_SIZE, 10);
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(width, 18);
	header.writeInt32LE(-height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(24, 28);
	header.writeUInt32LE(stride * height, 34);
	const body: Buffer = Buffer.alloc(stride * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(body, row * stride, row * width * 3, (row + 1) * width * 3);
	}
	return Buffer.concat([header, body]);
}

/** A canonical mono eight bit wave, the audio format's own payload. */
function buildWave(pcm: Buffer): Buffer {
	const header: Buffer = Buffer.alloc(44, 0x00);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8, "latin1");
	header.write("fmt ", 12, "latin1");
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(22050, 24);
	header.writeUInt32LE(22050, 28);
	header.writeUInt16LE(1, 32);
	header.writeUInt16LE(8, 34);
	header.write("data", 36, "latin1");
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

function buildIke(payload: Buffer, declaredSize?: number): Buffer {
	const header: Buffer = Buffer.alloc(STREAM_OFFSET, 0x00);
	SIGNATURE.copy(header, 0);
	header.write("ike", 2, "latin1");
	encodeIkeSize(declaredSize ?? payload.length).copy(header, SIZE_BYTES_OFFSET);
	return Buffer.concat([header, encodeIkeLiterals(payload)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer, name = "IMAGE.IKE"): Promise<Buffer> {
	const archive = await ikeImageFormat.open(sourceOf(stored), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("ume-soft ike bitmap", () => {
	it("declares the signature the audio format shares and no extension", () => {
		expect(ikeImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		// Both members of the family register the same three byte tag and tell each other apart by offset 0x0F.
		expect(ikeAudioFormat.detection?.signatures?.[0]?.bytes).toEqual(SIGNATURE);
		expect(ikeImageFormat.descriptor.extensions).toEqual([]);
	});

	it("probes a bitmap header and unpacks the bitmap behind it", async () => {
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0x21, 0x22, 0x23, 0x31, 0x32, 0x33,
		]);
		const bmp = buildBmp24(2, 2, pixels);
		const stored = buildIke(bmp);
		// The marker check reads the first literal of the compressed stream, two bytes past the codec's start.
		expect(stored.subarray(STREAM_OFFSET, MARKER_OFFSET)).toHaveLength(2);
		expect(stored.toString("latin1", MARKER_OFFSET, MARKER_OFFSET + 2)).toBe(
			"BM",
		);
		const source = sourceOf(stored);
		expect(await ikeImageFormat.detect(source, "IMAGE.IKE")).toBe(true);
		const archive = await ikeImageFormat.open(source, "IMAGE.IKE");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["IMAGE.bmp"]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "ike",
				width: 2,
				height: 2,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output).toEqual(bmp);
	});

	it("tells itself apart from the audio format by the byte at 0x0F", async () => {
		const bmp = buildBmp24(1, 1, Buffer.from([1, 2, 3]));
		const wave = buildWave(Buffer.from([1, 2, 3]));
		expect(await ikeImageFormat.detect(sourceOf(buildIke(bmp)), "X.IKE")).toBe(
			true,
		);
		expect(await ikeAudioFormat.detect(sourceOf(buildIke(bmp)), "X.IKE")).toBe(
			false,
		);
		expect(await ikeImageFormat.detect(sourceOf(buildIke(wave)), "X.IKE")).toBe(
			false,
		);
		expect(await ikeAudioFormat.detect(sourceOf(buildIke(wave)), "X.IKE")).toBe(
			true,
		);
	});

	it("declines a payload that does not start with a bitmap", async () => {
		const stored = buildIke(buildWave(Buffer.from([1, 2, 3])));
		expect(stored.toString("latin1", MARKER_OFFSET, MARKER_OFFSET + 4)).toBe(
			"RIFF",
		);
		expect(await ikeImageFormat.detect(sourceOf(stored), "IMAGE.IKE")).toBe(
			false,
		);
	});

	it("declines a wrong marker byte and a wrong signature", async () => {
		const stored = buildIke(buildBmp24(1, 1, Buffer.from([1, 2, 3])));
		stored[4] = 0x78;
		expect(await ikeImageFormat.detect(sourceOf(stored), "IMAGE.IKE")).toBe(
			false,
		);
		const other = buildIke(buildBmp24(1, 1, Buffer.from([1, 2, 3])));
		other[0] = 0x00;
		expect(await ikeImageFormat.detect(sourceOf(other), "IMAGE.IKE")).toBe(
			false,
		);
	});

	it("rejects a bitmap header naming an unsupported size", async () => {
		const bmp = buildBmp24(1, 1, Buffer.from([1, 2, 3]));
		// A DIB size below forty is not a bitmap this reader takes.
		bmp.writeUInt32LE(12, 14);
		const stored = buildIke(bmp);
		expect(await ikeImageFormat.detect(sourceOf(stored), "IMAGE.IKE")).toBe(
			false,
		);
	});

	it("lists a file whose declared size covers only the header, and fails to extract it", async () => {
		// The probe decompresses fifty four bytes whatever the header says, so the metadata reads fine and the
		// reference only finds out when `Bmp.Read` is handed a stream that stops inside the bitmap.
		const bmp = buildBmp24(2, 2, Buffer.alloc(12, 0x40));
		const stored = buildIke(bmp, BMP_HEADER_SIZE);
		expect(await ikeImageFormat.detect(sourceOf(stored), "IMAGE.IKE")).toBe(
			true,
		);
		const archive = await ikeImageFormat.open(sourceOf(stored), "IMAGE.IKE");
		try {
			expect(archive.metadata).toMatchObject({ width: 2, height: 2 });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines a short file and zero dimensions", async () => {
		expect(
			await ikeImageFormat.detect(
				sourceOf(Buffer.alloc(0x10, 0x00)),
				"IMAGE.IKE",
			),
		).toBe(false);
		const zero = buildBmp24(2, 2, Buffer.alloc(12, 0x40));
		zero.writeUInt32LE(0, 18);
		expect(
			await ikeImageFormat.detect(sourceOf(buildIke(zero)), "IMAGE.IKE"),
		).toBe(false);
	});
});
