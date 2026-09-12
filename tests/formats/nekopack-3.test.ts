import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import {
	decryptNekoPack3Data,
	initializeNekoPack3Key,
	NekoPack3Format,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const KEY_SEED = 0x12345678;
const INDEX_SEED = 0x2468;
const ENTRY_SEED = 0x1357;

function decryptReference(
	data: Buffer,
	key: Buffer,
	initialSeed: number,
	initialize = false,
): void {
	let seed = initialSeed & 0xffff;
	for (let offset = 0; offset + 4 <= data.length; offset += 4) {
		const source = data.readUInt32LE(offset);
		seed = (seed + 0xc3) & 0x1ff;
		const value = (source ^ key.readUInt32LE(seed)) >>> 0;
		seed = (seed + ((initialize ? source : value) & 0xffff)) & 0xffff;
		data.writeUInt32LE(value, offset);
	}
}

function initializeReference(encryptedKey: Buffer, seed: number): Buffer {
	const key = Buffer.from(encryptedKey);
	for (let count = (seed % 7) + 3; count > 0; count -= 1)
		decryptReference(key, key, seed, true);
	return key;
}

function encryptReference(
	plain: Buffer,
	key: Buffer,
	initialSeed: number,
): Buffer {
	const output = Buffer.alloc(plain.length);
	let seed = initialSeed & 0xffff;
	for (let offset = 0; offset + 4 <= plain.length; offset += 4) {
		const value = plain.readUInt32LE(offset);
		seed = (seed + 0xc3) & 0x1ff;
		output.writeUInt32LE((value ^ key.readUInt32LE(seed)) >>> 0, offset);
		seed = (seed + (value & 0xffff)) & 0xffff;
	}
	plain.subarray(plain.length & ~3).copy(output, plain.length & ~3);
	return output;
}

function lengthPrefixedName(name: string): Buffer {
	const bytes = Buffer.concat([encodeCp932(name), Buffer.from([0])]);
	return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}

function buildNekoPack3(): {
	archive: Buffer;
	content: Buffer;
	initializedKey: Buffer;
} {
	const encryptedKey = Buffer.alloc(0x400);
	for (let index = 0; index < encryptedKey.length; index += 1)
		encryptedKey[index] = (index * 29 + 7) & 0xff;
	const initializedKey = initializeReference(encryptedKey, KEY_SEED);
	const content = Buffer.from("NekoPack v3 data", "ascii");
	const directoryName = lengthPrefixedName("画像");
	const fileName = lengthPrefixedName("立絵.bin");
	const index = Buffer.concat([
		Buffer.from([1, 0, 0, 0]),
		directoryName,
		Buffer.from([1, 0, 0, 0]),
		Buffer.from([0]),
		fileName,
		Buffer.from([0, 0, 0, 0]),
	]);
	const archive = Buffer.alloc(0x41c + index.length + 12 + content.length);
	archive.write("NEKOPACK", 0, "ascii");
	archive.writeUInt32LE(KEY_SEED, 12);
	encryptedKey.copy(archive, 16);
	archive.writeUInt16LE(INDEX_SEED, 0x410);
	const indexInfo = Buffer.alloc(8);
	indexInfo.writeUInt32LE(index.length, 0);
	indexInfo.writeUInt32LE(index.length, 4);
	encryptReference(indexInfo, initializedKey, INDEX_SEED).copy(archive, 0x414);
	encryptReference(index, initializedKey, INDEX_SEED).copy(archive, 0x41c);
	const entryOffset = 0x41c + index.length;
	archive.writeUInt16LE(ENTRY_SEED, entryOffset);
	const sizes = Buffer.alloc(8);
	sizes.writeUInt32LE(content.length, 0);
	sizes.writeUInt32LE(content.length, 4);
	encryptReference(sizes, initializedKey, ENTRY_SEED).copy(
		archive,
		entryOffset + 4,
	);
	encryptReference(content, initializedKey, ENTRY_SEED).copy(
		archive,
		entryOffset + 12,
	);
	return { archive, content, initializedKey };
}

describe("NekoPack version 3", () => {
	it("matches fixed key initialization and data vectors", () => {
		const fixture = buildNekoPack3();
		expect(
			initializeNekoPack3Key(fixture.archive.subarray(16, 0x410), KEY_SEED)
				.subarray(0, 16)
				.toString("hex"),
		).toBe("bd8264acdd1efd9f2db69327f1fecf02");
		const data = encryptReference(
			fixture.content,
			fixture.initializedKey,
			ENTRY_SEED,
		);
		expect(data.toString("hex")).toBe("69cb9e515330f0b6bbed8a129e5ce453");
		decryptNekoPack3Data(data, fixture.initializedKey, ENTRY_SEED);
		expect(data).toEqual(fixture.content);
	});

	it("reads CP932 paths and extracts encrypted entries", async () => {
		const fixture = buildNekoPack3();
		const format = new NekoPack3Format();
		const source = new BufferByteSource(fixture.archive);
		expect(await format.detect(source)).toBe(true);
		const archive = await format.open(source, "sample.dat");
		try {
			expect(archive.metadata).toMatchObject({ version: 3 });
			expect(archive.entries).toMatchObject([
				{ path: "画像/立絵.bin", size: 16n, encrypted: true },
			]);
			expect(await consumeBuffer(await archive.openEntry("0"))).toEqual(
				fixture.content,
			);
		} finally {
			await archive.close();
		}
	});
});
