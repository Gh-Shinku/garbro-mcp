import { Buffer } from "node:buffer";
import { FileByteSource, GarbroError } from "@garbro-mcp/core";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { zstdCompressSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	decryptSxData,
	sakanaglSxArchiveFormat,
	sxIndexKey,
} from "../../packages/formats/src/sakanagl/sx-archive.js";

const INDEX_HEAD_SIZE = 0x10;
const DEFAULT_KEY = 0x2e76034b;
const MIX_LO = 0x159a55e5;
const MIX_HI = 0x075bcd15;
const MIX_ONE = 0x0549139a;
const MIX_TWO = 0x8e415c26;
const MIX_THREE = 0x4d9d5bb8;
const HIGH_KEY = 0x2e6;
/** Every place in an entry is counted in units of sixteen bytes. */
const UNIT = 16;

/** The cipher, mirrored from the reference's own arithmetic so the fixtures need no port of their own. */
function mirrorCipher(data: Buffer, keyLo: number, keyHi: number): Buffer {
	const out = Buffer.from(data);
	if (out.length < 4) return out;
	const u = (value: number): number => value >>> 0;
	let low = u(keyLo ^ MIX_LO);
	let high = u(keyHi ^ MIX_HI);
	const first = u(high ^ u(high << 11));
	let v1 = u(first ^ (u(first ^ u(high << 11)) >>> 8) ^ MIX_ONE);
	const second = u(v1 ^ low ^ u(low << 11));
	let v2 = u(second ^ (u(second ^ u(v1 >>> 11)) >>> 8));
	let v3 = u(v2 ^ (v2 >>> 19) ^ MIX_TWO);
	let v4 = u(v3 ^ (v3 >>> 19) ^ MIX_THREE);
	for (let at = 0; at < Math.floor(out.length / 4); at += 1) {
		const t1 = u(v4 ^ v1 ^ u(v1 << 11) ^ (u(u(v1 << 11) ^ u(v4 >>> 11)) >>> 8));
		const t2 = u(v2 ^ u(v2 << 11));
		v2 = v4;
		v4 = u(t1 ^ t2 ^ (u(t2 ^ u(t1 >>> 11)) >>> 8));
		out.writeUInt32LE(
			u(out.readUInt32LE(at * 4) ^ u((t1 >>> 4) ^ u(v4 << 12))),
			at * 4,
		);
		v1 = v3;
		v3 = t1;
	}
	low = 0;
	high = 0;
	return out;
}

/** The key the index of a container leans on: its own head, its own length, and the word the engine fixes. */
function mirrorIndexKey(
	sxLength: number,
	keyWord: number,
): {
	low: number;
	high: number;
} {
	const length = BigInt(sxLength - INDEX_HEAD_SIZE);
	const key = BigInt(keyWord | 0);
	const mixed = BigInt.asUintN(
		64,
		key ^ (961n * (key + length) - 124789n) ^ BigInt(DEFAULT_KEY),
	);
	return {
		low: Number(mixed & 0xffffffffn) >>> 0,
		high: (Number(mixed >> 32n) ^ HIGH_KEY) >>> 0,
	};
}

/** The key of one entry, which stands on its own place and length. */
function mirrorEntryKey(
	offset: number,
	size: number,
): {
	low: number;
	high: number;
} {
	const u = (value: number): number => value >>> 0;
	return {
		low: u(u(Math.floor(offset / UNIT)) ^ u(size << 16) ^ DEFAULT_KEY),
		high: u((size >>> 16) ^ HIGH_KEY),
	};
}

function node(
	nameIndex: number,
	fileIndex: number,
	children: Buffer[],
): Buffer {
	const head = Buffer.alloc(10, 0x00);
	head.writeUInt16BE(children.length, 0);
	head.writeInt32BE(nameIndex, 2);
	head.writeInt32BE(fileIndex, 6);
	return Buffer.concat([head, ...children]);
}

function archiveRecords(sizes: number[]): Buffer {
	const out: Buffer[] = [];
	for (const size of sizes) {
		const record = Buffer.alloc(40, 0x00);
		record.writeUInt32BE(size / UNIT, 12);
		out.push(record);
	}
	return Buffer.concat(out);
}

/** The index of a container, written the way its deserialiser reads it. */
function buildIndex(options: {
	names: string[];
	entries: Array<{ arc: number; flags: number; offset: number; size: number }>;
	archives: number[];
	tree: Buffer;
}): Buffer {
	const head = Buffer.alloc(8, 0x00);
	const nameBytes = options.names.map((name) => {
		const utf8 = Buffer.from(name, "utf8");
		return Buffer.concat([Buffer.from([utf8.length]), utf8]);
	});
	const namesHead = Buffer.alloc(4, 0x00);
	namesHead.writeInt32BE(options.names.length, 0);
	const entriesHead = Buffer.alloc(4, 0x00);
	entriesHead.writeInt32BE(options.entries.length, 0);
	const entries = Buffer.concat(
		options.entries.map((entry) => {
			const out = Buffer.alloc(12, 0x00);
			out.writeUInt16BE(entry.arc, 0);
			out.writeUInt16BE(entry.flags, 2);
			out.writeUInt32BE(entry.offset / UNIT, 4);
			out.writeUInt32BE(entry.size, 8);
			return out;
		}),
	);
	const arcCount = Buffer.alloc(2, 0x00);
	arcCount.writeUInt16BE(options.archives.length, 0);
	const skipped = Buffer.alloc(2, 0x00);
	return Buffer.concat([
		head,
		namesHead,
		...nameBytes,
		entriesHead,
		entries,
		arcCount,
		archiveRecords(options.archives),
		skipped,
		options.tree,
	]);
}

/** A whole container beside its index: the index is keyed and then packed away as its own format does. */
async function writeContainer(options: {
	root: string;
	archiveName: string;
	bodies: Array<{ at: number; bytes: Buffer }>;
	archiveSize: number;
	entries: Array<{
		arc: number;
		flags: number;
		offset: number;
		size: number;
	}>;
	names: string[];
	tree: Buffer;
}): Promise<string> {
	const archive = Buffer.alloc(options.archiveSize, 0x00);
	for (const body of options.bodies) body.bytes.copy(archive, body.at);
	const archivePath = join(options.root, options.archiveName);
	await writeFile(archivePath, archive);
	const plain = buildIndex({
		names: options.names,
		entries: options.entries,
		archives: [options.archiveSize],
		tree: options.tree,
	});
	const packed = Buffer.concat([
		(() => {
			const out = Buffer.alloc(4, 0x00);
			out.writeInt32BE(plain.length, 0);
			return out;
		})(),
		zstdCompressSync(plain),
	]);
	// The key leans on the length of the whole index, so the head is built before the payload is keyed.
	const sxLength = INDEX_HEAD_SIZE + packed.length;
	const keyWord = 0x12345678;
	const key = mirrorIndexKey(sxLength, keyWord);
	const head = Buffer.alloc(INDEX_HEAD_SIZE, 0x00);
	head.write("SSXXDEFL", 0, "latin1");
	head.writeInt32BE(keyWord, 8);
	const index = Buffer.concat([head, mirrorCipher(packed, key.low, key.high)]);
	// The engine looks for the index under the first four characters of the container's own name.
	const base = options.archiveName.replace(/\.\w+$/, "");
	const indexPath = join(options.root, `${base.slice(0, 4)}(00).sx`);
	await writeFile(indexPath, index);
	return archivePath;
}

/** A container of three entries: one plain, one packed, one keyed - all named by a small tree. */
async function writeThree(root: string): Promise<string> {
	const plain = Buffer.alloc(0x10, 0x11);
	const packed = Buffer.from("the packed body of an entry", "utf8");
	const packedRun = Buffer.concat([
		(() => {
			const out = Buffer.alloc(4, 0x00);
			out.writeInt32BE(packed.length, 0);
			return out;
		})(),
		zstdCompressSync(packed),
	]);
	const keyed = Buffer.alloc(0x20, 0x33);
	const entryKey = mirrorEntryKey(0x80, keyed.length);
	const keyedBytes = mirrorCipher(keyed, entryKey.low, entryKey.high);
	return writeContainer({
		root,
		archiveName: "game(01).sx",
		archiveSize: 0x100,
		bodies: [
			{ at: 0x10, bytes: plain },
			{ at: 0x20, bytes: packedRun },
			{ at: 0x80, bytes: keyedBytes },
		],
		entries: [
			{ arc: 0, flags: 0x10, offset: 0x10, size: plain.length },
			{ arc: 0, flags: 0x10 | 0x01, offset: 0x20, size: packedRun.length },
			{ arc: 0, flags: 0x00, offset: 0x80, size: keyed.length },
		],
		names: ["assets", "bg01.dat", "snd.ogg", "data.bin"],
		tree: node(0, -1, [node(1, 0, []), node(2, 1, []), node(3, 2, [])]),
	});
}

describe("SakanaGL engine resource archive", () => {
	it("keys and unkeys a run of words with the same call", () => {
		const plain = Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80]);
		// The bytes the reference's own arithmetic gives for this run and key, worked out aside.
		const expected = [0xb8, 0x10, 0x69, 0x0a, 0xf9, 0x1f, 0xe4, 0xb0];
		const keyed = Buffer.from(plain);
		decryptSxData(keyed, 0x11223344, 0x55667788);
		expect([...keyed]).toEqual(expected);
		expect([...mirrorCipher(plain, 0x11223344, 0x55667788)]).toEqual(expected);
		decryptSxData(keyed, 0x11223344, 0x55667788);
		expect([...keyed]).toEqual([...plain]);
	});

	it("derives the key of an index from its own head and length", () => {
		const index = Buffer.alloc(0x30, 0x00);
		index.write("SSXXDEFL", 0, "latin1");
		index.writeInt32BE(0x12345678, 8);
		expect(sxIndexKey(index)).toEqual({
			low: 0x6a357c10,
			high: 0x2a2,
		});
	});

	it("reads the index of a container beside it", async () => {
		const root = await mkdtemp(join(tmpdir(), "sxstorage-"));
		try {
			const path = await writeThree(root);
			const handle = await sakanaglSxArchiveFormat.open(
				await FileByteSource.open(resolve(path)),
				path,
			);
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"assets/bg01.dat",
				"assets/snd.ogg",
				"assets/data.bin",
			]);
			expect(handle.entries[0]).toMatchObject({ offset: 0x10n, size: 0x10n });
			// The plain entry stands as it is, the packed one unpacks, and the keyed one is unkeyed.
			const first = handle.entries[0];
			const second = handle.entries[1];
			const third = handle.entries[2];
			if (!first || !second || !third) throw new Error("no entry");
			expect(await consumeBuffer(await handle.openEntry(first.id))).toEqual(
				Buffer.alloc(0x10, 0x11),
			);
			const packedBytes = await consumeBuffer(
				await handle.openEntry(second.id),
			);
			expect(packedBytes.toString("utf8")).toBe("the packed body of an entry");
			expect(await consumeBuffer(await handle.openEntry(third.id))).toEqual(
				Buffer.alloc(0x20, 0x33),
			);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("picks the entries of the container whose own length it is", async () => {
		const root = await mkdtemp(join(tmpdir(), "sxstorage-many-"));
		try {
			// Two containers stand in one index, and only the one this very file is has its entries listed.
			const archive = Buffer.alloc(0x100, 0x00);
			archive.write("first", 0x10, "latin1");
			archive.write("second", 0x20, "latin1");
			const archivePath = join(root, "game-01.sx");
			await writeFile(archivePath, archive);
			const plain = buildIndex({
				names: ["a", "b.bin"],
				entries: [
					{ arc: 0, flags: 0x10, offset: 0x10, size: 5 },
					{ arc: 1, flags: 0x10, offset: 0x20, size: 6 },
				],
				archives: [0x80, 0x100],
				// The root of a tree names a directory rather than a file, so its own index is nothing.
				tree: node(0, -1, [node(1, 1, [])]),
			});
			const packed = Buffer.concat([
				(() => {
					const out = Buffer.alloc(4, 0x00);
					out.writeInt32BE(plain.length, 0);
					return out;
				})(),
				zstdCompressSync(plain),
			]);
			const keyWord = 0x12345678;
			const key = mirrorIndexKey(INDEX_HEAD_SIZE + packed.length, keyWord);
			const head = Buffer.alloc(INDEX_HEAD_SIZE, 0x00);
			head.write("SSXXDEFL", 0, "latin1");
			head.writeInt32BE(keyWord, 8);
			await writeFile(
				join(root, "game(00).sx"),
				Buffer.concat([head, mirrorCipher(packed, key.low, key.high)]),
			);
			const handle = await sakanaglSxArchiveFormat.open(
				await FileByteSource.open(resolve(archivePath)),
				archivePath,
			);
			expect(handle.entries.map((entry) => entry.path)).toEqual(["a/b.bin"]);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			expect(
				(await consumeBuffer(await handle.openEntry(entry.id))).toString(
					"latin1",
				),
			).toBe("second");
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("turns away a container whose index is not beside it", async () => {
		const root = await mkdtemp(join(tmpdir(), "sxstorage-none-"));
		try {
			await mkdir(join(root, "sub"), { recursive: true });
			const path = join(root, "sub", "lonely.sx");
			await writeFile(path, Buffer.alloc(0x80, 0x00));
			expect(
				await sakanaglSxArchiveFormat.detect(
					await FileByteSource.open(resolve(path)),
					path,
				),
			).toBe(false);
			await expect(
				sakanaglSxArchiveFormat.open(
					await FileByteSource.open(resolve(path)),
					path,
				),
			).rejects.toThrow(GarbroError);
			// An index that does not open with the engine's own words is turned away as well.
			await writeFile(
				join(root, "sub", "lone(00).sx"),
				Buffer.alloc(0x40, 0x00),
			);
			expect(
				await sakanaglSxArchiveFormat.detect(
					await FileByteSource.open(resolve(path)),
					path,
				),
			).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("is told by the index of the container rather than by a word of its own", async () => {
		expect(sakanaglSxArchiveFormat.descriptor.id).toBe("sakanagl-sx-archive");
		const root = await mkdtemp(join(tmpdir(), "sxstorage-detect-"));
		try {
			const path = await writeThree(root);
			expect(
				await sakanaglSxArchiveFormat.detect(
					await FileByteSource.open(resolve(path)),
					path,
				),
			).toBe(true);
			// The same bytes under another name still read, since the index is what tells them.
			expect(
				await sakanaglSxArchiveFormat.detect(
					await FileByteSource.open(resolve(path)),
					join(root, "other.dat"),
				),
			).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
