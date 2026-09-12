import { BufferByteSource, encodeCp932, GarbroError } from "@garbro-mcp/core";
import { BgiArcFormat, BurikoArcFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

function updateDscKey(state: { key: number; magic: number }): number {
	const lowProduct = 20021 * (state.key & 0xffff);
	let high = (state.magic | (state.key >>> 16)) >>> 0;
	high = (Math.imul(high, 20021) + Math.imul(state.key, 346)) >>> 0;
	high = (high + (lowProduct >>> 16)) & 0xffff;
	state.key = ((high << 16) + (lowProduct & 0xffff) + 1) >>> 0;
	return high & 0xff;
}

function packBits(bits: number[]): Buffer {
	const output = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		output[index >> 3] = (output[index >> 3] ?? 0) | (bit << (7 - (index & 7)));
	}
	return output;
}

function buildDsc(): { packed: Buffer; output: Buffer } {
	const output = Buffer.from("AAAAAA");
	const bits = [
		0,
		0,
		1,
		...Array<number>(12).fill(0),
		1,
		...Array<number>(12).fill(0),
	];
	const packedBits = packBits(bits);
	const packed = Buffer.alloc(0x220 + packedBits.length);
	packed.write("DSC FORMAT 1.00\0", 0, "binary");
	const initialKey = 0x12345678;
	packed.writeUInt32LE(initialKey, 0x10);
	packed.writeUInt32LE(output.length, 0x14);
	packed.writeUInt32LE(4, 0x18);
	const depths = new Uint8Array(512);
	depths[65] = 1;
	depths[256] = 1;
	const state = {
		key: initialKey,
		magic: (packed.readUInt16LE(0) << 16) >>> 0,
	};
	for (let index = 0; index < depths.length; index += 1) {
		packed[0x20 + index] = ((depths[index] ?? 0) + updateDscKey(state)) & 0xff;
	}
	packedBits.copy(packed, 0x220);
	return { packed, output };
}

interface TestBseGenerator {
	nextKey(): number;
}

function createBseGenerator(
	version: number,
	initialKey: number,
): TestBseGenerator {
	let key = initialKey | 0;
	return {
		nextKey(): number {
			const value =
				version === 0x100
					? ((Math.imul(key, 257) >> 8) + Math.imul(key, 97) + 23) ^ 0xa6cd9b75
					: ((Math.imul(key, 127) >> 7) + Math.imul(key, 83) + 53) ^ 0xb97a7e5c;
			key = (((value >>> 16) | (value << 16)) >>> 0) | 0;
			return key;
		},
	};
}

function rotateLeft8(value: number, shift: number): number {
	if (shift === 0) return value & 0xff;
	return ((value << shift) | (value >>> (8 - shift))) & 0xff;
}

function rotateRight8(value: number, shift: number): number {
	if (shift === 0) return value & 0xff;
	return ((value >>> shift) | (value << (8 - shift))) & 0xff;
}

function buildBse(
	version: number,
	key: number,
): { packed: Buffer; output: Buffer } {
	const decodedHeader = Buffer.alloc(0x40);
	Buffer.from(`decoded BSE ${version.toString(16)} header`, "ascii").copy(
		decodedHeader,
	);
	const encryptedHeader = Buffer.alloc(0x40);
	const generator = createBseGenerator(version, key);
	const occupied = new Uint8Array(0x40);
	for (let index = 0; index < occupied.length; index += 1) {
		let destination = generator.nextKey() & 0x3f;
		while (occupied[destination] !== 0) destination = (destination + 1) & 0x3f;
		const shift = generator.nextKey() & 7;
		const rightShift = (generator.nextKey() & 1) === 0;
		const plain = decodedHeader[destination] ?? 0;
		const symbol = rightShift
			? rotateLeft8(plain, shift)
			: rotateRight8(plain, shift);
		encryptedHeader[destination] = (symbol + generator.nextKey()) & 0xff;
		occupied[destination] = 1;
	}
	const body = Buffer.from(`BSE ${version.toString(16)} body`, "ascii");
	const packed = Buffer.alloc(0x50 + body.length);
	packed.write("BSE 1.", 0, "ascii");
	packed.writeUInt16LE(version, 8);
	packed.writeUInt32LE(key, 0x0c);
	encryptedHeader.copy(packed, 0x10);
	body.copy(packed, 0x50);
	return { packed, output: Buffer.concat([decodedHeader, body]) };
}

function buildArchive(
	signature: string,
	recordSize: number,
	nameSize: number,
	offsetPosition: number,
	sizePosition: number,
	definitions: Array<{ name: string; stored: Buffer }>,
): Buffer {
	const baseOffset = 0x10 + definitions.length * recordSize;
	const archive = Buffer.alloc(
		baseOffset +
			definitions.reduce((sum, entry) => sum + entry.stored.length, 0),
	);
	archive.write(signature, 0, "ascii");
	archive.writeUInt32LE(definitions.length, 12);
	let dataOffset = baseOffset;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 0x10 + index * recordSize;
		encodeCp932(definition.name).copy(archive, recordOffset, 0, nameSize);
		archive.writeUInt32LE(
			dataOffset - baseOffset,
			recordOffset + offsetPosition,
		);
		archive.writeUInt32LE(
			definition.stored.length,
			recordOffset + sizePosition,
		);
		definition.stored.copy(archive, dataOffset);
		dataOffset += definition.stored.length;
	}
	return archive;
}

describe("BGI/Ethornell archives", () => {
	it("reads PackFile indexes and expands DSC Huffman/LZ entries", async () => {
		const dsc = buildDsc();
		const raw = Buffer.from("CompressedBG raw image");
		const fixture = buildArchive("PackFile    ", 0x20, 0x10, 0x10, 0x14, [
			{ name: "圧縮._bp", stored: dsc.packed },
			{ name: "raw.bin", stored: raw },
		]);
		const format = new BgiArcFormat();
		const source = new BufferByteSource(fixture);
		expect(await format.detect(source)).toBe(true);
		const archive = await format.open(source, "sample.arc");
		try {
			expect(archive.entries).toMatchObject([
				{ path: "圧縮._bp", compressed: true, size: 6n },
				{
					path: "raw.bin",
					compressed: false,
					metadata: { inferredType: "image" },
				},
			]);
			expect(await consumeBuffer(await archive.openEntry("0"))).toEqual(
				dsc.output,
			);
			expect(await consumeBuffer(await archive.openEntry("1"))).toEqual(raw);
		} finally {
			await archive.close();
		}
	});

	it("reads BURIKO ARC20 indexes and decrypts BSE 1.00/1.01 headers", async () => {
		const bse100 = buildBse(0x100, 0x10203040);
		const bse101 = buildBse(0x101, 0x89abcdef);
		const fixture = buildArchive("BURIKO ARC20", 0x80, 0x60, 0x60, 0x64, [
			{ name: "first.bse", stored: bse100.packed },
			{ name: "second.bse", stored: bse101.packed },
		]);
		const archive = await new BurikoArcFormat().open(
			new BufferByteSource(fixture),
			"sample.arc",
		);
		try {
			expect(archive.entries).toMatchObject([
				{
					path: "first.bse",
					encrypted: true,
					size: BigInt(bse100.output.length),
				},
				{
					path: "second.bse",
					encrypted: true,
					size: BigInt(bse101.output.length),
				},
			]);
			expect(await consumeBuffer(await archive.openEntry("0"))).toEqual(
				bse100.output,
			);
			expect(await consumeBuffer(await archive.openEntry("1"))).toEqual(
				bse101.output,
			);
		} finally {
			await archive.close();
		}
	});

	it("rejects an entry outside the archive", async () => {
		const fixture = buildArchive("PackFile    ", 0x20, 0x10, 0x10, 0x14, [
			{ name: "bad.bin", stored: Buffer.from("data") },
		]);
		fixture.writeUInt32LE(fixture.length, 0x20);
		await expect(
			new BgiArcFormat().open(new BufferByteSource(fixture), "broken.arc"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
