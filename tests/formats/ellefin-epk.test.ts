import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { ellefinEpkFormat } from "../../packages/formats/src/ellefin/epk.js";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const KEY1 = 0xa6bd375e;
const KEY2 = 0x375d916b;
const CONTENT_XOR = 0xd9;
const ROTATE_PATTERN = 0x17236351;
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

/** Mirrors the eight bit rotation key derivation of `EpkOpener`. */
function deriveKeys(baseName: string): { arcKey: number; indexKey: number } {
	const bytes = Buffer.from(baseName, "latin1");
	let arcKey = KEY1;
	let indexKey = KEY2;
	const back = bytes.length - 1;
	for (let i = 0; i < bytes.length; i += 1) {
		arcKey = (arcKey ^ (bytes[back - i] ?? 0)) >>> 0;
		indexKey = (indexKey ^ (bytes[i] ?? 0)) >>> 0;
		arcKey = rotRight(arcKey, 8);
		indexKey = rotLeft(indexKey, 8);
	}
	return { arcKey, indexKey };
}

/** The index cipher is its own inverse. */
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

/** The entry cipher is also its own inverse. */
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
	/** Overrides the stored size field, in blocks when the archive is aligned. */
	sizeBlocks?: number;
}

interface FixtureOptions {
	entries: FixtureEntry[];
	baseName?: string;
	indexEncrypted?: boolean;
	prefix?: Buffer;
	wideOffset?: boolean;
	alignedOffset?: boolean;
	encrypted?: boolean;
	wholeCrypt?: boolean;
	contentCipher?: boolean;
	countDelta?: number;
	rawOffsets?: number[];
	indexSizeDelta?: number;
}

interface BuiltArchive {
	archive: Buffer;
	order: string[];
}

/** Builds an Ellefin EPK archive in either the flat or the encrypted index flavour. */
function buildEpk(options: FixtureOptions): BuiltArchive {
	if (options.entries.length === 0) throw new Error("fixture needs entries");
	const prefix = options.prefix;
	const keys = deriveKeys(options.baseName ?? "TEST");
	const blockSize = options.alignedOffset ? 0x800 : 0;
	const payloadOf = (entry: FixtureEntry): Buffer => {
		const plain = Buffer.from(entry.data);
		if (options.encrypted)
			cryptEntry(plain, Math.min(plain.length, 0x10), keys.arcKey);
		if (options.contentCipher) encryptContent(plain);
		return entry.packed ? literalLzssStream(plain, 1) : plain;
	};
	const payloads = options.entries.map(payloadOf);
	let naturalLength: number;
	/** An aligned archive reads a fixed number of index bytes: one whole block, or one block minus
	 * the eight byte header for the flat variant. */
	const padIndex = (natural: number): number =>
		blockSize
			? options.indexEncrypted
				? blockSize
				: blockSize - HEADER_SIZE
			: natural;
	if (options.indexEncrypted) {
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
		const nameWidth = options.wideOffset ? 4 : 2;
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
		const header = 4 + 1 + (prefix?.length ?? 0) + 1 + 4;
		naturalLength = header + table.length + options.entries.length * 12;
		const index = Buffer.alloc(padIndex(naturalLength));
		index.writeInt32LE(options.entries.length + (options.countDelta ?? 0), 0);
		index[4] = prefix?.length ?? 0;
		prefix?.copy(index, 5);
		let position = 5 + (prefix?.length ?? 0);
		index[position] = options.wideOffset ? 1 : 0;
		position += 1;
		index.writeInt32LE(table.length, position);
		position += 4;
		table.copy(index, position);
		const records = position + table.length;
		const payloadStart = blockSize ? 2 * blockSize : HEADER_SIZE + index.length;
		let cursor = payloadStart;
		const offsets: number[] = [];
		for (const [number, entry] of options.entries.entries()) {
			const stored = payloads[number] ?? Buffer.alloc(0);
			const offset = options.rawOffsets?.[number] ?? cursor;
			offsets.push(offset);
			const record = records + number * 12;
			index.writeUInt32LE(blockSize ? offset / blockSize : offset, record);
			index.writeUInt32LE(entry.sizeBlocks ?? stored.length, record + 4);
			index.writeUInt32LE(entry.packed ? entry.data.length : 0, record + 8);
			cursor = blockSize
				? Math.ceil((cursor + stored.length) / blockSize) * blockSize
				: cursor + stored.length;
		}
		const fileSize = Math.max(cursor, HEADER_SIZE + index.length + 4);
		const file = Buffer.alloc(fileSize);
		for (const [number] of options.entries.entries()) {
			const stored = payloads[number] ?? Buffer.alloc(0);
			const offset = offsets[number] ?? 0;
			if (offset + stored.length <= file.length) stored.copy(file, offset);
		}
		cryptIndex(index, index.length, keys.indexKey);
		index.copy(file, HEADER_SIZE);
		return finishEpk(file, options, index.length, blockSize, keys);
	}
	// Flat index: a length prefixed name followed by the twelve byte record.
	naturalLength =
		4 +
		options.entries.reduce(
			(total, entry) => total + 1 + entry.name.length + 12,
			0,
		);
	const index = Buffer.alloc(padIndex(naturalLength));
	index.writeInt32LE(options.entries.length + (options.countDelta ?? 0), 0);
	let position = 4;
	const payloadStart = blockSize ? 2 * blockSize : HEADER_SIZE + index.length;
	let cursor = payloadStart;
	const offsets: number[] = [];
	for (const [number, entry] of options.entries.entries()) {
		const stored = payloads[number] ?? Buffer.alloc(0);
		const offset = options.rawOffsets?.[number] ?? cursor;
		offsets.push(offset);
		index[position] = entry.name.length;
		position += 1;
		index.write(entry.name, position, "latin1");
		position += entry.name.length;
		index.writeUInt32LE(blockSize ? offset / blockSize : offset, position);
		index.writeUInt32LE(entry.sizeBlocks ?? stored.length, position + 4);
		index.writeUInt32LE(entry.packed ? entry.data.length : 0, position + 8);
		position += 12;
		cursor = blockSize
			? Math.ceil((cursor + stored.length) / blockSize) * blockSize
			: cursor + stored.length;
	}
	const fileSize = Math.max(cursor, HEADER_SIZE + index.length + 4);
	const file = Buffer.alloc(fileSize);
	for (const [number] of options.entries.entries()) {
		const stored = payloads[number] ?? Buffer.alloc(0);
		const offset = offsets[number] ?? 0;
		if (offset + stored.length <= file.length) stored.copy(file, offset);
	}
	index.copy(file, HEADER_SIZE);
	return finishEpk(file, options, index.length, blockSize, keys);
}

/** Writes the header fields once the index body is in place. */
function finishEpk(
	file: Buffer,
	options: FixtureOptions,
	indexLength: number,
	blockSize: number,
	keys: { arcKey: number; indexKey: number },
): BuiltArchive {
	// Ellefin assigns the whole content cipher to bit 2 and the entry cipher to bit 3, unlike the
	// Lucifen archive whose flags are shifted by one.
	const flags =
		0x02 |
		(blockSize ? 0x01 : 0) |
		(options.wholeCrypt ? 0x04 : 0) |
		(options.encrypted ? 0x08 : 0) |
		(options.indexEncrypted ? 0xf0 : 0);
	let sizeField: number;
	if (options.indexEncrypted) {
		// An encrypted index keeps the eight header bytes inside its length.
		sizeField = indexLength;
		if (blockSize)
			sizeField =
				(indexLength + ((options.indexSizeDelta ?? 0) as number)) / blockSize;
	} else {
		sizeField = indexLength + HEADER_SIZE + (options.indexSizeDelta ?? 0);
		if (blockSize) sizeField = sizeField / blockSize;
	}
	file.write("EPK", 0, "latin1");
	file[3] = flags & 0xff;
	const value = options.indexEncrypted
		? (sizeField ^ keys.indexKey) >>> 0
		: sizeField;
	file.writeUInt32LE(value >>> 0, 4);
	return { archive: file, order: [] };
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("ellefin EPK", () => {
	it("declines a file without the EPK signature", async () => {
		expect(
			await ellefinEpkFormat.detect(sourceOf(Buffer.alloc(64)), "TEST.EPK"),
		).toBe(false);
	});

	it("declines an archive without the required flag", async () => {
		const built = buildEpk({
			entries: [{ name: "A", data: Buffer.from("a") }],
		});
		built.archive[3] = 0;
		expect(
			await ellefinEpkFormat.detect(sourceOf(built.archive), "TEST.EPK"),
		).toBe(false);
	});

	it("lists a flat index and extracts entries", async () => {
		const built = buildEpk({
			entries: [
				{ name: "A", data: Buffer.from("first") },
				{ name: "B", data: Buffer.from("second") },
			],
		});
		await expectArchive({
			format: ellefinEpkFormat,
			archive: built.archive,
			sourcePath: "TEST.EPK",
			entries: [
				{ path: "A", size: 5, content: Buffer.from("first") },
				{ path: "B", size: 6, content: Buffer.from("second") },
			],
		});
	});

	it("uses the unpacked size for a packed entry", async () => {
		const built = buildEpk({
			entries: [{ name: "A", data: Buffer.from("lzss payload"), packed: true }],
		});
		const archive = await ellefinEpkFormat.open(
			sourceOf(built.archive),
			"TEST.EPK",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect({
				size: entry.size,
				packedSize: entry.packedSize,
				compressed: entry.compressed,
				sizeKnown: entry.sizeKnown,
			}).toEqual({
				size: 12n,
				packedSize: 14n,
				compressed: true,
				sizeKnown: false,
			});
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("lzss payload"),
			);
		} finally {
			await archive.close();
		}
	});

	it("parses an encrypted letter table index", async () => {
		const built = buildEpk({
			entries: [
				{ name: "SE", data: Buffer.from("second") },
				{ name: "A", data: Buffer.from("first") },
			],
			indexEncrypted: true,
		});
		await expectArchive({
			format: ellefinEpkFormat,
			archive: built.archive,
			sourcePath: "TEST.EPK",
			// The encrypted index records entries in letter table order.
			entries: [
				{ path: "A", size: 5, content: Buffer.from("first") },
				{ path: "SE", size: 6, content: Buffer.from("second") },
			],
			metadata: { indexEncrypted: true },
		});
	});

	it("supports four byte letter table offsets", async () => {
		const built = buildEpk({
			entries: [{ name: "AB", data: Buffer.from("wide") }],
			indexEncrypted: true,
			wideOffset: true,
		});
		await expectArchive({
			format: ellefinEpkFormat,
			archive: built.archive,
			sourcePath: "TEST.EPK",
			entries: [{ path: "AB", size: 4, content: Buffer.from("wide") }],
		});
	});

	it("overwrites the head of an entry with the index prefix", async () => {
		const built = buildEpk({
			entries: [{ name: "A", data: Buffer.from("0123456789") }],
			indexEncrypted: true,
			prefix: Buffer.from("PFX"),
		});
		const archive = await ellefinEpkFormat.open(
			sourceOf(built.archive),
			"TEST.EPK",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// The prefix replaces the first bytes, so the length is unchanged.
			expect(entry.size).toBe(10n);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("PFX3456789"),
			);
		} finally {
			await archive.close();
		}
	});

	it("applies the entry cipher to the first 0x10 bytes", async () => {
		const data = Buffer.alloc(0x20);
		for (let i = 0; i < data.length; i += 1) data[i] = i & 0xff;
		const built = buildEpk({
			entries: [{ name: "A", data }],
			encrypted: true,
		});
		const archive = await ellefinEpkFormat.open(
			sourceOf(built.archive),
			"TEST.EPK",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const extracted = await consumeBuffer(await archive.openEntry(entry.id));
			expect(extracted).toEqual(data);
			// Ellefin only ciphers sixteen bytes, unlike the Lucifen 0x100 byte head.
			expect(extracted.subarray(0x10, 0x14)).toEqual(data.subarray(0x10, 0x14));
		} finally {
			await archive.close();
		}
	});

	it("applies the whole content cipher when the flag is set", async () => {
		const data = Buffer.from("whole content cipher");
		const built = buildEpk({
			entries: [{ name: "A", data }],
			wholeCrypt: true,
			contentCipher: true,
		});
		await expectArchive({
			format: ellefinEpkFormat,
			archive: built.archive,
			sourcePath: "TEST.EPK",
			entries: [{ path: "A", size: data.length, content: data }],
		});
	});

	it("shifts both the offset and the size of aligned entries", async () => {
		// The reference shifts the stored size as well, so an aligned entry occupies a whole block.
		const data = Buffer.alloc(0x800, 0x41);
		const built = buildEpk({
			entries: [{ name: "A", data, sizeBlocks: 1 }],
			alignedOffset: true,
		});
		const archive = await ellefinEpkFormat.open(
			sourceOf(built.archive),
			"TEST.EPK",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(0x800n);
			expect(entry.metadata).toMatchObject({ unpackedSize: 0x800 });
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines when the letter table count does not match the header", async () => {
		const built = buildEpk({
			entries: [{ name: "A", data: Buffer.from("a") }],
			indexEncrypted: true,
			countDelta: 1,
		});
		expect(
			await ellefinEpkFormat.detect(sourceOf(built.archive), "TEST.EPK"),
		).toBe(false);
	});

	it("declines an entry that points past the end of the archive", async () => {
		const built = buildEpk({
			entries: [{ name: "A", data: Buffer.from("a") }],
			rawOffsets: [0x100000],
		});
		expect(
			await ellefinEpkFormat.detect(sourceOf(built.archive), "TEST.EPK"),
		).toBe(false);
	});

	it("declines an index that does not fit in the file", async () => {
		const built = buildEpk({
			entries: [{ name: "A", data: Buffer.from("a") }],
			indexSizeDelta: 0x10000,
		});
		expect(
			await ellefinEpkFormat.detect(sourceOf(built.archive), "TEST.EPK"),
		).toBe(false);
	});

	it("returns empty content for a zero sized entry", async () => {
		const built = buildEpk({
			entries: [{ name: "A", data: Buffer.alloc(0) }],
		});
		const archive = await ellefinEpkFormat.open(
			sourceOf(built.archive),
			"TEST.EPK",
		);
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
