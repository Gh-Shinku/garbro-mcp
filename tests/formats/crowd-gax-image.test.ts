import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	crowdGaxImageFormat,
	decryptGax,
	readGaxLayout,
	stepGaxKey,
} from "../../packages/formats/src/crowd/gax-image.js";

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** A portable network graphic header, which is all the wrapper's own reader looks at. */
function pngBytes(width: number, height: number, extra = 0): Buffer {
	const png = Buffer.alloc(29 + extra);
	PNG_SIGNATURE.copy(png, 0);
	png.writeUInt32BE(13, 8);
	png.write("IHDR", 12, "latin1");
	png.writeUInt32BE(width, 16);
	png.writeUInt32BE(height, 20);
	png[24] = 8;
	png[25] = 6;
	for (let i = 29; i < png.length; i += 1) png[i] = i & 0xff;
	return png;
}

/** The inverse of the reference's transform, which is the same walk driven by the plain bytes. */
function encryptGax(plain: Buffer, key: Buffer): Buffer {
	const output = Buffer.alloc(plain.length);
	const state = Buffer.from(key);
	let position = 0;
	while (plain.length - position >= 16) {
		for (let index = 0; index < 16; index += 1) {
			output[position + index] =
				(plain[position + index] ?? 0) ^ (state[index] ?? 0);
		}
		stepGaxKey(state, plain[position + 14] ?? 0);
		position += 16;
	}
	for (let index = 0; position + index < plain.length; index += 1) {
		output[position + index] =
			(plain[position + index] ?? 0) ^ (state[index] ?? 0);
	}
	return output;
}

function gaxFile(
	plain: Buffer,
	key = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]),
): Buffer {
	return Buffer.concat([
		Buffer.from([0, 0, 0, 1]),
		key,
		encryptGax(plain, key),
	]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await crowdGaxImageFormat.open(
		new BufferByteSource(data),
		"pic.gax",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("ANIM encrypted image", () => {
	it("finds a picture by its signature and its turned over head", async () => {
		const data = gaxFile(pngBytes(4, 3));
		expect(
			await crowdGaxImageFormat.detect(new BufferByteSource(data), "pic.gax"),
		).toBe(true);
		// The signature has to stand.
		const wrongSignature = Buffer.from(data);
		wrongSignature[3] = 2;
		expect(
			await crowdGaxImageFormat.detect(
				new BufferByteSource(wrongSignature),
				"pic.gax",
			),
		).toBe(false);
		// And the picture behind the key has to be a portable network graphic.
		const wrongKey = gaxFile(pngBytes(4, 3), Buffer.alloc(16, 0x5a));
		wrongKey[4] = 0x11;
		expect(
			await crowdGaxImageFormat.detect(
				new BufferByteSource(wrongKey),
				"pic.gax",
			),
		).toBe(false);
	});

	it("reads the measurements of the turned over picture", () => {
		const layout = readGaxLayout(pngBytes(320, 240));
		expect(layout).toEqual({ width: 320, height: 240, bitsPerPixel: 32 });
	});

	it("reports the measurements and marks the entry encrypted", async () => {
		const handle = await crowdGaxImageFormat.open(
			new BufferByteSource(gaxFile(pngBytes(4, 3))),
			"dir/pic.gax",
		);
		expect(handle.entries[0]?.path).toBe("pic.png");
		expect(handle.entries[0]?.encrypted).toBe(true);
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 4,
			height: 3,
			bitsPerPixel: 32,
		});
		expect(handle.metadata).toMatchObject({ image: "png", encrypted: true });
	});

	it("hands the picture out as it stood before it was turned over", async () => {
		const png = pngBytes(4, 3, 40);
		expect((await extract(gaxFile(png))).equals(png)).toBe(true);
	});

	it("turns a picture over block by block, whatever its length", () => {
		const key = Buffer.from([9, 8, 7, 6, 5, 4, 3, 2, 1, 0, 1, 2, 3, 4, 5, 6]);
		for (const length of [1, 15, 16, 17, 31, 32, 33, 64]) {
			const plain = Buffer.alloc(length);
			for (let i = 0; i < length; i += 1) plain[i] = (i * 7 + 3) & 0xff;
			const turned = encryptGax(plain, key);
			expect(decryptGax(turned, key).equals(plain)).toBe(true);
		}
	});

	it("steps the key by the kind the driving byte names", () => {
		const fresh = () =>
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
		const step = (driving: number): number[] => {
			const key = fresh();
			stepGaxKey(key, driving);
			return [...key];
		};
		expect(step(0)).toEqual([
			1, 2, 3, 6, 14, 6, 7, 8, 14, 10, 11, 12, 13, 14, 15, 16,
		]);
		expect(step(1)).toEqual([
			1, 2, 21, 4, 5, 6, 24, 8, 11, 10, 11, 12, 13, 14, 15, 10,
		]);
		expect(step(2)).toEqual([
			1, 5, 3, 4, 5, 13, 7, 17, 9, 10, 23, 12, 13, 14, 15, 16,
		]);
		expect(step(3)).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 5, 11, 13, 17, 24, 15, 16,
		]);
		expect(step(4)).toEqual([
			0x71, 2, 3, 0x4c, 0x17, 6, 7, 8, 9, 10, 11, 12, 13, 14, 0x50, 16,
		]);
		expect(step(5)).toEqual([
			1, 2, 14, 4, 19, 6, 24, 8, 13, 10, 11, 12, 13, 14, 15, 16,
		]);
		expect(step(6)).toEqual([
			1, 20, 18, 26, 22, 6, 7, 8, 9, 14, 11, 18, 13, 22, 15, 22,
		]);
		// The seventh kind is the sixth's own tail, so stepping by seven skips its first half.
		expect(step(7)).toEqual([
			1, 16, 18, 20, 22, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
	});

	it("declines a picture that is not all there", async () => {
		const data = gaxFile(pngBytes(4, 3)).subarray(0, 30);
		expect(
			await crowdGaxImageFormat.detect(new BufferByteSource(data), "pic.gax"),
		).toBe(false);
		await expect(
			crowdGaxImageFormat.open(new BufferByteSource(data), "pic.gax"),
		).rejects.toThrow(GarbroError);
	});
});
