import { BufferByteSource } from "@garbro-mcp/core";
import { gsDataFormat, gsPackFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const PACK_HEADER_SIZE = 0x48;
const PACK_V4_ENTRY = 0x48;
const PACK_V5_ENTRY = 0x68;
const PACK_NAME_SIZE = 0x40;
const SYMBOL_ENTRY = 0x18;
const SYMBOL_HEADER_SIZE = 0xd0;

interface PackSpec {
	name: string;
	payload: Buffer;
}

interface PackOptions {
	marker?: string;
	major?: number;
	compressIndex?: boolean;
	plainIndex?: boolean;
	encryptIndex?: boolean;
	encryptData?: boolean;
}

/** Lays out a GsPack archive with either a raw or a literal-only LZSS index. */
function buildPack(specs: readonly PackSpec[], options?: PackOptions): Buffer {
	const entrySize = (options?.major ?? 4) < 5 ? PACK_V4_ENTRY : PACK_V5_ENTRY;
	const payloads: Buffer[] = [];
	const records = Buffer.alloc(entrySize * specs.length);
	let offset = 0;
	specs.forEach((spec, id) => {
		const base = id * entrySize;
		records.write(spec.name, base, "latin1");
		records.writeUInt32LE(offset, base + PACK_NAME_SIZE);
		records.writeUInt32LE(spec.payload.length, base + PACK_NAME_SIZE + 4);
		const payload = options?.encryptData
			? encryptPayload(spec.payload, spec.name)
			: spec.payload;
		payloads.push(payload);
		offset += payload.length;
	});
	const index = options?.compressIndex ? literalLzssStream(records) : records;
	if (options?.encryptIndex) {
		for (let position = 0; position < index.length; position += 1)
			index[position] = (index[position] ?? 0) ^ (position & 0xff);
	}
	// Payloads follow the index, and their records hold offsets relative to that position.
	const dataOffset = PACK_HEADER_SIZE + index.length;
	const indexOffset = PACK_HEADER_SIZE;
	const indexSize = options?.plainIndex ? 0 : index.length;
	const header = Buffer.alloc(PACK_HEADER_SIZE);
	header.write(options?.marker ?? "DataPack5", 0, "latin1");
	header.writeUInt16LE(0, 0x30);
	header.writeUInt16LE(options?.major ?? 4, 0x32);
	header.writeUInt32LE(indexSize, 0x34);
	header.writeUInt32LE(
		(options?.encryptIndex ? 1 : 0) | (options?.encryptData ? 2 : 0),
		0x38,
	);
	header.writeInt32LE(specs.length, 0x3c);
	header.writeUInt32LE(dataOffset, 0x40);
	header.writeInt32LE(indexOffset, 0x44);
	return Buffer.concat([header, index, ...payloads]);
}

/** Stores a payload as words XORed with a key derived from the entry name. */
function encryptPayload(payload: Buffer, name: string): Buffer {
	const stored = Buffer.from(payload);
	const key = packKey(name);
	for (let position = 0; position + 4 <= stored.length; position += 4)
		stored.writeUInt32LE((stored.readUInt32LE(position) ^ key) >>> 0, position);
	return stored;
}

/** Mirrors the name derived key of `PakOpener.DecryptData`. */
function packKey(name: string): number {
	let key = 0;
	for (let index = 0; index < name.length; index += 1)
		key = (key * 37 + (name.charCodeAt(index) | 0x20)) | 0;
	return key;
}

interface SymbolSpec {
	unpacked: Buffer;
	packedSize?: number;
}

/** Lays out a GsPack symbol archive with a literal-only LZSS index. */
function buildSymbol(
	specs: readonly SymbolSpec[],
	options?: { key?: number; payloads?: boolean },
): Buffer {
	const index = Buffer.alloc(SYMBOL_ENTRY * specs.length);
	const payloads: Buffer[] = [];
	let offset = 0;
	specs.forEach((spec, id) => {
		const base = id * SYMBOL_ENTRY;
		const stored = literalLzssStream(spec.unpacked);
		index.writeUInt32LE(offset, base);
		index.writeUInt32LE(spec.packedSize ?? stored.length, base + 4);
		index.writeUInt32LE(spec.unpacked.length, base + 8);
		payloads.push(stored);
		offset += stored.length;
	});
	const packed = literalLzssStream(index);
	const key = options?.key ?? 0;
	if (key !== 0) {
		for (let position = 0; position < packed.length; position += 1)
			packed[position] = (packed[position] ?? 0) ^ (position & key & 0xff);
	}
	// Payloads follow the packed index, and their records hold offsets relative to that position.
	const dataOffset = SYMBOL_HEADER_SIZE + packed.length;
	const header = Buffer.alloc(SYMBOL_HEADER_SIZE);
	header.write("GsSYMBOL5BINDATA", 0, "latin1");
	header.writeUInt32LE(SYMBOL_HEADER_SIZE, 0xa4);
	header.writeInt32LE(specs.length, 0xa8);
	header.writeUInt32LE(SYMBOL_HEADER_SIZE, 0xb8);
	header.writeUInt32LE(packed.length, 0xbc);
	header.writeUInt32LE(key, 0xc0);
	header.writeUInt32LE(index.length, 0xc4);
	header.writeUInt32LE(dataOffset, 0xc8);
	return Buffer.concat([header, packed, ...payloads]);
}

describe("GsPack resource archive", () => {
	it("reads a version 4 index", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: gsPackFormat,
			sourcePath: "image.pak",
			archive: buildPack(
				[
					{ name: "a.dat", payload: first },
					{ name: "b.dat", payload: second },
				],
				{ plainIndex: true },
			),
			entries: [
				{ path: "a.dat", size: first.length, content: first },
				{ path: "b.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2, encrypted: false },
		});
	});

	it("reads a version 5 index with wider records", async () => {
		const payload = Buffer.from("payload");
		await expectArchive({
			format: gsPackFormat,
			sourcePath: "sound.pak",
			archive: buildPack([{ name: "a.dat", payload }], {
				marker: "GsPack5",
				major: 5,
				plainIndex: true,
			}),
			entries: [{ path: "a.dat", size: payload.length, content: payload }],
		});
	});

	it("unpacks a compressed index", async () => {
		const payload = Buffer.from("payload");
		await expectArchive({
			format: gsPackFormat,
			sourcePath: "image.pak",
			archive: buildPack([{ name: "a.dat", payload }], {
				compressIndex: true,
			}),
			entries: [{ path: "a.dat", size: payload.length, content: payload }],
		});
	});

	it("decrypts a complemented index", async () => {
		const payload = Buffer.from("payload");
		await expectArchive({
			format: gsPackFormat,
			sourcePath: "image.pak",
			archive: buildPack([{ name: "a.dat", payload }], {
				compressIndex: true,
				encryptIndex: true,
			}),
			entries: [{ path: "a.dat", size: payload.length, content: payload }],
		});
	});

	it("reads a raw index", async () => {
		const payload = Buffer.from("payload");
		await expectArchive({
			format: gsPackFormat,
			sourcePath: "image.pak",
			archive: buildPack([{ name: "a.dat", payload }], { plainIndex: true }),
			entries: [{ path: "a.dat", size: payload.length, content: payload }],
		});
	});

	it("decrypts payloads with a name derived key", async () => {
		const payload = Buffer.from("12345678 payload bytes");
		await expectArchive({
			format: gsPackFormat,
			sourcePath: "voice.pak",
			archive: buildPack([{ name: "voice.dat", payload }], {
				encryptData: true,
				plainIndex: true,
			}),
			entries: [{ path: "voice.dat", size: payload.length, content: payload }],
			metadata: { encrypted: true },
		});
	});

	it("types entries from the archive name", async () => {
		const payload = Buffer.from("payload");
		const archive = await gsPackFormat.open(
			new BufferByteSource(buildPack([{ name: "a.dat", payload }])),
			"image.pak",
		);
		expect(archive.entries[0]?.metadata?.type).toBe("image");
	});

	it("rejects a wrong marker", async () => {
		const file = buildPack([{ name: "a.dat", payload: Buffer.from("x") }], {
			marker: "DataPack9",
		});
		expect(await gsPackFormat.detect(new BufferByteSource(file), "a.pak")).toBe(
			false,
		);
	});

	it("rejects an index size above the limit", async () => {
		const file = buildPack([{ name: "a.dat", payload: Buffer.from("x") }]);
		file.writeUInt32LE(0x1000000, 0x34);
		expect(await gsPackFormat.detect(new BufferByteSource(file), "a.pak")).toBe(
			false,
		);
	});

	it("rejects an entry outside the file", async () => {
		const file = buildPack([{ name: "a.dat", payload: Buffer.from("x") }], {
			plainIndex: true,
		});
		file.writeUInt32LE(0x1000, PACK_HEADER_SIZE + PACK_NAME_SIZE + 4);
		expect(await gsPackFormat.detect(new BufferByteSource(file), "a.pak")).toBe(
			false,
		);
	});

	it("rejects an insane count", async () => {
		const file = buildPack([{ name: "a.dat", payload: Buffer.from("x") }]);
		file.writeInt32LE(0, 0x3c);
		expect(await gsPackFormat.detect(new BufferByteSource(file), "a.pak")).toBe(
			false,
		);
	});
});

describe("GsPack symbol archive", () => {
	it("reads a compressed symbol index", async () => {
		const first = Buffer.from("symbol one");
		const second = Buffer.from("symbol two");
		await expectArchive({
			format: gsDataFormat,
			archive: buildSymbol([{ unpacked: first }, { unpacked: second }]),
			entries: [
				{ path: "00000", size: first.length, content: first },
				{ path: "00001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("decrypts a keyed index", async () => {
		const payload = Buffer.from("symbol payload");
		await expectArchive({
			format: gsDataFormat,
			archive: buildSymbol([{ unpacked: payload }], { key: 0x5a }),
			entries: [{ path: "00000", size: payload.length, content: payload }],
		});
	});

	it("returns nothing for an empty stored entry", async () => {
		const payload = Buffer.from("symbol");
		await expectArchive({
			format: gsDataFormat,
			archive: buildSymbol([{ unpacked: payload, packedSize: 0 }]),
			entries: [
				{ path: "00000", size: payload.length, content: Buffer.alloc(0) },
			],
		});
	});

	it("rejects a wrong marker", async () => {
		const file = buildSymbol([{ unpacked: Buffer.from("x") }]);
		file.write("GsSYMBOL4BINDATA", 0, "latin1");
		expect(await gsDataFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects a short header", async () => {
		const file = buildSymbol([{ unpacked: Buffer.from("x") }]);
		file.writeUInt32LE(0x40, 0xa4);
		expect(await gsDataFormat.detect(new BufferByteSource(file))).toBe(false);
	});

	it("rejects a mismatched unpacked index size", async () => {
		const file = buildSymbol([{ unpacked: Buffer.from("x") }]);
		file.writeUInt32LE(0x30, 0xc4);
		expect(await gsDataFormat.detect(new BufferByteSource(file))).toBe(false);
	});
});
