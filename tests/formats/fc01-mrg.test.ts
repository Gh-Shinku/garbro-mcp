import { BufferByteSource } from "@garbro-mcp/core";
import { mrgFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const KEY = 0x5a;
const RECORD_SIZE = 0x20;
const HEADER_SIZE = 0x10;

function rotateRight(value: number, count: number): number {
	return ((value >>> count) | (value << (8 - count))) & 0xff;
}

/** The exact inverse of the reference's `Decrypt`, key schedule included. */
function encryptIndex(plain: Buffer, key: number): Buffer {
	const output = Buffer.from(plain);
	let current = key & 0xff;
	let remaining = output.length;
	for (let i = 0; i < output.length; i += 1) {
		output[i] = rotateRight((plain[i] ?? 0) ^ current, 1);
		current = (current + remaining) & 0xff;
		remaining -= 1;
	}
	return output;
}

/** Builds a literal only lzss stream: one control byte per eight literals, least significant bit first. */
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
	key?: number;
	/** Overrides the end offset of the last record, which the key guess does not read. */
	lastEnd?: number;
	firstStart?: number;
	key1Index?: number;
	key2Index?: number;
	indexSize?: number;
}

/**
 * Builds an archive: the fixed header, the encrypted index and the payloads. Records are 0x20 bytes
 * apart, so the end offset of one record is the start offset field of the next one, and the last
 * record's end offset doubles as the little endian file size the key guess reconstructs.
 */
function buildMrg(specs: EntrySpec[], options: BuildOptions = {}): Buffer {
	const count = specs.length;
	const indexSize = options.indexSize ?? (count - 1) * RECORD_SIZE + 0x40;
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
	file.writeUInt16LE(options.key1Index ?? 1, 4);
	file.writeUInt16LE(options.key2Index ?? 1, 6);
	file.writeUInt32LE(HEADER_SIZE + indexSize, 8);
	file.writeInt32LE(count, 12);
	specs.forEach((spec, index) => {
		const at = index * RECORD_SIZE;
		// A deliberately short index only holds part of the records, so every write is bounded.
		if (at + 0x14 <= plain.length) {
			Buffer.from(spec.name, "latin1").copy(plain, at);
			plain.writeUInt32LE(spec.unpackedSize ?? spec.payload.length, at + 0x0e);
			plain[at + 0x12] = spec.method;
		}
		if (at + 0x20 <= plain.length)
			plain.writeUInt32LE(
				index === 0 && options.firstStart !== undefined
					? options.firstStart
					: (starts[index] ?? 0),
				at + 0x1c,
			);
		if (at + 0x40 <= plain.length) {
			const end = index + 1 < count ? (starts[index + 1] ?? 0) : fileSize;
			plain.writeUInt32LE(
				index + 1 === count && options.lastEnd !== undefined
					? options.lastEnd
					: end,
				at + 0x3c,
			);
		}
	});
	encryptIndex(plain, options.key ?? KEY).copy(file, HEADER_SIZE);
	for (const [index, spec] of specs.entries())
		spec.payload.copy(file, starts[index] ?? 0);
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

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

/** The packed method is only used when the stored payload is at least 0x108 bytes. */
function paddedStream(plain: Buffer): Buffer {
	return Buffer.concat([
		literalStream(plain),
		literalStream(Buffer.alloc(0x110)),
	]);
}

const SPECS: EntrySpec[] = [
	{ name: "FIRST.BIN", method: 0, payload: Buffer.from("stored payload") },
	{
		name: "SECOND.DAT",
		method: 1,
		payload: paddedStream(Buffer.from("packed payload")),
		unpackedSize: 14,
	},
	{ name: "THIRD.TXT", method: 0, payload: Buffer.from("third") },
];

describe("fc01 mrg", () => {
	it("declares the MRG signature for the registry", () => {
		expect(mrgFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("MRG\0", "latin1") },
		]);
	});

	it("guesses the key and lists the index", async () => {
		const file = buildMrg(SPECS);
		const source = sourceOf(file);
		expect(await mrgFormat.detect(source, "GAME.MRG")).toBe(true);
		const archive = await mrgFormat.open(source, "GAME.MRG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"FIRST.BIN",
				"SECOND.DAT",
				"THIRD.TXT",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				14,
				SPECS[1]?.payload.length,
				5,
			]);
			expect(archive.metadata).toMatchObject({ entryCount: 3 });
			expect(archive.entries[0]?.metadata).toMatchObject({
				method: 0,
				unpackedSize: 14,
			});
			expect(archive.entries[1]?.metadata).toMatchObject({
				method: 1,
				unpackedSize: 14,
			});
		} finally {
			await archive.close();
		}
	});

	it("extracts a stored payload", async () => {
		const file = buildMrg(SPECS);
		const source = sourceOf(file);
		const archive = await mrgFormat.open(source, "GAME.MRG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("stored payload"),
			);
		} finally {
			await archive.close();
		}
	});

	it("unpacks an lzss payload made of literals", async () => {
		const file = buildMrg(SPECS);
		const source = sourceOf(file);
		const archive = await mrgFormat.open(source, "GAME.MRG");
		try {
			const entry = archive.entries[1];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("packed payload"),
			);
		} finally {
			await archive.close();
		}
	});

	it("unpacks an lzss payload with a back reference", async () => {
		// Three literals then a match of three bytes from the start of the frame. The trailing padding
		// keeps the stored payload above the 0x108 byte threshold that selects the packed method.
		const stream = Buffer.concat([
			Buffer.from([0x07, 0x41, 0x42, 0x43, 0xee, 0x0f]),
			literalStream(Buffer.alloc(0x108)),
		]);
		const file = buildMrg([
			{ name: "MATCH.BIN", method: 1, payload: stream, unpackedSize: 6 },
		]);
		const source = sourceOf(file);
		const archive = await mrgFormat.open(source, "GAME.MRG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("ABCABC"),
			);
		} finally {
			await archive.close();
		}
	});

	it("reads a picture of the walk of the codec of the engine", async () => {
		// Method three stands of the walk of the codec alone, of the count of the places of the walk of
		// the picture of the head of the places of the file of it.
		const file = buildMrg([
			{
				name: "DECODED.BIN",
				method: 3,
				payload: decoderStream(0x41, 12),
				unpackedSize: 6,
			},
		]);
		const archive = await mrgFormat.open(sourceOf(file), "GAME.MRG");
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
		// Method two stands of the walk of the codec of the engine and of the walk of the words behind
		// it: the places of the walk of the codec stand of nought here.
		const file = buildMrg([
			{
				name: "DECODED.LZ",
				method: 2,
				payload: decoderStream(0x00, 0x100),
				unpackedSize: 0x40,
			},
		]);
		const archive = await mrgFormat.open(sourceOf(file), "GAME.MRG");
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

	it("declines an index without the trailing file size", async () => {
		const file = buildMrg(SPECS);
		const cloned = Buffer.from(file);
		// The last record's end offset is the file size the key guess reconstructs, so changing it
		// declines the archive.
		cloned.writeUInt32LE(cloned.length - 1, cloned.readUInt32LE(8) - 4);
		expect(await mrgFormat.detect(sourceOf(cloned), "GAME.MRG")).toBe(false);
	});

	it("declines an entry that points into the index", async () => {
		const file = buildMrg(SPECS, { firstStart: 0x20 });
		expect(await mrgFormat.detect(sourceOf(file), "GAME.MRG")).toBe(false);
	});

	it("declines an entry beyond the end of the file", async () => {
		const file = buildMrg(SPECS, { lastEnd: 0x100000 });
		expect(await mrgFormat.detect(sourceOf(file), "GAME.MRG")).toBe(false);
	});

	it("declines a second key index without a first one", async () => {
		const file = buildMrg(SPECS, { key1Index: 0, key2Index: 1 });
		expect(await mrgFormat.detect(sourceOf(file), "GAME.MRG")).toBe(false);
	});

	it("declines an unsupported key index", async () => {
		const file = buildMrg(SPECS, { key2Index: 2 });
		expect(await mrgFormat.detect(sourceOf(file), "GAME.MRG")).toBe(false);
	});

	it("declines an index that is too small", async () => {
		const file = buildMrg(SPECS, { indexSize: 0x30 });
		expect(await mrgFormat.detect(sourceOf(file), "GAME.MRG")).toBe(false);
	});

	it("declines an empty entry list", async () => {
		const file = buildMrg([], { indexSize: 0x40 });
		expect(await mrgFormat.detect(sourceOf(file), "GAME.MRG")).toBe(false);
	});
});
