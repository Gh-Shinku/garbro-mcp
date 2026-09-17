import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";
import {
	readYkgLayout,
	yukaYkgImageFormat,
} from "../../packages/formats/src/yuka/ykg-image.js";

const HEADER_SIZE = 0x40;
const GNP_TAG = Buffer.from([0x89, 0x47, 0x4e, 0x50]);
const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** A portable network graphic header, which is all the wrapper's own reader looks at. */
function pngBytes(width: number, height: number): Buffer {
	const png = Buffer.alloc(29);
	PNG_SIGNATURE.copy(png, 0);
	png.writeUInt32BE(13, 8);
	png.write("IHDR", 12, "latin1");
	png.writeUInt32BE(width, 16);
	png.writeUInt32BE(height, 20);
	png[24] = 8;
	png[25] = 6;
	return png;
}

function bmpBytes(width: number, height: number): Buffer {
	return writeBmp24(width, height, Buffer.alloc(width * height * 3, 0x7f));
}

interface YkgOptions {
	dataOffset?: number;
	fallbackOffset?: number;
	size?: number;
	version?: Buffer;
}

/** A file: the head, then the wrapped picture at the offset the head carries. */
function ykgFile(payload: Buffer, options: YkgOptions = {}): Buffer {
	const dataOffset = options.dataOffset ?? HEADER_SIZE;
	const head = Buffer.alloc(HEADER_SIZE);
	Buffer.from("YKG0", "latin1").copy(head, 0);
	(options.version ?? Buffer.from([0x30, 0x30, 0x00, 0x00])).copy(head, 4);
	head.writeUInt32LE(dataOffset, 0x28);
	head.writeUInt32LE(options.size ?? 0, 0x2c);
	head.writeUInt32LE(options.fallbackOffset ?? 0, 8);
	if (dataOffset <= HEADER_SIZE) return Buffer.concat([head, payload]);
	const gap = Buffer.alloc(dataOffset - HEADER_SIZE);
	return Buffer.concat([head, gap, payload]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await yukaYkgImageFormat.open(
		new BufferByteSource(data),
		"pic.ykg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Yuka YKG picture", () => {
	it("finds each kind of wrapped picture", async () => {
		const bmp = bmpBytes(2, 2);
		const png = pngBytes(3, 4);
		const gnp = Buffer.concat([GNP_TAG, png.subarray(4)]);
		for (const payload of [bmp, png, gnp]) {
			expect(
				await yukaYkgImageFormat.detect(
					new BufferByteSource(ykgFile(payload)),
					"pic.ykg",
				),
			).toBe(true);
		}
		// The four bytes behind the tag word have to be `00` and two clear bytes.
		expect(
			await yukaYkgImageFormat.detect(
				new BufferByteSource(
					ykgFile(bmp, { version: Buffer.from([0x30, 0x31, 0, 0]) }),
				),
				"pic.ykg",
			),
		).toBe(false);
		// An offset inside the head is refused.
		expect(
			await yukaYkgImageFormat.detect(
				new BufferByteSource(ykgFile(bmp, { dataOffset: 0x20 })),
				"pic.ykg",
			),
		).toBe(false);
		// So is a picture the wrapper's own readers do not know.
		const unknown = ykgFile(Buffer.from("NOPE", "latin1"));
		expect(
			await yukaYkgImageFormat.detect(new BufferByteSource(unknown), "pic.ykg"),
		).toBe(false);
		// And a bitmap that is not all there.
		expect(
			await yukaYkgImageFormat.detect(
				new BufferByteSource(ykgFile(bmp.subarray(0, 0x20))),
				"pic.ykg",
			),
		).toBe(false);
	});

	it("falls back to the offset at eight, and to the rest of the file for the size", async () => {
		// A payload behind the head, with the offset standing at eight instead of 0x28.
		const payload = bmpBytes(2, 2);
		const data = ykgFile(payload, {
			dataOffset: HEADER_SIZE,
			fallbackOffset: HEADER_SIZE,
		});
		data.writeUInt32LE(0, 0x28);
		const layout = readYkgLayout(data);
		expect(layout).toMatchObject({
			kind: "bmp",
			dataOffset: HEADER_SIZE,
			dataSize: payload.length,
		});
	});

	it("reports the measurements of the wrapped picture", async () => {
		const bmp = bmpBytes(2, 2);
		const handle = await yukaYkgImageFormat.open(
			new BufferByteSource(ykgFile(bmp)),
			"dir/pic.ykg",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			wrapped: "bmp",
			encrypted: false,
		});
		const png = pngBytes(3, 4);
		const pngHandle = await yukaYkgImageFormat.open(
			new BufferByteSource(ykgFile(png)),
			"pic.ykg",
		);
		expect(pngHandle.entries[0]?.path).toBe("pic.png");
		expect(pngHandle.entries[0]?.metadata).toMatchObject({
			width: 3,
			height: 4,
			bitsPerPixel: 32,
		});
	});

	it("hands a bitmap and a portable network graphic out as they stand", async () => {
		const bmp = bmpBytes(2, 2);
		expect((await extract(ykgFile(bmp))).equals(bmp)).toBe(true);
		const png = pngBytes(3, 4);
		expect((await extract(ykgFile(png))).equals(png)).toBe(true);
	});

	it("puts the signature back in front of an obfuscated picture", async () => {
		const png = pngBytes(3, 4);
		const gnp = Buffer.concat([GNP_TAG, png.subarray(4)]);
		const out = await extract(ykgFile(gnp));
		expect(out.equals(png)).toBe(true);
		const handle = await yukaYkgImageFormat.open(
			new BufferByteSource(ykgFile(gnp)),
			"dir/pic.ykg",
		);
		expect(handle.entries[0]?.path).toBe("pic.png");
		expect(handle.metadata).toMatchObject({
			image: "png",
			wrapped: "gnp",
			encrypted: true,
		});
	});

	it("keeps the declared size and leaves what stands behind it", async () => {
		const bmp = bmpBytes(2, 2);
		const data = ykgFile(bmp, { size: bmp.length - 6 });
		const layout = readYkgLayout(data);
		expect(layout?.dataSize).toBe(bmp.length - 6);
		const handle = await yukaYkgImageFormat.open(
			new BufferByteSource(data),
			"pic.ykg",
		);
		expect(handle.entries[0]?.size).toBe(BigInt(bmp.length - 6));
	});

	it("declines a file whose picture does not lie where the head says", async () => {
		const bmp = bmpBytes(2, 2);
		const data = ykgFile(bmp, { dataOffset: 0x100 });
		// The offset stands past the end of the file.
		const trimmed = data.subarray(0, 0x80);
		expect(readYkgLayout(trimmed)).toBeUndefined();
		await expect(
			yukaYkgImageFormat.open(new BufferByteSource(trimmed), "pic.ykg"),
		).rejects.toThrow(GarbroError);
		await expect(
			yukaYkgImageFormat.open(new BufferByteSource(trimmed), "pic.ykg"),
		).rejects.toThrow("Not a Yuka YKG picture");
	});
});
