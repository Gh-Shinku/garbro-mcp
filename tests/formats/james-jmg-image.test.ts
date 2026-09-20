import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	deobfuscateJmg,
	type JmgObfuscation,
	jamesJmgImageFormat,
	readJmgLayout,
} from "../../packages/formats/src/james/jmg-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

const HEADER_PASS_SIZE = 0x40;
const PIXELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];
const BMP = writeBmp24(2, 2, Buffer.from(PIXELS));

function obfuscate(bitmap: Buffer, method: JmgObfuscation): Buffer {
	const out = Buffer.from(bitmap);
	for (let position = 0; position + 1 < out.length; position += 2) {
		const word = out.readUInt16LE(position);
		let value: number;
		if ("rotateWords" === method) {
			// The way back of the reference's turn, which takes four turns to come round.
			value = ((word >> 4) | (word << 12)) & 0xffff;
		} else {
			let bits = word;
			bits = ((bits & 0xaaaa) >> 1) | ((bits & 0x5555) << 1);
			bits = ((bits & 0xcccc) >> 2) | ((bits & 0x3333) << 2);
			bits = ((bits & 0xf0f0) >> 4) | ((bits & 0x0f0f) << 4);
			bits = ((bits & 0xff00) >> 8) | ((bits & 0x00ff) << 8);
			value = bits & 0xffff;
		}
		out.writeUInt16LE(value, position);
	}
	return out;
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.jmg"): Promise<Buffer> {
	const handle = await jamesJmgImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("JAMES obfuscated bitmap", () => {
	it("turns the two letters of a bitmap into the words of the format", () => {
		expect(obfuscate(BMP, "rotateWords").subarray(0, 2).toString("hex")).toBe(
			"d424",
		);
		expect(obfuscate(BMP, "reverseBits").subarray(0, 2).toString("hex")).toBe(
			"b242",
		);
		expect(
			deobfuscateJmg(Buffer.from([0xd4, 0x24]), "rotateWords").toString("hex"),
		).toBe("424d");
		expect(
			deobfuscateJmg(Buffer.from([0xb2, 0x42]), "reverseBits").toString("hex"),
		).toBe("424d");
		expect(
			deobfuscateJmg(obfuscate(BMP, "rotateWords"), "rotateWords").equals(BMP),
		).toBe(true);
		expect(
			deobfuscateJmg(obfuscate(BMP, "reverseBits"), "reverseBits").equals(BMP),
		).toBe(true);
	});

	it("refuses a picture that ends in the middle of a word", () => {
		expect(() => deobfuscateJmg(Buffer.alloc(3, 0), "rotateWords")).toThrow(
			"JAMES picture ends in the middle of a word",
		);
	});

	it("finds a picture by the obfuscated letters of its bitmap", async () => {
		for (const method of ["rotateWords", "reverseBits"] as JmgObfuscation[]) {
			const data = obfuscate(BMP, method);
			expect(await jamesJmgImageFormat.detect(sourceOf(data), "cg.jmg")).toBe(
				true,
			);
		}
		// The letters of a plain bitmap are not the ones the format looks for.
		expect(await jamesJmgImageFormat.detect(sourceOf(BMP), "cg.jmg")).toBe(
			false,
		);
		const odd = obfuscate(BMP, "rotateWords");
		odd[0] = 0xd5;
		expect(await jamesJmgImageFormat.detect(sourceOf(odd), "cg.jmg")).toBe(
			false,
		);
	});

	it("turns away a picture too short to hold the header of its bitmap", async () => {
		const data = obfuscate(BMP, "rotateWords");
		expect(
			await jamesJmgImageFormat.detect(
				sourceOf(data.subarray(0, HEADER_PASS_SIZE - 1)),
				"cg.jmg",
			),
		).toBe(false);
	});

	it("refuses a picture whose obfuscation hides no bitmap", () => {
		// The two letters of the format over a payload that is no bitmap header at all.
		const data: Buffer = Buffer.alloc(HEADER_PASS_SIZE, 0x5a);
		data[0] = 0xd4;
		data[1] = 0x24;
		expect(readJmgLayout(data)).toBeUndefined();
	});

	it("reports the measurements of the bitmap behind the obfuscation", async () => {
		for (const method of ["rotateWords", "reverseBits"] as JmgObfuscation[]) {
			const handle = await jamesJmgImageFormat.open(
				sourceOf(obfuscate(BMP, method)),
				"dir/cg.jmg",
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
		}
	});

	it("unfolds the bitmap and writes it out again", async () => {
		for (const method of ["rotateWords", "reverseBits"] as JmgObfuscation[]) {
			const out = await extract(obfuscate(BMP, method));
			expect(out.readUInt16LE(0x1c)).toBe(24);
			expect(out.readInt32LE(0x16)).toBe(-2);
			expect(out.subarray(0x36).toString("hex")).toBe(
				"01020304050600000708090a0b0c0000",
			);
		}
	});

	it("refuses a picture that ends in the middle of a word", async () => {
		const data = obfuscate(BMP, "rotateWords");
		// The header of the bitmap stands, but the file ends in half a word behind it.
		const file = Buffer.concat([data, Buffer.from([0x00])]);
		expect(readJmgLayout(file)).toBeDefined();
		await expect(extract(file)).rejects.toThrow(GarbroError);
		await expect(extract(file)).rejects.toThrow(
			"JAMES picture ends in the middle of a word",
		);
	});

	it("refuses a bitmap the picture is too short to hold", async () => {
		const data = obfuscate(BMP, "rotateWords");
		await expect(extract(data.subarray(0, data.length - 4))).rejects.toThrow(
			"Not a JAMES picture",
		);
	});
});
