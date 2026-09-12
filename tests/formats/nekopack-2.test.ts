import { BufferByteSource } from "@garbro-mcp/core";
import {
	decryptNekoPack2Block,
	hashNekoPack2Name,
	NekoPack2Format,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const INITIAL_KEY = 0x13579bdf;
const INDEX_KEY = 0x2468ace0;
const ENTRY_KEY = 0x10293847;
const MASK = 0xffff_ffff_ffff_ffffn;

function byteSwap32(value: number): number {
	return (
		((value >>> 24) |
			((value >>> 8) & 0xff00) |
			((value & 0xff00) << 8) |
			(value << 24)) >>>
		0
	);
}

function nextRandom(value: number, key: number): number {
	const mixed = (key ^ value) >>> 0;
	return (
		((mixed << 4) ^ (mixed >>> 4) ^ (mixed << 3) ^ (mixed >>> 3) ^ mixed) >>> 0
	);
}

function randomTable(initialKey: number): Uint32Array {
	let key = initialKey >>> 0;
	let a = 0;
	let b = 0;
	do {
		a = (a << 1) >>> 0;
		b ^= 1;
		a = ((((a | b) << (key & 1)) >>> 0) | b) >>> 0;
		key >>>= 1;
	} while ((a & 0x80000000) === 0);
	key = (a << 1) >>> 0;
	a = (key + byteSwap32(key)) >>> 0;
	let count = key & 0xff;
	do {
		a = nextRandom(a, key);
		count = (count - 1) & 0xff;
	} while (count !== 0);
	const table = new Uint32Array(154);
	for (let index = 0; index < table.length; index += 1) {
		a = nextRandom(a, key);
		table[index] = a;
	}
	return table;
}

function lanes(
	left: bigint,
	right: bigint,
	bits: number,
	subtract: boolean,
): bigint {
	const width = BigInt(bits);
	const mask = (1n << width) - 1n;
	let result = 0n;
	for (let shift = 0n; shift < 64n; shift += width) {
		const lhs = (left >> shift) & mask;
		const rhs = (right >> shift) & mask;
		result |= ((subtract ? lhs - rhs : lhs + rhs) & mask) << shift;
	}
	return result & MASK;
}

function inverse(command: number, left: bigint, right: bigint): bigint {
	if (command === 0 || command === 7) return left ^ right;
	const decryptSubtract = command >= 4 && command <= 10;
	const bits =
		command === 1 || command === 4 || command === 8 || command === 11
			? 8
			: command === 2 || command === 5 || command === 9 || command === 12
				? 16
				: 32;
	return lanes(left, right, bits, !decryptSubtract);
}

function encryptBlock(
	initialKey: number,
	blockKey: number,
	plain: Buffer,
): Buffer {
	const random = randomTable(initialKey);
	const mm = Array<bigint>(7).fill(0n);
	let selector = blockKey >>> 0;
	for (let index = 1; index < 7; index += 1) {
		const source = (selector % 0x28) * 2;
		mm[index] =
			BigInt(random[source] ?? 0) | (BigInt(random[source + 1] ?? 0) << 32n);
		selector = Math.floor(selector / 0x28);
	}
	const t1 = 7 + (initialKey >>> 28);
	const commandBase = initialKey & 0xffff;
	const argumentBase = (initialKey >>> 16) & 0xfff;
	const transforms: Array<[number, number]> = [];
	for (let index = 3; index >= 0; index -= 1)
		transforms.push([
			((commandBase >>> (4 * index)) + t1) % 14,
			((argumentBase >>> (3 * index)) % 6) + 1,
		]);
	const shuffles = Array.from(
		{ length: 6 },
		(_, index) => (index + initialKey) % 6,
	);
	const output = Buffer.alloc(plain.length);
	for (let offset = 0; offset < plain.length; offset += 8) {
		let value = plain.readBigUInt64LE(offset);
		for (const [command, argument] of transforms.toReversed())
			value = inverse(command, value, mm[argument] ?? 0n);
		output.writeBigUInt64LE(value & MASK, offset);
		if (offset + 8 < plain.length) {
			for (const shuffle of shuffles) {
				const left = shuffle + 1;
				const right = left === 6 ? 1 : left + 1;
				mm[left] = ((mm[left] ?? 0n) + (mm[right] ?? 0n)) & MASK;
			}
		}
	}
	return output;
}

function buildNekoPack2(): { archive: Buffer; content: Buffer } {
	const content = Buffer.from("NekoPack v2 data", "ascii");
	const directoryHash = hashNekoPack2Name(INITIAL_KEY, Buffer.from("script"));
	const nameHash = hashNekoPack2Name(INITIAL_KEY, Buffer.from("scene.bin"));
	const indexSize = 20;
	const alignedIndexSize = 24;
	const storageSize = 12 + content.length;
	const index = Buffer.alloc(alignedIndexSize);
	index.writeUInt32LE(directoryHash, 0);
	index.writeUInt32LE(1, 4);
	index.writeUInt32LE(1, 8);
	index.writeUInt32LE(nameHash, 12);
	index.writeUInt32LE(storageSize, 16);
	const archive = Buffer.alloc(0x1c + alignedIndexSize + storageSize);
	archive.write("NEKOPACK", 0, "ascii");
	archive.writeUInt32LE(INITIAL_KEY, 12);
	archive.writeUInt32LE(INDEX_KEY, 16);
	const indexInfo = Buffer.alloc(8);
	indexInfo.writeUInt32LE(indexSize, 0);
	indexInfo.writeUInt32LE(indexSize, 4);
	encryptBlock(INITIAL_KEY, INDEX_KEY, indexInfo).copy(archive, 20);
	encryptBlock(INITIAL_KEY, INDEX_KEY, index).copy(archive, 0x1c);
	const entryOffset = 0x1c + alignedIndexSize;
	archive.writeUInt32LE(ENTRY_KEY, entryOffset);
	const sizes = Buffer.alloc(8);
	sizes.writeUInt32LE(content.length, 0);
	sizes.writeUInt32LE(content.length, 4);
	encryptBlock(INITIAL_KEY, ENTRY_KEY, sizes).copy(archive, entryOffset + 4);
	encryptBlock(INITIAL_KEY, ENTRY_KEY, content).copy(archive, entryOffset + 12);
	return { archive, content };
}

describe("NekoPack version 2", () => {
	it("matches fixed hash and dynamic-program vectors", () => {
		expect(hashNekoPack2Name(INITIAL_KEY, Buffer.from("script"))).toBe(
			0xf8c6c03c,
		);
		const data = encryptBlock(
			INITIAL_KEY,
			ENTRY_KEY,
			Buffer.from("NekoPack v2 data", "ascii"),
		);
		expect(data.toString("hex")).toBe("c5ecdc5d06a5a25d0d0078a9ad999896");
		decryptNekoPack2Block(INITIAL_KEY, ENTRY_KEY, data);
		expect(data).toEqual(Buffer.from("NekoPack v2 data", "ascii"));
	});

	it("decrypts the index, recovers names, and extracts an entry", async () => {
		const fixture = buildNekoPack2();
		const format = new NekoPack2Format({ knownFileNames: ["scene.bin"] });
		const source = new BufferByteSource(fixture.archive);
		expect(await format.detect(source)).toBe(true);
		const archive = await format.open(source, "sample.dat");
		try {
			expect(archive.metadata).toMatchObject({ version: 2 });
			expect(archive.entries).toMatchObject([
				{ path: "script/scene.bin", size: 16n, packedSize: 28n },
			]);
			expect(await consumeBuffer(await archive.openEntry("0"))).toEqual(
				fixture.content,
			);
		} finally {
			await archive.close();
		}
	});
});
