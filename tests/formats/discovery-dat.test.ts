import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { discoveryDatFormat } from "../../packages/formats/src/discovery/dat.js";
import { literalLzssStream } from "../helpers/lzss.js";

const WORD_SEED = 13;
const BYTE_SEED = 7;

/** The source bit position of every destination bit of `Descramble32`, derived from the reference. */
function wordPermutation(seed: number): number[] {
	const bits = Array.from({ length: 32 }, (_, index) => index);
	const first = bits[0] ?? 0;
	let walk = 0;
	for (let step = 0; step < 31; step += 1) {
		let shift = walk - seed;
		if (shift < 0) shift += ((31 - shift) >> 5) * 32;
		bits[walk] = bits[shift] ?? 0;
		walk = shift;
	}
	bits[walk] = first;
	return bits;
}

/** The source byte position of every destination byte of `Descramble8`. */
function bytePermutation(length: number, seed: number): number[] {
	const indexes = Array.from({ length }, (_, index) => index);
	const first = indexes[0] ?? 0;
	let x = 0;
	let i = 0;
	for (let count = length - 1; count > 0; count -= 1) {
		i = x - seed;
		while (i < 0) i += length;
		indexes[x] = indexes[i] ?? 0;
		x = i;
	}
	indexes[i] = first;
	return indexes;
}

/** Inverts a permutation given as "destination index holds source index". */
function invert(permutation: number[]): number[] {
	const output: number[] = new Array(permutation.length).fill(0);
	for (const [destination, source] of permutation.entries())
		output[source] = destination;
	return output;
}

/** Encrypts an index the way the reader expects: mask, byte scramble, then word scramble. */
function encryptIndex(plain: Buffer): Buffer {
	const masked = Buffer.from(plain);
	for (let index = 0; index < masked.length; index += 1)
		masked[index] = (masked[index] ?? 0) ^ 0xd6;
	const bytes = invert(bytePermutation(masked.length, BYTE_SEED));
	const gatheredBytes = Buffer.from(masked);
	for (const [destination, source] of bytes.entries())
		masked[destination] = gatheredBytes[source] ?? 0;
	const words = invert(wordPermutation(WORD_SEED));
	const output = Buffer.from(masked);
	for (let position = 0; position + 4 <= output.length; position += 4) {
		const value = output.readUInt32LE(position);
		let gathered = 0;
		for (let bit = 0; bit < 32; bit += 1) {
			const source = words[bit] ?? 0;
			gathered = (gathered | (((value >>> source) & 1) << bit)) >>> 0;
		}
		output.writeUInt32LE(gathered >>> 0, position);
	}
	return output;
}

interface DiscoveryIndexEntry {
	name: string;
	/** Stored size for bdata, header plus body for edata, plain size for vdata. */
	size: number;
	offset: number;
	unpackedSize?: number;
	bodySize?: number;
	bodyUnpacked?: number;
	bodyOffset?: number;
	headerSize?: number;
	headerUnpacked?: number;
}

/**
 * Builds a Discovery archive: every payload is placed at the absolute offset its record declares, and
 * the encrypted index plus the little endian count follow them at the end of the file.
 */
function buildDiscovery(
	kind: "bdata" | "edata" | "vdata",
	entries: DiscoveryIndexEntry[],
	payloads: { offset: number; data: Buffer }[] = [],
): Buffer {
	const headerSize = kind === "bdata" ? 0x3c : kind === "edata" ? 0x2c : 0x20;
	const nameOffset = kind === "bdata" ? 0x18 : kind === "edata" ? 0x1c : 0x10;
	const records = entries.map((entry) => {
		const record = Buffer.alloc(headerSize);
		const name = Buffer.from(entry.name, "latin1");
		record[0] = name.length;
		name.copy(record, nameOffset);
		if (kind === "bdata") {
			record[1] = 8;
			record.writeUInt32LE(entry.size, 4);
			record.writeUInt32LE(entry.unpackedSize ?? entry.size, 8);
			record.writeUInt32LE(entry.offset, 0xc);
		} else if (kind === "edata") {
			record.writeUInt32LE(entry.bodySize ?? 0, 4);
			record.writeUInt32LE(entry.bodyUnpacked ?? 0, 8);
			record.writeUInt32LE(entry.bodyOffset ?? 0, 0xc);
			record.writeUInt32LE(entry.headerSize ?? 0, 0x10);
			record.writeUInt32LE(entry.headerUnpacked ?? 0, 0x14);
			record.writeUInt32LE(entry.offset, 0x18);
		} else {
			record.writeUInt32LE(entry.size, 8);
			record.writeUInt32LE(entry.offset, 0xc);
		}
		return record;
	});
	const index = Buffer.concat(records);
	// VData records are masked only; the other schemes scramble the whole index as well.
	const encrypted: Buffer =
		kind === "vdata" ? Buffer.from(index) : encryptIndex(index);
	if (kind === "vdata") {
		for (let position = 0; position < encrypted.length; position += 1)
			encrypted[position] = (encrypted[position] ?? 0) ^ 0xde;
	}
	const count = Buffer.alloc(4);
	count.writeInt32LE(entries.length, 0);
	let indexStart = 0;
	for (const payload of payloads)
		indexStart = Math.max(indexStart, payload.offset + payload.data.length);
	const file = Buffer.alloc(indexStart + encrypted.length + count.length);
	for (const payload of payloads) payload.data.copy(file, payload.offset);
	encrypted.copy(file, indexStart);
	count.copy(file, indexStart + encrypted.length);
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("discovery dat", () => {
	it("lists and extracts a bdata entry", async () => {
		const entry = { name: "TITLE.BMP", size: 12, offset: 0x40 };
		const file = buildDiscovery(
			"bdata",
			[entry],
			[{ offset: 0x40, data: Buffer.from("hello world!") }],
		);
		const source = sourceOf(file);
		expect(await discoveryDatFormat.detect(source, "BData.dat")).toBe(true);
		const archive = await discoveryDatFormat.open(source, "BData.dat");
		try {
			expect(archive.entries.map((value) => value.path)).toEqual(["TITLE.BMP"]);
			expect(Number(archive.entries[0]?.size)).toBe(12);
			expect(archive.entries[0]?.compressed).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				kind: "bdata",
				type: "image",
			});
			const value = archive.entries[0];
			if (!value) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(value.id))).toEqual(
				Buffer.from("hello world!"),
			);
		} finally {
			await archive.close();
		}
	});

	it("unpacks the header and body of an edata entry", async () => {
		const headerPlain = Buffer.from("HEADER");
		const bodyPlain = Buffer.from("body payload bytes");
		const headerStored = literalLzssStream(headerPlain);
		const bodyStored = literalLzssStream(bodyPlain);
		const payload = Buffer.concat([headerStored, bodyStored]);
		const entry = {
			name: "MUSIC.DAT",
			size: payload.length,
			offset: 0x40,
			headerSize: headerStored.length,
			headerUnpacked: headerPlain.length,
			bodySize: bodyStored.length,
			bodyUnpacked: bodyPlain.length,
			bodyOffset: 0x40 + headerStored.length,
		};
		const file = buildDiscovery(
			"edata",
			[entry],
			[{ offset: 0x40, data: payload }],
		);
		const source = sourceOf(file);
		expect(await discoveryDatFormat.detect(source, "EData.dat")).toBe(true);
		const archive = await discoveryDatFormat.open(source, "EData.dat");
		try {
			const value = archive.entries[0];
			if (!value) throw new Error("missing entry");
			expect(value.compressed).toBe(true);
			expect(value.sizeKnown).toBe(false);
			expect(Number(value.size)).toBe(headerPlain.length + bodyPlain.length);
			expect(await consumeBuffer(await archive.openEntry(value.id))).toEqual(
				Buffer.concat([headerPlain, bodyPlain]),
			);
		} finally {
			await archive.close();
		}
	});

	it("masks and lists a vdata entry", async () => {
		const entry = { name: "VOICE.WAV", size: 4, offset: 0x30 };
		const file = buildDiscovery(
			"vdata",
			[entry],
			[{ offset: 0x30, data: Buffer.from([1, 2, 3, 4]) }],
		);
		const source = sourceOf(file);
		expect(await discoveryDatFormat.detect(source, "VData.dat")).toBe(true);
		const archive = await discoveryDatFormat.open(source, "VData.dat");
		try {
			expect(archive.entries[0]?.path).toBe("VOICE.WAV");
			expect(Number(archive.entries[0]?.size)).toBe(4);
			const value = archive.entries[0];
			if (!value) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(value.id))).toEqual(
				Buffer.from([1, 2, 3, 4]),
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose name does not select a scheme", async () => {
		const file = buildDiscovery("bdata", [
			{ name: "A.BIN", size: 0, offset: 0x3c },
		]);
		expect(await discoveryDatFormat.detect(sourceOf(file), "Other.dat")).toBe(
			false,
		);
	});

	it("declines an insane entry count", async () => {
		const file = buildDiscovery("bdata", [
			{ name: "A.BIN", size: 0, offset: 0x3c },
		]);
		file.writeInt32LE(0x100000, file.length - 4);
		expect(await discoveryDatFormat.detect(sourceOf(file), "BData.dat")).toBe(
			false,
		);
	});

	it("declines a name that runs past the record", async () => {
		const file = buildDiscovery("bdata", [
			{ name: "A.BIN", size: 0, offset: 0x3c },
		]);
		const record = Buffer.from(file.subarray(0, 0x3c));
		record[0] = 0x30;
		encryptIndex(record).copy(file, 0);
		expect(await discoveryDatFormat.detect(sourceOf(file), "BData.dat")).toBe(
			false,
		);
	});

	it("declines an entry that does not fit in the file", async () => {
		const file = buildDiscovery("bdata", [
			{ name: "A.BIN", size: 0x1000, offset: 0x3c },
		]);
		expect(await discoveryDatFormat.detect(sourceOf(file), "BData.dat")).toBe(
			false,
		);
	});
});
