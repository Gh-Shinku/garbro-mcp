import { BufferByteSource } from "@garbro-mcp/core";
import { mrg2Format } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const INDEX_KEY = 0x285ee76f;
const RECORD_SIZE = 0x57;
const HEADER_SIZE = 0x10;
const TABLE_SIZE = 0x100;

/** The reference's name checksum: case folded, dots skipped, first character seeding the value. */
function getNameChecksum(name: string): number {
	if (name.length === 0) return 0;
	const upper = name.toUpperCase();
	let checksum = upper.charCodeAt(0) >>> 0;
	for (let i = 0; i < upper.length; i += 1) {
		const code = upper.charCodeAt(i);
		if (code === 0x2e) continue;
		checksum = (checksum + code + (checksum << 6)) >>> 0;
	}
	return checksum;
}

/** Builds the mask table and applies it, which is its own inverse. */
function applyTable(
	data: Buffer,
	checksum: number,
	key: number,
	start = 0,
	length = data.length,
): void {
	const table = Buffer.alloc(TABLE_SIZE);
	let currentKey = key >>> 0;
	let currentChecksum = checksum >>> 0;
	for (let i = 0; i < TABLE_SIZE; i += 1) {
		const rotated = ((currentChecksum << 16) | (currentChecksum >>> 16)) >>> 0;
		const n = (currentKey + rotated) >>> 0;
		currentKey = currentChecksum;
		currentChecksum = (currentChecksum + n) >>> 0;
		table[i] = currentChecksum & 0xff;
	}
	for (let i = 0; i < length; i += 1) {
		const position = start + i;
		data[position] = (data[position] ?? 0) ^ (table[i & 0xff] ?? 0);
	}
}

/** Literal only lzss stream: one control byte per eight literals, least significant bit first. */
function literalStream(data: Buffer): Buffer {
	const output: number[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const group = data.subarray(start, start + 8);
		let control = 0;
		const body: number[] = [];
		for (const [index, value] of group.entries()) {
			control |= 1 << index;
			body.push(value);
		}
		output.push(control, ...body);
	}
	return Buffer.from(output);
}

interface EntrySpec {
	name: string;
	method: number;
	payload: Buffer;
	unpackedSize?: number;
}

interface BuildOptions {
	sourceName?: string;
	version?: number;
	count?: number;
	indexSize?: number;
	lastEnd?: number;
}

/**
 * Builds an archive: the fixed header, the masked index and the payloads. Records are 0x57 bytes
 * apart, so the end offset field of one record is the start offset field of the next one.
 */
/**
 * A walk of the codec of the engine: the count of the places of the walk of the picture of the head of it,
 * the counts of the cells of the table of them (one cell of the count of the places of the file and the
 * others of nought) and the places of the code of them, which stand of nought.
 */
function decoderStream(symbol: number, size: number): Buffer {
	const head: Buffer = Buffer.alloc(4, 0x00);
	head.writeUInt32LE(size, 0);
	const counts: Buffer = Buffer.alloc(0x100, 0x00);
	counts[symbol] = 0xff;
	return Buffer.concat([
		head,
		counts,
		Buffer.alloc(4, 0x00),
		Buffer.alloc(size + 0x10, 0x00),
	]);
}

function buildMrg2(specs: EntrySpec[], options: BuildOptions = {}): Buffer {
	const count = options.count ?? specs.length;
	const indexSize = options.indexSize ?? (count - 1) * RECORD_SIZE + 0xaa;
	const starts: number[] = [];
	let position = HEADER_SIZE + indexSize;
	for (const spec of specs) {
		starts.push(position);
		position += spec.payload.length;
	}
	const fileSize = position;
	const file = Buffer.alloc(fileSize);
	const plain = Buffer.alloc(indexSize);
	file.write("MRG\0", 0, "latin1");
	file.writeUInt16LE(options.version ?? 2, 6);
	file.writeUInt32LE(HEADER_SIZE + indexSize, 8);
	file.writeInt32LE(count, 12);
	specs.forEach((spec, index) => {
		const at = index * RECORD_SIZE;
		// A deliberately short index only holds part of the records, so every write is bounded.
		if (at + 0x47 <= plain.length) {
			Buffer.from(spec.name, "latin1").copy(plain, at);
			plain.writeUInt32LE(spec.unpackedSize ?? spec.payload.length, at + 0x41);
			plain.writeUInt16LE(spec.method, at + 0x45);
		}
		if (at + 0x53 <= plain.length)
			plain.writeUInt32LE(starts[index] ?? 0, at + 0x4f);
		if (at + 0xaa <= plain.length) {
			const end = index + 1 < count ? (starts[index + 1] ?? 0) : fileSize;
			plain.writeUInt32LE(
				index + 1 === count && options.lastEnd !== undefined
					? options.lastEnd
					: end,
				at + 0xa6,
			);
		}
	});
	applyTable(
		plain,
		getNameChecksum(options.sourceName ?? "GAME.MRG"),
		INDEX_KEY,
	);
	plain.copy(file, HEADER_SIZE);
	for (const [index, spec] of specs.entries())
		spec.payload.copy(file, starts[index] ?? 0);
	return file;
}

/** The stored form of a method zero payload. */
function storedPayload(plain: Buffer, entryName: string): Buffer {
	const data = Buffer.from(plain);
	applyTable(data, getNameChecksum(entryName), getNameChecksum("GAME.MRG"));
	return data;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

const PLAIN = Buffer.from("secret text");
const SPECS: EntrySpec[] = [
	{
		name: "SECRET.BIN",
		method: 0,
		payload: storedPayload(PLAIN, "SECRET.BIN"),
	},
	{
		name: "PACKED.DAT",
		method: 1,
		payload: literalStream(Buffer.from("packed body")),
		unpackedSize: 11,
	},
	{ name: "OPAQUE.IMG", method: 2, payload: Buffer.from("opaque method two") },
];

describe("fc01 mrg2", () => {
	it("declares the MRG signature for the registry", () => {
		expect(mrg2Format.detection?.signatures).toEqual([
			{ bytes: Buffer.from("MRG\0", "latin1") },
		]);
	});

	it("lists the index and reports the method metadata", async () => {
		const file = buildMrg2(SPECS);
		const source = sourceOf(file);
		expect(await mrg2Format.detect(source, "GAME.MRG")).toBe(true);
		const archive = await mrg2Format.open(source, "GAME.MRG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"SECRET.BIN",
				"PACKED.DAT",
				"OPAQUE.IMG",
			]);
			expect(archive.metadata).toMatchObject({ entryCount: 3 });
			expect(archive.entries[0]?.metadata).toMatchObject({
				method: 0,
				unpackedSize: PLAIN.length,
			});
			expect(archive.entries[1]?.metadata).toMatchObject({
				method: 1,
				unpackedSize: 11,
			});
			expect(archive.entries[2]?.metadata).toMatchObject({ method: 2 });
		} finally {
			await archive.close();
		}
	});

	it("decrypts a stored payload with the entry and archive name checksums", async () => {
		const file = buildMrg2(SPECS);
		const source = sourceOf(file);
		const archive = await mrg2Format.open(source, "GAME.MRG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				PLAIN,
			);
		} finally {
			await archive.close();
		}
	});

	it("folds the case of both names when building the mask table", async () => {
		const plain = Buffer.from("lower case names");
		const spec: EntrySpec = {
			name: "lower.bin",
			method: 0,
			payload: (() => {
				const data = Buffer.from(plain);
				applyTable(
					data,
					getNameChecksum("lower.bin"),
					getNameChecksum("game.mrg"),
				);
				return data;
			})(),
		};
		const file = buildMrg2([spec], { sourceName: "game.mrg" });
		const source = sourceOf(file);
		const archive = await mrg2Format.open(source, "game.mrg");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("unpacks an lzss payload", async () => {
		const file = buildMrg2(SPECS);
		const source = sourceOf(file);
		const archive = await mrg2Format.open(source, "GAME.MRG");
		try {
			const entry = archive.entries[1];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("packed body"),
			);
		} finally {
			await archive.close();
		}
	});

	it("reads a picture of the walk of the codec of the engine", async () => {
		// The count of the places of the walk of the picture stands of the two words of the head of it.
		const file = buildMrg2([
			{
				name: "DECODED.BIN",
				method: 2,
				payload: decoderStream(0x41, 12),
				unpackedSize: 6,
			},
		]);
		const archive = await mrg2Format.open(sourceOf(file), "GAME.MRG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.alloc(12, 0x41),
			);
		} finally {
			await archive.close();
		}
	});

	it("reads a picture of the walk of the codec of the engine and of the walk of the words behind it", async () => {
		// The places of the walk of the codec stand of nought of the cells of the table of the counts of
		// them, of the places of the file of the words of the walk of the engine behind it.
		const file = buildMrg2([
			{
				name: "DECODED.LZ",
				method: 3,
				payload: decoderStream(0x00, 0x100),
				unpackedSize: 0x40,
			},
		]);
		const archive = await mrg2Format.open(sourceOf(file), "GAME.MRG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.alloc(0x40, 0x00),
			);
		} finally {
			await archive.close();
		}
	});

	it("declines an archive of the older layout", async () => {
		const file = buildMrg2(SPECS, { version: 1 });
		expect(await mrg2Format.detect(sourceOf(file), "GAME.MRG")).toBe(false);
	});

	it("declines an insane entry count", async () => {
		const file = buildMrg2(SPECS, { count: 0x50000 });
		expect(await mrg2Format.detect(sourceOf(file), "GAME.MRG")).toBe(false);
	});

	it("declines an index that is too small", async () => {
		const file = buildMrg2(SPECS, { indexSize: 0x30 });
		expect(await mrg2Format.detect(sourceOf(file), "GAME.MRG")).toBe(false);
	});

	it("declines an index that reaches past the end of the file", async () => {
		const file = buildMrg2(SPECS);
		file.writeUInt32LE(file.length + 0x100, 8);
		expect(await mrg2Format.detect(sourceOf(file), "GAME.MRG")).toBe(false);
	});

	it("declines a payload outside the file", async () => {
		const file = buildMrg2(SPECS, { lastEnd: 0x100000 });
		expect(await mrg2Format.detect(sourceOf(file), "GAME.MRG")).toBe(false);
	});
});
