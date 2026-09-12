import { BufferByteSource } from "@garbro-mcp/core";
import {
	decryptNekoPack1Block,
	hashNekoPack1Name,
	NekoPack1Format,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SEED = 0x9b75ada7;

function addPackedWords(left: bigint, right: bigint): bigint {
	let result = 0n;
	for (let shift = 0n; shift < 64n; shift += 16n)
		result |= (((left >> shift) + (right >> shift)) & 0xffffn) << shift;
	return result;
}

function keyFromHash(hash: number): bigint {
	const v2 = (hash ^ ((hash + 1_566_083_941) >>> 0)) >>> 0;
	const v3 = (v2 ^ ((hash - 899_497_514) >>> 0)) >>> 0;
	const low = (v3 ^ ((v2 - 1_894_007_588) >>> 0)) >>> 0;
	const high = (low ^ ((v3 + 1_812_433_253) >>> 0)) >>> 0;
	return BigInt(low) | (BigInt(high) << 32n);
}

function encryptBlock(hash: number, plain: Buffer): Buffer {
	const output = Buffer.alloc(plain.length);
	let key = keyFromHash(hash);
	for (let offset = 0; offset < plain.length; offset += 8) {
		const value = plain.readBigUInt64LE(offset);
		output.writeBigUInt64LE(value ^ key, offset);
		key = addPackedWords(key, value);
	}
	return output;
}

function buildNekoPack1(): { archive: Buffer; content: Buffer } {
	const content = Buffer.from("NEKOPACK v1 data", "ascii");
	const index = Buffer.alloc(16);
	index.writeUInt32LE(0x0ddb021e, 0); // "script"
	index.writeUInt32LE(1, 4);
	index.writeUInt32LE(0xcb8fb53b, 8); // "start.bin"
	index.writeUInt32LE(content.length, 12);
	const indexKey = 0x12345678;
	const entryKey = 0x89abcdef;
	const archive = Buffer.alloc(0x18 + index.length + 8 + content.length);
	archive.write("NEKOPACK", 0, "ascii");
	archive.writeUInt32LE(SEED, 8);
	archive.writeUInt32LE(indexKey, 0x10);
	archive.writeUInt32LE(index.length, 0x14);
	encryptBlock(indexKey, index).copy(archive, 0x18);
	const entryOffset = 0x18 + index.length;
	archive.writeUInt32LE(entryKey, entryOffset);
	archive.writeUInt32LE(content.length, entryOffset + 4);
	encryptBlock(entryKey, content).copy(archive, entryOffset + 8);
	return { archive, content };
}

describe("NekoPack version 1", () => {
	it("matches GARbro filename hash vectors", () => {
		expect(hashNekoPack1Name(SEED, Buffer.from("script"))).toBe(0x0ddb021e);
		expect(hashNekoPack1Name(SEED, Buffer.from("start.bin"))).toBe(0xcb8fb53b);
	});

	it("decrypts a fixed block vector", () => {
		const data = Buffer.from("a70f21885aaf812a17e684363e4e71cc", "hex");
		decryptNekoPack1Block(0x89abcdef, data);
		expect(data).toEqual(Buffer.from("NEKOPACK v1 data", "ascii"));
	});

	it("lists hashed names and extracts encrypted entries", async () => {
		const fixture = buildNekoPack1();
		const format = new NekoPack1Format({ knownFileNames: ["start.bin"] });
		const source = new BufferByteSource(fixture.archive);
		expect(await format.detect(source)).toBe(true);
		const archive = await format.open(source, "sample.dat");
		try {
			expect(archive.metadata).toMatchObject({ version: 1 });
			expect(archive.entries).toMatchObject([
				{ path: "script/start.bin", size: 16n, encrypted: true },
			]);
			expect(await consumeBuffer(await archive.openEntry("0"))).toEqual(
				fixture.content,
			);
		} finally {
			await archive.close();
		}
	});

	it("uses hexadecimal names when no filename list is supplied", async () => {
		const fixture = buildNekoPack1();
		const archive = await new NekoPack1Format().open(
			new BufferByteSource(fixture.archive),
			"sample.dat",
		);
		try {
			expect(archive.entries[0]?.path).toBe("script/CB8FB53B");
		} finally {
			await archive.close();
		}
	});
});
