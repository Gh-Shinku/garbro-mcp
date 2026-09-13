import { Blowfish } from "@garbro-mcp/codecs";
import { BufferByteSource } from "@garbro-mcp/core";
import { tanukiTacFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_KEY = Buffer.from("TLibArchiveData", "ascii");
const KEY_SUFFIX = "_tlib_secure_";
const BLOCK_SIZE = 8;
const BUCKET_SIZE = 8;
const ENTRY_SIZE = 24;
const V110_INDEX_OFFSET = 0x2c;
const V100_INDEX_OFFSET = 0x24;

interface Spec {
	hash: bigint;
	plain: Buffer;
	packed?: boolean;
}

interface BucketSpec {
	hash: number;
	count: number;
	index: number;
}

/**
 * Blowfish enciphering that inverts GARbro's `Decipher`: the reference reads and writes little-endian
 * halves while its `Encipher` helper switches to big-endian, so the fixtures use the word level API.
 */
function encryptBlockwise(data: Buffer, key: Buffer): Buffer {
	const blowfish = new Blowfish(key);
	const output = Buffer.alloc(data.length);
	for (let offset = 0; offset < data.length; offset += BLOCK_SIZE) {
		const [left, right] = blowfish.encipherWords(
			data.readUInt32LE(offset),
			data.readUInt32LE(offset + 4),
		);
		output.writeUInt32LE(left, offset);
		output.writeUInt32LE(right, offset + 4);
	}
	return output;
}

function entryKey(hash: bigint): Buffer {
	return Buffer.from(`${hash.toString(10)}${KEY_SUFFIX}`, "ascii");
}

function hashName(hash: bigint): string {
	return hash.toString(16).toUpperCase().padStart(16, "0");
}

/** Mirrors the type sniffing of the opener: bitmap payloads count as images and keep a plain tail. */
function isImagePlain(plain: Buffer): boolean {
	if (plain.length < BLOCK_SIZE) return false;
	return (plain.readUInt32LE(0) & 0xffff) === 0x4d42;
}

/** Encrypts exactly the bytes the opener deciphers, leaving any tail in the clear. */
function encryptPayload(plain: Buffer, hash: bigint): Buffer {
	const stored = Buffer.from(plain);
	if (isImagePlain(plain)) {
		const encryptedSize = Math.min(10240, plain.length);
		encryptBlockwise(plain.subarray(0, encryptedSize), entryKey(hash)).copy(
			stored,
			0,
		);
		return stored;
	}
	const whole = plain.length & ~(BLOCK_SIZE - 1);
	encryptBlockwise(plain.subarray(0, whole), entryKey(hash)).copy(stored, 0);
	return stored;
}

/** Lays out a TanukiSoft archive with a Blowfish protected, zlib packed index. */
function buildTac(
	specs: readonly Spec[],
	options?: {
		version?: string;
		buckets?: readonly BucketSpec[];
		seed?: number;
	},
): Buffer {
	const buckets = options?.buckets ?? [];
	const indexOffset =
		options?.version === "1.00" ? V100_INDEX_OFFSET : V110_INDEX_OFFSET;
	const bucketTable = Buffer.alloc(buckets.length * BUCKET_SIZE);
	buckets.forEach((bucket, id) => {
		const base = id * BUCKET_SIZE;
		bucketTable.writeUInt16LE(bucket.hash, base);
		bucketTable.writeUInt16LE(bucket.count, base + 2);
		bucketTable.writeInt32LE(bucket.index, base + 4);
	});
	const payloads: Buffer[] = [];
	const records = Buffer.alloc(specs.length * ENTRY_SIZE);
	let payloadOffset = 0;
	specs.forEach((spec, id) => {
		const base = id * ENTRY_SIZE;
		// Entry hashes are completed by the bucket table, mirroring the opener.
		const bucket = buckets.find(
			(candidate) =>
				id >= candidate.index && id < candidate.index + candidate.count,
		);
		const hash = bucket
			? ((spec.hash << 16n) | BigInt(bucket.hash)) & 0xffffffffffffffffn
			: spec.hash;
		const stored = spec.packed
			? deflateSync(spec.plain)
			: encryptPayload(spec.plain, hash);
		records.writeBigUInt64LE(spec.hash, base);
		records.writeInt32LE(spec.packed ? 1 : 0, base + 8);
		records.writeUInt32LE(spec.plain.length, base + 12);
		records.writeUInt32LE(payloadOffset, base + 16);
		records.writeUInt32LE(stored.length, base + 20);
		payloads.push(stored);
		payloadOffset += stored.length;
	});
	const plainIndex = Buffer.concat([bucketTable, records]);
	const compressed = deflateSync(plainIndex);
	const indexSize = compressed.length;
	const encrypted = Buffer.concat([
		encryptBlockwise(
			compressed.subarray(0, indexSize & ~(BLOCK_SIZE - 1)),
			INDEX_KEY,
		),
		compressed.subarray(indexSize & ~(BLOCK_SIZE - 1)),
	]);
	const header = Buffer.alloc(indexOffset);
	header.write("TArc", 0, "latin1");
	header.write(options?.version ?? "1.10", 4, "latin1");
	header.writeInt32LE(specs.length, 0x14);
	header.writeInt32LE(buckets.length, 0x18);
	header.writeUInt32LE(indexSize, 0x1c);
	header.writeUInt32LE(options?.seed ?? 0x12345678, 0x20);
	return Buffer.concat([header, encrypted, ...payloads]);
}

describe("TanukiSoft resource archive", () => {
	it("reads uncompressed entries", async () => {
		const first = Buffer.from("first entry plain");
		const second = Buffer.from("second entry data");
		await expectArchive({
			format: tanukiTacFormat,
			sourcePath: "data.tac",
			archive: buildTac([
				{ hash: 0x1122334455667788n, plain: first },
				{ hash: 0x99aabbccddeeff00n, plain: second },
			]),
			entries: [
				{
					path: hashName(0x1122334455667788n),
					size: first.length,
					content: first,
				},
				{
					path: hashName(0x99aabbccddeeff00n),
					size: second.length,
					content: second,
				},
			],
			metadata: { entryCount: 2, seed: 0x12345678 },
		});
	});

	it("reads a version 1.00 index", async () => {
		const plain = Buffer.from("legacy entry");
		await expectArchive({
			format: tanukiTacFormat,
			archive: buildTac([{ hash: 0x0102030405060708n, plain }], {
				version: "1.00",
			}),
			entries: [
				{
					path: hashName(0x0102030405060708n),
					size: plain.length,
					content: plain,
				},
			],
		});
	});

	it("inflates packed entries", async () => {
		const plain = Buffer.from("packed entry contents");
		await expectArchive({
			format: tanukiTacFormat,
			archive: buildTac([{ hash: 0x00aabbccddeeff11n, plain, packed: true }]),
			entries: [
				{
					path: hashName(0x00aabbccddeeff11n),
					size: plain.length,
					content: plain,
				},
			],
		});
	});

	it("completes hashes from the bucket table", async () => {
		const first = Buffer.from("bucket member one");
		const second = Buffer.from("bucket member two");
		const buckets = [{ hash: 0xbeef, count: 2, index: 0 }];
		const file = buildTac(
			[
				{ hash: 0x0000000000000001n, plain: first },
				{ hash: 0x0000000000000002n, plain: second },
			],
			{ buckets },
		);
		const archive = await tanukiTacFormat.open(
			new BufferByteSource(file),
			"data.tac",
		);
		try {
			// The recorded hash keeps its high bits and receives the bucket hash in the low word.
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				hashName((1n << 16n) | 0xbeefn),
				hashName((2n << 16n) | 0xbeefn),
			]);
		} finally {
			await archive.close();
		}
	});

	it("types deciphered entries from their signature", async () => {
		const plain = Buffer.from(`BM${"image payload".repeat(900)}`);
		const file = buildTac([{ hash: 0x1234n, plain }]);
		const archive = await tanukiTacFormat.open(
			new BufferByteSource(file),
			"data.tac",
		);
		try {
			const entry = archive.entries[0];
			expect(entry).toBeDefined();
			expect(entry?.metadata?.type).toBe("image");
			// Images keep everything behind the first block unencrypted.
			expect(entry?.metadata?.encryptedSize).toBe(10240);
			const data = await consumeBuffer(
				await archive.openEntry(entry?.id ?? ""),
			);
			expect(data).toEqual(plain);
		} finally {
			await archive.close();
		}
	});

	it("leaves unknown entries untyped", async () => {
		const plain = Buffer.from(`TEST${"payload".repeat(4)}`);
		const file = buildTac([{ hash: 0x4321n, plain }]);
		const archive = await tanukiTacFormat.open(
			new BufferByteSource(file),
			"data.tac",
		);
		try {
			expect(archive.entries[0]?.metadata?.type).toBeUndefined();
			expect(archive.entries[0]?.metadata?.encryptedSize).toBe(plain.length);
		} finally {
			await archive.close();
		}
	});

	it("registers the tarc signature", () => {
		const signatures = tanukiTacFormat.detection?.signatures ?? [];
		expect(Buffer.from(signatures[0]?.bytes ?? []).toString("latin1")).toBe(
			"TArc",
		);
	});

	it("rejects an unknown version", async () => {
		const file = buildTac([{ hash: 1n, plain: Buffer.from("data") }], {
			version: "1.20",
		});
		expect(await tanukiTacFormat.detect(new BufferByteSource(file))).toBe(
			false,
		);
	});

	it("rejects a missing index", async () => {
		const file = buildTac([{ hash: 1n, plain: Buffer.from("data") }]);
		file.writeUInt32LE(4, 0x1c);
		expect(await tanukiTacFormat.detect(new BufferByteSource(file))).toBe(
			false,
		);
	});

	it("rejects an index past the end of file", async () => {
		const file = buildTac([{ hash: 1n, plain: Buffer.from("data") }]);
		file.writeUInt32LE(0x100000, 0x1c);
		expect(await tanukiTacFormat.detect(new BufferByteSource(file))).toBe(
			false,
		);
	});

	it("rejects a bucket outside the entry table", async () => {
		const file = buildTac([{ hash: 1n, plain: Buffer.from("data") }], {
			buckets: [{ hash: 0x11, count: 4, index: 0 }],
		});
		expect(await tanukiTacFormat.detect(new BufferByteSource(file))).toBe(
			false,
		);
	});
});
