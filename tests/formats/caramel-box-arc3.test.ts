import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { caramelBoxArc3Format } from "../../packages/formats/src/caramel-box/arc3.js";

const HEADER_SIZE = 0x20;
const ENTRY_HEADER_SIZE = 0x20;
/** The index starts right behind the archive header when the cluster size is one. */
const INDEX_OFFSET = HEADER_SIZE;

interface Arc3FixtureEntry {
	/** Name bytes exactly as the shared name buffer holds them: the extension first. */
	storedName: string;
	payload: Buffer;
	flags?: number;
	/** Adds the six byte `lz` prefix and marks the size as the unpacked length. */
	packed?: boolean;
	/** Unpacked length stored in the `lz` prefix, required for packed entries. */
	unpackedSize?: number;
}

/** Big endian twenty four bit value, stored in three bytes. */
function be24(value: number): Buffer {
	const bytes = Buffer.alloc(3);
	bytes.writeUIntBE(value, 0, 3);
	return bytes;
}

/**
 * Builds the bit stream of a single LZE chunk that writes every payload byte as a literal. The count
 * of a literal run is stored as the run length plus one.
 */
function lzeLiterals(data: Buffer): Buffer {
	const bits: number[] = [];
	const push = (value: number, count: number): void => {
		for (let bit = count - 1; bit >= 0; bit -= 1) bits.push((value >> bit) & 1);
	};
	const pushInteger = (value: number): void => {
		let length = 0;
		while (1 << (length + 1) <= value) length += 1;
		for (let i = 0; i < length; i += 1) bits.push(0);
		bits.push(1);
		if (length > 0) push(value - (1 << length), length);
	};
	pushInteger(data.length + 1);
	for (const byte of data) push(byte, 8);
	while (bits.length % 8 !== 0) bits.push(0);
	const bytes = Buffer.alloc(bits.length / 8);
	for (const [index, bit] of bits.entries())
		if (bit !== 0)
			bytes[index >> 3] = (bytes[index >> 3] ?? 0) | (1 << (7 - (index & 7)));
	return bytes;
}

interface Arc3Fixture {
	file: Buffer;
	/** Offset of the first entry header. */
	firstHeader: number;
}

/**
 * Builds a Caramel BOX archive whose index uses control bytes to patch a shared name buffer. Entry
 * offsets are big endian 24 bit values in front of the name of the next record.
 */
function buildArc3(entries: Arc3FixtureEntry[], base = 0): Arc3Fixture {
	const indexParts: Buffer[] = [];
	for (const [index, entry] of entries.entries()) {
		const name = Buffer.from(entry.storedName, "latin1");
		if (index === 0) {
			// The high nibble is the offset inside the name buffer, the low nibble the length.
			indexParts.push(Buffer.from([name.length]), name);
		} else {
			// A full nibble pair increments the last character of the buffered name.
			indexParts.push(Buffer.from([0xff]));
		}
		indexParts.push(Buffer.alloc(3));
	}
	const index = Buffer.concat(indexParts);
	const headers: Buffer[] = [];
	let position = base + INDEX_OFFSET + index.length;
	const offsets: number[] = [];
	for (const entry of entries) {
		offsets.push(position);
		let payload = entry.payload;
		if (entry.packed) {
			// The `lz` prefix carries the unpacked size, and the stored size covers the prefix.
			const prefix = Buffer.alloc(6);
			prefix.write("lz", 0, "latin1");
			prefix.writeUInt32BE(entry.unpackedSize ?? entry.payload.length, 2);
			payload = Buffer.concat([prefix, entry.payload]);
		}
		const header = Buffer.alloc(ENTRY_HEADER_SIZE);
		header.writeUInt32BE(payload.length, 8);
		header.writeUInt32BE(entry.flags ?? 0, 0x14);
		headers.push(
			header,
			entry.flags === 2
				? Buffer.from(payload.map((byte) => ~byte & 0xff))
				: payload,
		);
		position += ENTRY_HEADER_SIZE + payload.length;
	}
	// Fill the offsets into the index now that the layout is known.
	let cursor = 0;
	for (const [entryIndex, entry] of entries.entries()) {
		if (entryIndex === 0)
			cursor += 1 + Buffer.from(entry.storedName, "latin1").length;
		else cursor += 1;
		be24(offsets[entryIndex] ?? 0).copy(index, cursor);
		cursor += 3;
	}
	const file = Buffer.concat([
		buildHeader(index.length, base),
		index,
		...headers,
	]);
	return { file, firstHeader: offsets[0] ?? 0 };
}

/** The archive header carries big endian sizes and the index location. */
function buildHeader(indexSize: number, base: number): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("arc3", 0, "latin1");
	header.writeUInt32BE(2, 4);
	header.writeUInt32BE(1, 8);
	header.writeUInt32BE(base, 0xc);
	header.writeUInt32BE(INDEX_OFFSET, 0x18);
	header.writeUInt32BE(indexSize, 0x1c);
	return header;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("caramel box arc3", () => {
	it("declines a file with the wrong signature", async () => {
		const { file } = buildArc3([
			{ storedName: "BINDATA", payload: Buffer.from("body") },
		]);
		file.write("arc4", 0, "latin1");
		expect(await caramelBoxArc3Format.detect(sourceOf(file))).toBe(false);
	});

	it("declines a zero index size", async () => {
		const { file } = buildArc3([
			{ storedName: "BINDATA", payload: Buffer.from("body") },
		]);
		file.writeUInt32BE(0, 0x1c);
		expect(await caramelBoxArc3Format.detect(sourceOf(file))).toBe(false);
	});

	it("declines an index that leaves the file", async () => {
		const { file } = buildArc3([
			{ storedName: "BINDATA", payload: Buffer.from("body") },
		]);
		file.writeUInt32BE(0x1000, 0x18);
		expect(await caramelBoxArc3Format.detect(sourceOf(file))).toBe(false);
	});

	it("declines an entry header behind the file", async () => {
		const { file } = buildArc3([
			{ storedName: "BINDATA", payload: Buffer.from("body") },
		]);
		// The offset field follows the control byte and the stored name of the first record.
		be24(0x1000).copy(file, INDEX_OFFSET + 1 + "BINDATA".length);
		expect(await caramelBoxArc3Format.detect(sourceOf(file))).toBe(false);
	});

	it("lists an entry built from the shared name buffer", async () => {
		const payload = Buffer.from("BM bitmap body");
		const { file } = buildArc3([{ storedName: "BINDATA", payload }]);
		const source = sourceOf(file);
		expect(await caramelBoxArc3Format.detect(source)).toBe(true);
		const archive = await caramelBoxArc3Format.open(source, "GAME.BIN");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["DATA.BIN"]);
			expect(Number(archive.entries[0]?.size)).toBe(payload.length);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "image" });
			expect(archive.metadata).toMatchObject({ entryCount: 1, version: 2 });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				payload,
			);
		} finally {
			await archive.close();
		}
	});

	it("increments the buffered name for the next entry", async () => {
		const first = Buffer.from("first");
		const second = Buffer.from("second body");
		const { file } = buildArc3([
			{ storedName: "BINDATA", payload: first },
			{ storedName: "BINDATB", payload: second },
		]);
		const source = sourceOf(file);
		const archive = await caramelBoxArc3Format.open(source, "GAME.BIN");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"DATA.BIN",
				"DATB.BIN",
			]);
			const entry = archive.entries[1];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				second,
			);
		} finally {
			await archive.close();
		}
	});

	it("unpacks an lz entry from a single ze chunk", async () => {
		const plain = Buffer.from("compressed payload bytes");
		const { file } = buildArc3([
			{
				storedName: "BINDATA",
				payload: Buffer.concat([
					Buffer.from("ze", "latin1"),
					Buffer.from([(plain.length >> 8) & 0xff, plain.length & 0xff]),
					lzeLiterals(plain),
				]),
				packed: true,
				unpackedSize: plain.length,
			},
		]);
		const source = sourceOf(file);
		const archive = await caramelBoxArc3Format.open(source, "GAME.BIN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.compressed).toBe(true);
			expect(entry.sizeKnown).toBe(false);
			expect(Number(entry.size)).toBe(plain.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("inverts an encrypted entry before unpacking", async () => {
		const plain = Buffer.from("encrypted and packed");
		const { file } = buildArc3([
			{
				storedName: "BINDATA",
				payload: Buffer.concat([
					Buffer.from("ze", "latin1"),
					Buffer.from([(plain.length >> 8) & 0xff, plain.length & 0xff]),
					lzeLiterals(plain),
				]),
				packed: true,
				flags: 2,
				unpackedSize: plain.length,
			},
		]);
		const source = sourceOf(file);
		const archive = await caramelBoxArc3Format.open(source, "GAME.BIN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(true);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("rejects a malformed compressed stream", async () => {
		const plain = Buffer.from("payload");
		const { file } = buildArc3([
			{
				storedName: "BINDATA",
				payload: Buffer.concat([
					Buffer.from("xx", "latin1"),
					Buffer.from([0, plain.length]),
					lzeLiterals(plain),
				]),
				packed: true,
			},
		]);
		const source = sourceOf(file);
		const archive = await caramelBoxArc3Format.open(source, "GAME.BIN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(
				(async () => consumeBuffer(await archive.openEntry(entry.id)))(),
			).rejects.toThrow(/Malformed compressed stream/);
		} finally {
			await archive.close();
		}
	});

	it("replaces an asterisk in an entry name", async () => {
		const { file } = buildArc3([
			{ storedName: "BIN*A1", payload: Buffer.from("x") },
		]);
		const archive = await caramelBoxArc3Format.open(sourceOf(file), "GAME.BIN");
		try {
			expect(archive.entries[0]?.path).toBe("\uFF0AA1.BIN");
		} finally {
			await archive.close();
		}
	});
});
