import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { lucifenLpkFormat } from "../../packages/formats/src/lucifen/lpk.js";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const KEY1 = 0xa5b9ac6b;
const KEY2 = 0x9a639de5;
const CONTENT_XOR = 0x5d;
const ROTATE_PATTERN = 0x31746285;
const HEADER_SIZE = 8;

function rotRight(value: number, count: number): number {
	const shift = count & 31;
	if (shift === 0) return value >>> 0;
	return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

function rotLeft(value: number, count: number): number {
	const shift = count & 31;
	if (shift === 0) return value >>> 0;
	return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** Mirrors the reference key derivation from the upper case base name. */
function deriveKeys(baseName: string): { key1: number; key2: number } {
	const bytes = Buffer.from(baseName, "latin1");
	let key1 = KEY1;
	let key2 = KEY2;
	for (let head = 0, tail = bytes.length - 1; tail >= 0; head += 1, tail -= 1) {
		key1 = (key1 ^ (bytes[tail] ?? 0)) >>> 0;
		key2 = (key2 ^ (bytes[head] ?? 0)) >>> 0;
		key1 = rotRight(key1, 7);
		key2 = rotLeft(key2, 7);
	}
	return { key1, key2 };
}

/** The index and entry ciphers are involutions, so one pass serves both directions. */
function cryptIndex(data: Buffer, length: number, key: number): void {
	let pattern = ROTATE_PATTERN;
	let current = key >>> 0;
	const words = Math.trunc(length / 4);
	for (let i = 0; i < words; i += 1) {
		const position = i * 4;
		data.writeUInt32LE((data.readUInt32LE(position) ^ current) >>> 0, position);
		pattern = rotLeft(pattern, 4);
		current = rotRight(current, pattern);
	}
}

function cryptEntry(data: Buffer, length: number, key: number): void {
	let pattern = ROTATE_PATTERN;
	let current = key >>> 0;
	const words = Math.trunc(length / 4);
	for (let i = 0; i < words; i += 1) {
		const position = i * 4;
		data.writeUInt32LE((data.readUInt32LE(position) ^ current) >>> 0, position);
		pattern = rotRight(pattern, 4);
		current = rotLeft(current, pattern);
	}
}

/** Inverse of the content cipher, which the reader applies as `rot(v ^ xor, 4)`. */
function encryptContent(data: Buffer): void {
	for (let i = 0; i < data.length; i += 1) {
		const value = data[i] ?? 0;
		const rotated = ((value >>> 4) | (value << 4)) & 0xff;
		data[i] = (rotated ^ CONTENT_XOR) & 0xff;
	}
}

interface Node {
	children: Map<number, Node>;
	terminal?: number;
}

interface FixtureEntry {
	name: string;
	data: Buffer;
	packed?: boolean;
}

interface FixtureOptions {
	entries: FixtureEntry[];
	baseName?: string;
	prefix?: Buffer;
	encrypted?: boolean;
	wholeCrypt?: boolean;
	contentCipher?: boolean;
	alignedOffset?: boolean;
	nameWidth?: 2 | 4;
	countDelta?: number;
	rawOffsets?: number[];
	letterTableLengthOverride?: number;
}

interface BuiltArchive {
	archive: Buffer;
	/** Entry names in the order the reference records them, which is letter table order. */
	order: string[];
}

/** Builds a Lucifen LPK archive whose letter table is generated from the entry names. */
function buildLpk(options: FixtureOptions): BuiltArchive {
	if (options.entries.length === 0) throw new Error("fixture needs entries");
	const nameWidth = options.nameWidth ?? 2;
	const packedEntries = options.entries.some((entry) => entry.packed);
	const prefix = options.prefix;
	const root: Node = { children: new Map() };
	for (const [number, entry] of options.entries.entries()) {
		let node = root;
		for (const character of entry.name) {
			const letter = character.codePointAt(0) ?? 0;
			let child = node.children.get(letter);
			if (!child) {
				child = { children: new Map() };
				node.children.set(letter, child);
			}
			node = child;
		}
		node.terminal = number;
	}
	const order: string[] = [];
	const walk = (node: Node): void => {
		if (node.terminal !== undefined)
			order.push(options.entries[node.terminal]?.name ?? "");
		for (const letter of [...node.children.keys()].sort((a, b) => a - b)) {
			const child = node.children.get(letter);
			if (child) walk(child);
		}
	};
	walk(root);
	const subtreeSize = (node: Node): number => {
		let size = 1 + node.children.size * (1 + nameWidth);
		if (node.terminal !== undefined) size += 1 + nameWidth;
		for (const child of node.children.values()) size += subtreeSize(child);
		return size;
	};
	const table = Buffer.alloc(subtreeSize(root));
	const writeOffset = (at: number, value: number): void => {
		if (nameWidth === 4) table.writeInt32LE(value, at);
		else table.writeUInt16LE(value, at);
	};
	// Child offsets are relative to the byte that follows their own offset field, so the absolute
	// positions have to be known before any node is written.
	const positions = new Map<Node, number>();
	const place = (node: Node, at: number): void => {
		positions.set(node, at);
		const childCount =
			node.children.size + (node.terminal === undefined ? 0 : 1);
		let childPosition = at + 1 + childCount * (1 + nameWidth);
		for (const letter of [...node.children.keys()].sort((a, b) => a - b)) {
			const child = node.children.get(letter);
			if (!child) continue;
			place(child, childPosition);
			childPosition += subtreeSize(child);
		}
	};
	place(root, 0);
	const writeNode = (node: Node): void => {
		const at = positions.get(node) ?? 0;
		const childCount =
			node.children.size + (node.terminal === undefined ? 0 : 1);
		table[at] = childCount;
		let cursor = at + 1;
		if (node.terminal !== undefined) {
			// A terminal records the entry number rather than an offset.
			table[cursor] = 0;
			writeOffset(cursor + 1, node.terminal);
			cursor += 1 + nameWidth;
		}
		for (const letter of [...node.children.keys()].sort((a, b) => a - b)) {
			const child = node.children.get(letter);
			if (!child) continue;
			table[cursor] = letter;
			writeOffset(
				cursor + 1,
				(positions.get(child) ?? 0) - (cursor + 1 + nameWidth),
			);
			cursor += 1 + nameWidth;
			writeNode(child);
		}
	};
	writeNode(root);
	const entrySize = packedEntries ? 13 : 9;
	const entriesOffset = 4 + 1 + (prefix?.length ?? 0) + 1 + 4 + table.length;
	const declaredCount = options.entries.length + (options.countDelta ?? 0);
	const blockSize = options.alignedOffset ? 0x800 : 0;
	const rawIndexSize = entriesOffset + declaredCount * entrySize;
	const indexSize = blockSize
		? Math.max(blockSize, rawIndexSize)
		: rawIndexSize;
	const index = Buffer.alloc(indexSize);
	index.writeInt32LE(declaredCount, 0);
	index[4] = prefix?.length ?? 0;
	prefix?.copy(index, 5);
	let position = 5 + (prefix?.length ?? 0);
	index[position] = nameWidth === 4 ? 1 : 0;
	position += 1;
	index.writeInt32LE(
		options.letterTableLengthOverride ?? table.length,
		position,
	);
	position += 4;
	table.copy(index, position);
	// Aligned archives address payloads in 0x800 byte blocks, so the first usable block after the
	// eight byte header and the index block is block two.
	const payloadStart = blockSize ? 2 * blockSize : HEADER_SIZE + indexSize;
	const keys = deriveKeys(options.baseName ?? "TEST");
	const payloads: Buffer[] = [];
	const offsets: number[] = [];
	let payloadCursor = payloadStart;
	for (const [number, entry] of options.entries.entries()) {
		// The ciphers run on the extracted bytes, so they are applied before compression.
		const plain = Buffer.from(entry.data);
		if (options.encrypted)
			cryptEntry(plain, Math.min(plain.length, 0x100), keys.key1);
		if (options.contentCipher) encryptContent(plain);
		const body = entry.packed ? literalLzssStream(plain, 1) : plain;
		payloads.push(body);
		offsets.push(options.rawOffsets?.[number] ?? payloadCursor);
		payloadCursor = blockSize
			? Math.ceil((payloadCursor + body.length) / blockSize) * blockSize
			: payloadCursor + body.length;
	}
	const fileSize = Math.max(payloadCursor, HEADER_SIZE + indexSize + 4);
	const file = Buffer.alloc(fileSize);
	for (const [number, entry] of options.entries.entries()) {
		const stored = payloads[number] ?? Buffer.alloc(0);
		const offset = offsets[number] ?? 0;
		// The entry table lives inside the index, which is encrypted and copied afterwards.
		const target = entriesOffset + number * entrySize;
		index[target] = 0;
		index.writeUInt32LE((offset / (blockSize || 1)) >>> 0, target + 1);
		index.writeUInt32LE(stored.length, target + 5);
		if (packedEntries)
			index.writeUInt32LE(entry.packed ? entry.data.length : 0, target + 9);
		if (offset + stored.length <= file.length) stored.copy(file, offset);
	}
	cryptIndex(index, indexSize, keys.key2);
	index.copy(
		file,
		HEADER_SIZE,
		0,
		Math.min(indexSize, file.length - HEADER_SIZE),
	);
	const flags =
		(options.alignedOffset ? 0x01 : 0) |
		0x02 |
		(options.encrypted ? 0x04 : 0) |
		(packedEntries ? 0x08 : 0) |
		(options.wholeCrypt ? 0x10 : 0);
	const indexField = blockSize ? indexSize / blockSize : indexSize;
	file.write("LPK1", 0, "latin1");
	file.writeUInt32LE(((indexField | (flags << 24)) ^ keys.key2) >>> 0, 4);
	return { archive: file, order };
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("lucifen LPK", () => {
	it("registers the LPK1 signature", () => {
		expect(lucifenLpkFormat.detection?.signatures?.[0]?.bytes).toEqual(
			Buffer.from("LPK1", "latin1"),
		);
	});

	it("declines a file without the signature", async () => {
		expect(
			await lucifenLpkFormat.detect(sourceOf(Buffer.alloc(64)), "TEST.LPK"),
		).toBe(false);
	});

	it("lists unpacked entries in letter table order", async () => {
		const built = buildLpk({
			entries: [
				{ name: "SE", data: Buffer.from("second") },
				{ name: "A", data: Buffer.from("first") },
			],
		});
		expect(built.order).toEqual(["A", "SE"]);
		await expectArchive({
			format: lucifenLpkFormat,
			archive: built.archive,
			sourcePath: "TEST.LPK",
			entries: [
				{ path: "A", size: 5, content: Buffer.from("first") },
				{ path: "SE", size: 6, content: Buffer.from("second") },
			],
		});
	});

	it("declines an archive without the required index flag", async () => {
		const built = buildLpk({
			entries: [{ name: "A", data: Buffer.from("a") }],
		});
		built.archive.writeUInt32LE(
			(built.archive.readUInt32LE(4) & 0xff00ffff) >>> 0,
			4,
		);
		expect(
			await lucifenLpkFormat.detect(sourceOf(built.archive), "TEST.LPK"),
		).toBe(false);
	});

	it("uses a four byte name width when the flag byte is set", async () => {
		const built = buildLpk({
			entries: [{ name: "AB", data: Buffer.from("wide") }],
			nameWidth: 4,
		});
		await expectArchive({
			format: lucifenLpkFormat,
			archive: built.archive,
			sourcePath: "TEST.LPK",
			entries: [{ path: "AB", size: 4, content: Buffer.from("wide") }],
		});
	});

	it("unpacks lzss entries", async () => {
		const built = buildLpk({
			entries: [
				{ name: "A", data: Buffer.from("lzss payload"), packed: true },
				{ name: "B", data: Buffer.from("stored") },
			],
		});
		const source = sourceOf(built.archive);
		const archive = await lucifenLpkFormat.open(source, "TEST.LPK");
		try {
			expect(
				archive.entries.map((entry) => ({
					path: entry.path,
					size: entry.size,
					compressed: entry.compressed,
					// An unset flag means the size is known.
					sizeKnown: entry.sizeKnown !== false,
				})),
			).toEqual([
				{
					path: "A",
					size: 12n,
					compressed: true,
					sizeKnown: false,
				},
				{
					path: "B",
					size: 6n,
					compressed: false,
					sizeKnown: true,
				},
			]);
			const first = archive.entries[0];
			if (!first) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(first.id))).toEqual(
				Buffer.from("lzss payload"),
			);
		} finally {
			await archive.close();
		}
	});

	it("prepends the index prefix to every entry", async () => {
		const prefix = Buffer.from("PFX");
		const built = buildLpk({
			entries: [{ name: "A", data: Buffer.from("body") }],
			prefix,
		});
		await expectArchive({
			format: lucifenLpkFormat,
			archive: built.archive,
			sourcePath: "TEST.LPK",
			entries: [{ path: "A", size: 7, content: Buffer.from("PFXbody") }],
		});
	});

	it("applies the entry cipher to the first 0x100 bytes", async () => {
		const data = Buffer.alloc(0x120);
		for (let i = 0; i < data.length; i += 1) data[i] = i & 0xff;
		const built = buildLpk({
			entries: [{ name: "A", data }],
			encrypted: true,
		});
		const source = sourceOf(built.archive);
		const archive = await lucifenLpkFormat.open(source, "TEST.LPK");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const extracted = await consumeBuffer(await archive.openEntry(entry.id));
			expect(extracted).toEqual(data);
			// The bytes beyond the ciphered head are stored verbatim.
			expect(extracted.subarray(0x100, 0x104)).toEqual(
				data.subarray(0x100, 0x104),
			);
		} finally {
			await archive.close();
		}
	});

	it("applies the whole content cipher when the flag is set", async () => {
		const data = Buffer.from("whole content cipher");
		const built = buildLpk({
			entries: [{ name: "A", data }],
			wholeCrypt: true,
			contentCipher: true,
		});
		await expectArchive({
			format: lucifenLpkFormat,
			archive: built.archive,
			sourcePath: "TEST.LPK",
			entries: [{ path: "A", size: data.length, content: data }],
		});
	});

	it("skips the content cipher for patch archives", async () => {
		const data = Buffer.from("patch body");
		// The flag is set but the content is stored in the clear, which is what the reference
		// expects from a PATCH archive because it clears the flag before extracting.
		const built = buildLpk({
			entries: [{ name: "A", data }],
			wholeCrypt: true,
			baseName: "PATCH",
		});
		await expectArchive({
			format: lucifenLpkFormat,
			archive: built.archive,
			sourcePath: "PATCH.LPK",
			entries: [{ path: "A", size: data.length, content: data }],
		});
	});

	it("supports 0x800 aligned entry offsets", async () => {
		const data = Buffer.from("aligned body");
		const built = buildLpk({
			entries: [{ name: "A", data }],
			alignedOffset: true,
		});
		await expectArchive({
			format: lucifenLpkFormat,
			archive: built.archive,
			sourcePath: "TEST.LPK",
			entries: [{ path: "A", size: data.length, content: data }],
			metadata: { alignedOffset: true },
		});
	});

	it("declines when the declared count does not match the letter table", async () => {
		const built = buildLpk({
			entries: [{ name: "A", data: Buffer.from("a") }],
			countDelta: 1,
		});
		expect(
			await lucifenLpkFormat.detect(sourceOf(built.archive), "TEST.LPK"),
		).toBe(false);
	});

	it("declines a letter table that points past the end of the index", async () => {
		const built = buildLpk({
			entries: [{ name: "A", data: Buffer.from("a") }],
			letterTableLengthOverride: 0x10000,
		});
		expect(
			await lucifenLpkFormat.detect(sourceOf(built.archive), "TEST.LPK"),
		).toBe(false);
	});

	it("declines an entry that points past the end of the archive", async () => {
		const built = buildLpk({
			entries: [{ name: "A", data: Buffer.from("a") }],
			rawOffsets: [0x100000],
		});
		expect(
			await lucifenLpkFormat.detect(sourceOf(built.archive), "TEST.LPK"),
		).toBe(false);
	});

	it("returns empty content for a zero sized entry", async () => {
		const built = buildLpk({
			entries: [{ name: "A", data: Buffer.alloc(0) }],
			prefix: Buffer.from("PFX"),
		});
		const source = sourceOf(built.archive);
		const archive = await lucifenLpkFormat.open(source, "TEST.LPK");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(0n);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.alloc(0),
			);
		} finally {
			await archive.close();
		}
	});
});
