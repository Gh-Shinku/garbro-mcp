import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decryptSaiki,
	saikiBmxImageFormat,
	saikiJpxImageFormat,
} from "../../packages/formats/src/saiki/obfuscated-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

const ENCRYPTED_LENGTH = 200;

/** The way back of `Binary.RotByteL`. */
function rotateRight(value: number, count: number): number {
	const shift = count & 7;
	return ((value >> shift) | (value << (8 - shift))) & 0xff;
}

/**
 * The obfuscation of the reference done backwards: the first two bytes are turned about and the run behind
 * them is turned right by the same shift that walks from one to six and starts over by the same two bytes.
 */
function encryptSaiki(
	plain: Buffer,
	encryptedLength = ENCRYPTED_LENGTH,
): Buffer {
	const length = Math.min(plain.length, encryptedLength + 2);
	if (length < 2) throw new Error("a header needs two bytes");
	const cipher = Buffer.from(plain.subarray(0, length));
	cipher[0] = (plain[0] ?? 0) ^ 0xff;
	cipher[1] = ~rotateRight(plain[1] ?? 0, 1) & 0xff;
	let shift = 1;
	let count = plain[0] ?? 0;
	for (let index = 2; index < cipher.length; index += 1) {
		cipher[index] = rotateRight(plain[index] ?? 0, shift);
		shift += 1;
		if (shift >= 7) shift = 1;
		count -= 1;
		if (0 === count) {
			count = shift <= 4 ? (plain[1] ?? 0) : (plain[0] ?? 0);
			shift = 1;
		}
	}
	return Buffer.concat([cipher, plain.subarray(length)]);
}

/** A JPEG that carries nothing but the frame the reference reads the measurements from. */
function jpegOf(
	width: number,
	height: number,
	bits = 8,
	components = 3,
): Buffer {
	const segments: Buffer[] = [Buffer.from([0xff, 0xd8])];
	const app0: Buffer = Buffer.alloc(18, 0);
	app0.writeUInt16BE(0xffe0, 0);
	app0.writeUInt16BE(16, 2);
	app0.write("JFIF\0", 4, "latin1");
	segments.push(app0);
	const frame: Buffer = Buffer.alloc(2 + 2 + 6 + components * 3, 0);
	frame.writeUInt16BE(0xffc0, 0);
	frame.writeUInt16BE(2 + 6 + components * 3, 2);
	frame[4] = bits;
	frame.writeUInt16BE(height, 5);
	frame.writeUInt16BE(width, 7);
	frame[9] = components;
	segments.push(frame);
	return Buffer.concat(segments);
}

const PIXELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const BMP = writeBmp24(2, 2, Buffer.from(PIXELS));

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(
	format: typeof saikiJpxImageFormat,
	data: Buffer,
	sourcePath: string,
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

describe("Saiki obfuscation", () => {
	it("turns an obfuscated header round again", () => {
		// A payload with every shift of the walk in it, and a length past the two hundred bytes of the run.
		const plain: Buffer = Buffer.alloc(300, 0);
		for (let index = 0; index < plain.length; index += 1) {
			plain[index] = (index * 37 + 11) & 0xff;
		}
		const cipher = encryptSaiki(plain);
		expect(cipher.subarray(0, 2).equals(plain.subarray(0, 2))).toBe(false);
		expect(decryptSaiki(cipher)?.equals(plain)).toBe(true);
		// The bytes past the run stand as they are.
		expect(cipher.subarray(202).equals(plain.subarray(202))).toBe(true);
	});

	it("gives up on a file too short to hold a header", () => {
		expect(decryptSaiki(Buffer.from([0x01]))).toBeUndefined();
		expect(decryptSaiki(Buffer.alloc(0))).toBeUndefined();
	});
});

describe("Saiki obfuscated JPEG image", () => {
	it("finds a picture by the two letters of its obfuscated header", async () => {
		const file = encryptSaiki(jpegOf(4, 3));
		expect(file.subarray(0, 4).toString("hex")).toBe("0093ff38");
		expect(await saikiJpxImageFormat.detect(sourceOf(file), "cg.jpx")).toBe(
			true,
		);
	});

	it("reports the measurements of the JPEG behind the obfuscation", async () => {
		const handle = await saikiJpxImageFormat.open(
			sourceOf(encryptSaiki(jpegOf(4, 3))),
			"dir/cg.jpx",
		);
		expect(handle.entries[0]?.path).toBe("cg.jpg");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
		});
		expect(handle.metadata).toMatchObject({
			image: "jpeg",
			width: 4,
			height: 3,
		});
	});

	it("hands the JPEG out once the obfuscation is off", async () => {
		const jpeg = jpegOf(4, 3);
		const out = await extract(
			saikiJpxImageFormat,
			encryptSaiki(jpeg),
			"cg.jpx",
		);
		expect(out.equals(jpeg)).toBe(true);
		expect(out.subarray(0, 2).toString("hex")).toBe("ffd8");
	});

	it("refuses a picture whose obfuscation hides no JPEG", async () => {
		// A bitmap obfuscated the same way, with the two letters of the JPEG format written over its own.
		const file = Buffer.from(encryptSaiki(BMP));
		file[0] = 0x00;
		file[1] = 0x93;
		expect(await saikiJpxImageFormat.detect(sourceOf(file), "cg.jpx")).toBe(
			false,
		);
		await expect(
			saikiJpxImageFormat.open(sourceOf(file), "cg.jpx"),
		).rejects.toThrow(GarbroError);
	});
});

describe("Saiki obfuscated bitmap", () => {
	it("finds a picture whose obfuscation hides a bitmap", async () => {
		const file = encryptSaiki(BMP);
		expect(file.subarray(0, 2).toString("hex")).toBe("bd59");
		expect(await saikiBmxImageFormat.detect(sourceOf(file), "cg.bmx")).toBe(
			true,
		);
		// A plain bitmap is not obfuscated, so its letters are not the ones the format looks for.
		expect(await saikiBmxImageFormat.detect(sourceOf(BMP), "cg.bmx")).toBe(
			false,
		);
	});

	it("reports the measurements of the bitmap behind the obfuscation", async () => {
		const handle = await saikiBmxImageFormat.open(
			sourceOf(encryptSaiki(BMP)),
			"dir/cg.bmx",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 2,
			height: 2,
		});
	});

	it("unfolds the bitmap and writes it out again", async () => {
		const out = await extract(saikiBmxImageFormat, encryptSaiki(BMP), "cg.bmx");
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.subarray(0x36).toString("hex")).toBe(
			"01020304050600000708090a0b0c0000",
		);
	});

	it("refuses a picture whose obfuscation hides no bitmap", async () => {
		// A JPEG obfuscated the same way, with the two letters of the bitmap format over its own.
		const file = Buffer.from(encryptSaiki(jpegOf(4, 3)));
		file[0] = 0xbd;
		file[1] = 0x59;
		expect(await saikiBmxImageFormat.detect(sourceOf(file), "cg.bmx")).toBe(
			false,
		);
		await expect(
			saikiBmxImageFormat.open(sourceOf(file), "cg.bmx"),
		).rejects.toThrow("Not a Saiki picture");
	});
});
