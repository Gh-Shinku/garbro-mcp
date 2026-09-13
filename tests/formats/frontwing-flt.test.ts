import { BufferByteSource } from "@garbro-mcp/core";
import { frontWingFltFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

/** The substitution table from the reference, which the fixture needs to mask encrypted indexes. */
const DEFAULT_NAME_KEY = Buffer.from([
	0x00, 0x16, 0xc9, 0x4a, 0x91, 0x04, 0x5e, 0x20, 0x33, 0x14, 0x4b, 0x8a, 0x0a,
	0x70, 0x9f, 0x36, 0xaf, 0x0d, 0x93, 0xb0, 0x2b, 0xfe, 0x29, 0x72, 0x94, 0x99,
	0x9b, 0xed, 0xce, 0xc4, 0xf1, 0xf4, 0x9c, 0x1b, 0xe0, 0x02, 0x87, 0x82, 0x47,
	0xdf, 0xf3, 0xa9, 0xdc, 0xef, 0x3b, 0xb9, 0xc5, 0x83, 0xd8, 0x0f, 0x9a, 0xe2,
	0xbd, 0x28, 0x9e, 0xab, 0xb7, 0x3f, 0x75, 0x63, 0x2a, 0x5d, 0x05, 0x4e, 0x1f,
	0xcf, 0x61, 0xaa, 0x10, 0x77, 0xcc, 0x90, 0xd5, 0x43, 0xa6, 0xec, 0x88, 0x08,
	0x97, 0x7a, 0xf5, 0x42, 0xba, 0x3a, 0xf6, 0x7d, 0x8f, 0xb5, 0x18, 0x76, 0x40,
	0x6d, 0xac, 0x19, 0x1d, 0x4d, 0x38, 0x03, 0x8c, 0x01, 0x7b, 0xe7, 0xb3, 0x2f,
	0x67, 0xf8, 0x6a, 0x13, 0xad, 0xf0, 0x5b, 0x7c, 0x24, 0x6b, 0xc6, 0xc0, 0x06,
	0x89, 0x71, 0xdd, 0x23, 0x11, 0x09, 0x1a, 0xf9, 0xc2, 0x31, 0xb1, 0xbe, 0x8b,
	0x6e, 0xfa, 0x48, 0x52, 0xda, 0x17, 0x21, 0xd9, 0x60, 0x78, 0xa4, 0xa8, 0x26,
	0x79, 0x5c, 0x41, 0xbf, 0xd4, 0x3c, 0x1e, 0x86, 0xa7, 0x6f, 0xb8, 0x2c, 0xd2,
	0x57, 0x56, 0x58, 0x66, 0xe4, 0xca, 0x55, 0x44, 0xe8, 0x85, 0x53, 0x96, 0x7f,
	0x68, 0xc7, 0x73, 0x4c, 0xe6, 0x12, 0xb6, 0x98, 0xbc, 0xae, 0xee, 0xa0, 0xfc,
	0x69, 0x62, 0xc1, 0xe3, 0xb2, 0x95, 0xe9, 0x46, 0xcd, 0xd0, 0x50, 0x15, 0x9d,
	0x51, 0x30, 0x5a, 0x64, 0xf7, 0x8e, 0x07, 0xbb, 0xc8, 0xa2, 0x3e, 0xd3, 0x39,
	0xa5, 0x49, 0x5f, 0x3d, 0xd1, 0xcb, 0x0e, 0x54, 0xc3, 0x4f, 0x8d, 0x84, 0xdb,
	0x2d, 0x0b, 0xd7, 0x92, 0x7e, 0xe1, 0xeb, 0x81, 0xfd, 0x25, 0xea, 0x2e, 0xb4,
	0xd6, 0x37, 0xa1, 0xe5, 0x6c, 0x1c, 0x22, 0x45, 0xf2, 0x65, 0x74, 0x34, 0x35,
	0xde, 0x59, 0x27, 0xa3, 0xfb, 0x0c, 0x80, 0x32, 0xff,
]);

/** The inverse of the substitution table, since encryption is the plain direction. */
const INVERSE_NAME_KEY = Buffer.alloc(256);
for (const [plain, cipher] of DEFAULT_NAME_KEY.entries())
	INVERSE_NAME_KEY[cipher] = plain;

const HEADER_SIZE = 0x100;
const RECORD_SIZE = 0x100;

interface Entry {
	name: string;
	content: Buffer;
	/** The stored payload; defaults to the content. */
	stored?: Buffer;
	/** Compression method written into the record. */
	compression?: number;
	/** Whether the payload is exclusive-ored with its offset key. */
	encrypted?: boolean;
}

/** The key byte the reference folds out of a payload offset. */
function offsetKey(offset: number): number {
	let key = 0;
	for (let shift = 0; shift < 8; shift += 1)
		key ^= (Math.floor(offset / 2 ** (shift * 8)) & 0xff) >>> 0;
	return key & 0xff;
}

/** Builds a `LIB_PACKDATA0000` archive; the index is optionally substituted. */
function buildFlt(entries: readonly Entry[], encryptedIndex = false): Buffer {
	const index = Buffer.alloc(RECORD_SIZE * entries.length);
	const payloadBase = HEADER_SIZE + index.length;
	const offsets: number[] = [];
	let running = payloadBase;
	for (const entry of entries) {
		offsets.push(running);
		running += (entry.stored ?? entry.content).length;
	}
	const archive = Buffer.alloc(running);
	archive.write("LIB_PACKDATA0000", 0, "latin1");
	archive.writeInt32LE(entries.length, 0x14);
	archive.writeInt32LE(encryptedIndex ? 1 : 0, 0x1c);
	for (const [id, entry] of entries.entries()) {
		const record = id * RECORD_SIZE;
		const stored = Buffer.from(entry.stored ?? entry.content);
		if (entry.encrypted) {
			// A payload is stored exclusive-ored with the key folded from its own offset.
			const key = offsetKey(offsets[id] ?? 0);
			for (let position = 0; position < stored.length; position += 1)
				stored[position] = (stored[position] ?? 0) ^ key;
		}
		index.write(entry.name, record, "utf16le");
		index.writeUInt8(entry.compression ?? 0, record + 0xea);
		index.writeUInt8(entry.encrypted ? 1 : 0, record + 0xeb);
		index.writeUInt32LE(stored.length, record + 0xf0);
		index.writeUInt32LE(entry.content.length, record + 0xf4);
		index.writeBigInt64LE(BigInt(offsets[id] ?? 0), record + 0xf8);
		stored.copy(archive, offsets[id] ?? 0);
	}
	if (encryptedIndex)
		for (let position = 0; position < index.length; position += 1)
			index[position] = INVERSE_NAME_KEY[index[position] ?? 0] ?? 0;
	index.copy(archive, HEADER_SIZE);
	return archive;
}

describe("FrontWing resource archive", () => {
	it("lists stored and zlib entries", async () => {
		const raw = Buffer.from("stored frontwing payload");
		const content = Buffer.from("compressed frontwing payload, repeatable");
		await expectArchive({
			format: frontWingFltFormat,
			archive: buildFlt([
				{ name: "raw.bin", content: raw },
				{
					name: "packed.bin",
					content,
					stored: deflateSync(content),
					compression: 1,
				},
			]),
			entries: [
				{ path: "raw.bin", size: raw.length, content: raw },
				{ path: "packed.bin", size: content.length, content },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("unmasks an encrypted index", async () => {
		const content = Buffer.from("payload behind an encrypted index");
		await expectArchive({
			format: frontWingFltFormat,
			archive: buildFlt([{ name: "file.bin", content }], true),
			entries: [{ path: "file.bin", size: content.length, content }],
		});
	});

	it("decrypts a payload with the key folded from its offset", async () => {
		const content = Buffer.from("encrypted payload");
		await expectArchive({
			format: frontWingFltFormat,
			archive: buildFlt([{ name: "secret.bin", content, encrypted: true }]),
			entries: [{ path: "secret.bin", size: content.length, content }],
		});
	});

	it("decrypts behind the exclusive-or and inflates", async () => {
		const content = Buffer.from("encrypted and compressed payload, repeatable");
		await expectArchive({
			format: frontWingFltFormat,
			archive: buildFlt([
				{
					name: "both.bin",
					content,
					stored: deflateSync(content),
					compression: 1,
					encrypted: true,
				},
			]),
			entries: [{ path: "both.bin", size: content.length, content }],
		});
	});

	it("normalizes separators in UTF-16 names", async () => {
		const content = Buffer.from("nested payload");
		await expectArchive({
			format: frontWingFltFormat,
			archive: buildFlt([{ name: "dir\\file.bin", content }]),
			entries: [{ path: "dir/file.bin", size: content.length, content }],
		});
	});

	it("rejects an empty name", async () => {
		const archive = buildFlt([{ name: "", content: Buffer.from("x") }]);
		expect(
			await frontWingFltFormat.detect(
				new BufferByteSource(archive),
				"sample.flt",
			),
		).toBe(false);
	});

	it("rejects a foreign signature", async () => {
		const archive = buildFlt([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.write("LIB_PACKDATA0001", 0, "latin1");
		expect(
			await frontWingFltFormat.detect(
				new BufferByteSource(archive),
				"sample.flt",
			),
		).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildFlt([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeInt32LE(0x40000, 0x14);
		expect(
			await frontWingFltFormat.detect(
				new BufferByteSource(archive),
				"sample.flt",
			),
		).toBe(false);
	});

	it("rejects an index that reaches past the archive", async () => {
		const archive = buildFlt([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeInt32LE(2, 0x14);
		expect(
			await frontWingFltFormat.detect(
				new BufferByteSource(archive),
				"sample.flt",
			),
		).toBe(false);
	});

	it("rejects a payload outside the archive", async () => {
		const archive = buildFlt([{ name: "a.bin", content: Buffer.from("x") }]);
		// The index starts at 0x100, so the first record's offset field sits behind it.
		archive.writeBigInt64LE(0x10000n, 0x100 + 0xf8);
		expect(
			await frontWingFltFormat.detect(
				new BufferByteSource(archive),
				"sample.flt",
			),
		).toBe(false);
	});

	it("rejects a file too small for its header", async () => {
		expect(
			await frontWingFltFormat.detect(
				new BufferByteSource(Buffer.from("LIB_PACKDATA0000")),
				"sample.flt",
			),
		).toBe(false);
	});
});
