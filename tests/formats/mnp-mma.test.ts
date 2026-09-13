import { BufferByteSource } from "@garbro-mcp/core";
import { mmaFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const INDEX_OFFSET = 0x40;
const RECORD_SIZE = 0x14;
const KEY = Buffer.from([
	0x77, 0x2c, 0x6f, 0x7a, 0x71, 0x4f, 0x25, 0x74, 0x6c, 0x28, 0x7a, 0x81, 0x4c,
	0x31, 0x81, 0x5b, 0x77, 0x81, 0x4d, 0x79, 0x29, 0x69, 0x45, 0x6b, 0x79, 0x7a,
	0x68, 0x2d, 0x69, 0x66, 0x29, 0x39,
]);

function rotateLeft(value: number, count: number): number {
	return ((value << count) | (value >>> (8 - count))) & 0xff;
}

function rotateRight(value: number, count: number): number {
	return ((value >>> count) | (value << (8 - count))) & 0xff;
}

/** Encrypts a payload the way the header branch expects it. */
function encrypt(plain: Buffer): Buffer {
	return Buffer.from(
		plain.map(
			(value, index) =>
				rotateLeft(value, 3) ^ (KEY[index & (KEY.length - 1)] ?? 0),
		),
	);
}

/**
 * Builds an LZ stream. The decoder reads a control byte, then the data of up to eight items before it
 * reads the next control byte, so the fixture has to interleave them the same way. The decoder rotates
 * literals left, so they are stored rotated right.
 */
function lzStream(parts: (number | [offset: number, count: number])[]): Buffer {
	const output: number[] = [0xc0];
	let control = 0;
	let mask = 0x80;
	let body: number[] = [];
	const flush = (): void => {
		output.push(control, ...body);
		control = 0;
		body = [];
		mask = 0x80;
	};
	for (const part of parts) {
		if (typeof part === "number") {
			body.push(rotateRight(part, 5));
		} else {
			control |= mask;
			// The tuple is positional, the labels only document the two fields.
			const [offset, count] = part;
			const word = ((offset - 1) << 5) | (count - 3);
			body.push((word >> 8) & 0xff, word & 0xff);
		}
		mask >>= 1;
		if (mask === 0) flush();
	}
	if (mask !== 0x80) flush();
	return Buffer.from(output);
}

/** Masks a whole LZ stream, marker included. */
function maskStream(data: Buffer): Buffer {
	return Buffer.from(
		data.map((value, index) => value ^ (KEY[index & (KEY.length - 1)] ?? 0)),
	);
}

interface MmaRecord {
	offset: number;
	unpackedSize: number;
	size: number;
	headerSize: number;
	flags: number;
}

/** Builds an archive: the fixed header, the record table and then the payloads. */
function buildMma(
	payloads: Buffer[],
	options: {
		flags?: number[];
		unpackedSizes?: number[];
		headerSizes?: number[];
		version?: number;
		count?: number;
		indexOffset?: number;
	} = {},
): Buffer {
	const count = options.count ?? payloads.length;
	const indexOffset = options.indexOffset ?? INDEX_OFFSET;
	const records: MmaRecord[] = [];
	const offsets: number[] = [];
	let position = indexOffset + RECORD_SIZE * payloads.length;
	for (const [index, payload] of payloads.entries()) {
		offsets.push(position);
		records.push({
			offset: position,
			unpackedSize: options.unpackedSizes?.[index] ?? payload.length,
			size: payload.length,
			headerSize: options.headerSizes?.[index] ?? 0,
			flags: options.flags?.[index] ?? 0,
		});
		position += payload.length;
	}
	const file = Buffer.alloc(position);
	file.write("ARC!", 0, "latin1");
	file.writeUInt32LE(indexOffset, 4);
	file.writeInt32LE(options.version ?? 1, 0xc);
	file.writeInt32LE(count, 0x10);
	records.forEach((record, index) => {
		const at = indexOffset + index * RECORD_SIZE;
		file.writeUInt32LE(record.offset, at);
		file.writeUInt32LE(record.unpackedSize, at + 4);
		file.writeUInt32LE(record.size, at + 8);
		file.writeUInt32LE(record.headerSize, at + 0x0c);
		file.writeUInt32LE(record.flags, at + 0x10);
	});
	for (const [index, payload] of payloads.entries())
		payload.copy(file, offsets[index] ?? 0);
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("mnp mma", () => {
	it("lists stored payloads and extracts them", async () => {
		const payloads = [
			Buffer.from("stored payload"),
			Buffer.from("another one"),
		];
		const file = buildMma(payloads);
		const source = sourceOf(file);
		expect(await mmaFormat.detect(source, "GAME.MMA")).toBe(true);
		const archive = await mmaFormat.open(source, "GAME.MMA");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"GAME#00000",
				"GAME#00001",
			]);
			expect(archive.metadata).toMatchObject({ entryCount: 2 });
			for (const [index, entry] of archive.entries.entries()) {
				expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
					payloads[index],
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("skips the header of an encrypted payload", async () => {
		const plain = Buffer.from("plain body after the header");
		const header = Buffer.alloc(0x10, 0x7f);
		const stored = Buffer.concat([header, encrypt(plain)]);
		const file = buildMma([stored], {
			flags: [4],
			headerSizes: [0x10],
			unpackedSizes: [plain.length],
		});
		const source = sourceOf(file);
		const archive = await mmaFormat.open(source, "GAME.MMA");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.metadata).toMatchObject({ headerSize: 0x10, flags: 4 });
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("unpacks an lz payload with literals and a match", async () => {
		const stream = lzStream([0x41, 0x42, 0x43, 0x44, [4, 4]]);
		const file = buildMma([stream], {
			flags: [6],
			unpackedSizes: [8],
		});
		const source = sourceOf(file);
		const archive = await mmaFormat.open(source, "GAME.MMA");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// The four literals then a four byte match from four bytes back.
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("ABCDABCD"),
			);
			expect(Number(entry.size)).toBe(stream.length);
		} finally {
			await archive.close();
		}
	});

	it("copies a stored lz payload and unmasks a masked one", async () => {
		const stored = Buffer.concat([Buffer.from([0]), Buffer.from("verbatim")]);
		// A match count below three cannot be encoded, so the payload repeats one byte.
		const masked = maskStream(lzStream([0x51, 0x52, [2, 3]]));
		const file = buildMma([stored, masked], {
			flags: [6, 6],
			unpackedSizes: [8, 5],
		});
		const source = sourceOf(file);
		const archive = await mmaFormat.open(source, "GAME.MMA");
		try {
			const first = archive.entries[0];
			const second = archive.entries[1];
			if (!first || !second) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(first.id))).toEqual(
				Buffer.from("verbatim"),
			);
			expect(await consumeBuffer(await archive.openEntry(second.id))).toEqual(
				Buffer.from("QRQRQ"),
			);
		} finally {
			await archive.close();
		}
	});

	it("renames entries from the packed name list", async () => {
		const names = Buffer.from("FIRST.BIN\nSECOND.BIN\nTHIRD.BIN", "latin1");
		const list = lzStream([...names]);
		const payloads = [
			list,
			Buffer.from("first body"),
			Buffer.from("second body"),
			Buffer.from("third body"),
		];
		const file = buildMma(payloads, {
			flags: [0x2f, 0, 0, 0],
			unpackedSizes: [
				names.length,
				payloads[1]?.length ?? 0,
				payloads[2]?.length ?? 0,
				payloads[3]?.length ?? 0,
			],
		});
		const source = sourceOf(file);
		const archive = await mmaFormat.open(source, "GAME.MMA");
		try {
			// The list holds one name per entry, so the entry after them keeps its generated name.
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"FIRST.BIN",
				"SECOND.BIN",
				"THIRD.BIN",
				"GAME#00003",
			]);
		} finally {
			await archive.close();
		}
	});

	it("types image and audio payloads from the flags", async () => {
		const payloads = [
			Buffer.alloc(0x20),
			Buffer.alloc(0x20),
			Buffer.alloc(0x20),
		];
		const file = buildMma(payloads, { flags: [0x10, 0x2d, 0x38] });
		const source = sourceOf(file);
		const archive = await mmaFormat.open(source, "GAME.MMA");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "image" });
			expect(archive.entries[1]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.entries[2]?.metadata).toMatchObject({ type: "image" });
		} finally {
			await archive.close();
		}
	});

	it("declines an archive with an unknown version", async () => {
		const file = buildMma([Buffer.from("payload")], { version: 2 });
		expect(await mmaFormat.detect(sourceOf(file), "GAME.MMA")).toBe(false);
	});

	it("declines a record table behind the end of the file", async () => {
		const file = buildMma([Buffer.from("payload")], { count: 0x10 });
		expect(await mmaFormat.detect(sourceOf(file), "GAME.MMA")).toBe(false);
	});

	it("declines an index offset behind the end of the file", async () => {
		const file = buildMma([Buffer.from("payload")]);
		file.writeUInt32LE(0x10000, 4);
		expect(await mmaFormat.detect(sourceOf(file), "GAME.MMA")).toBe(false);
	});

	it("declines a payload outside the file", async () => {
		const file = buildMma([Buffer.from("payload")]);
		file.writeUInt32LE(0x10000, INDEX_OFFSET + 8);
		expect(await mmaFormat.detect(sourceOf(file), "GAME.MMA")).toBe(false);
	});
});
