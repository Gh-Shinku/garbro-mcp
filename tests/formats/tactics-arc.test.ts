import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { tacticsArcFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	parseTacticsIndex,
	readTacticsLayout,
} from "../../packages/formats/src/tactics/arc-tactics.js";
import { literalLzssStream } from "../helpers/lzss.js";

/** The words of the index of a picture of no password of them, of the places of the file the other way. */
function encodeV0(plain: Buffer): Buffer {
	const encoded: Buffer = Buffer.alloc(plain.length, 0x00);
	for (let at = 0; at < plain.length; at += 1) {
		encoded[at] = (~(plain[at] ?? 0) - 5) & 0xff;
	}
	return encoded;
}

/** The words of the index of a picture of a password of them, of every place of the file the other way. */
function encodeV1(plain: Buffer): Buffer {
	const inverted = Buffer.from(literalLzssStream(plain));
	for (let at = 0; at < inverted.length; at += 1) {
		inverted[at] = ~(inverted[at] ?? 0) & 0xff;
	}
	return inverted;
}

/** The password of a picture stands of the places of the file of it, of the places of the password. */
function xorCycle(data: Buffer, password: Buffer): Buffer {
	const out = Buffer.from(data);
	for (let at = 0; at < out.length; at += 1) {
		out[at] = (out[at] ?? 0) ^ (password[at % password.length] ?? 0);
	}
	return out;
}

function head(input: {
	packedSize: number;
	unpackedSize: number;
	count: number;
	mark?: string;
}): Buffer {
	const bytes: Buffer = Buffer.alloc(0x20, 0x00);
	bytes.write("TACT", 0, "latin1");
	bytes.write(input.mark ?? "ICS_ARC_FILE", 4, "latin1");
	bytes.writeUInt32LE(input.packedSize, 0x10);
	bytes.writeUInt32LE(input.unpackedSize, 0x14);
	bytes.writeInt32LE(input.count, 0x18);
	return bytes;
}

/** A picture of the words of the index of the places of the file: the words of the index of the table. */
function v0File(input: {
	index: Buffer;
	words: Buffer;
	payload: Buffer;
	/** The count of the places of the words of the index of the picture of them. */
	indexLength: number;
}): Buffer {
	return Buffer.concat([
		head({
			packedSize: input.index.length,
			unpackedSize: input.indexLength,
			count: 2,
		}),
		input.index,
		input.words,
		input.payload,
	]);
}

/** A picture of the words of the index of the words of the picture itself. */
function v1File(input: {
	index: Buffer;
	words: Buffer;
	payload: Buffer;
}): Buffer {
	return Buffer.concat([
		head({
			packedSize: input.index.length,
			unpackedSize: input.words.length,
			count: 2,
		}),
		input.index,
		input.payload,
	]);
}

describe("Tactics archive", () => {
	it("reads the head of a picture of the words of the index of it", () => {
		const layout = readTacticsLayout(
			v0File({
				index: Buffer.alloc(4),
				words: Buffer.alloc(0x10),
				payload: Buffer.alloc(0),
				indexLength: 0x10,
			}),
		);
		expect(layout).toEqual({ packedSize: 4, unpackedSize: 0x10, count: 2 });
		expect(
			readTacticsLayout(
				v0File({
					index: Buffer.alloc(4),
					words: Buffer.alloc(0x10),
					payload: Buffer.alloc(0),
					indexLength: 0x10,
				}),
			)?.count,
		).toBe(2);
		// A picture of no mark of the engine and one of the words of the index of the file alone.
		const wrongMark = head({
			packedSize: 4,
			unpackedSize: 0x10,
			count: 2,
			mark: "ICS_ARC_FILF",
		});
		expect(readTacticsLayout(wrongMark)).toBeUndefined();
		expect(
			readTacticsLayout(Buffer.concat([wrongMark, Buffer.alloc(0x20)])),
		).toBeUndefined();
	});

	it("reads the words of the index of the places of the file", async () => {
		const text = Buffer.from("HELLO", "latin1");
		const packed = literalLzssStream(text);
		const raw = Buffer.from([1, 2, 3]);
		const words: Buffer = Buffer.alloc(0x20, 0x00);
		const plain = Buffer.from("pw\0FILE1.BIN\0FILE2.BIN\0", "latin1");
		const index = literalLzssStream(encodeV0(plain));
		const payloadOffset = 0x20 + index.length + 0x20;
		words.writeUInt32LE(payloadOffset, 0);
		words.writeUInt32LE(packed.length, 4);
		words.writeUInt32LE(text.length, 8);
		words.writeUInt32LE(payloadOffset + packed.length, 0x10);
		words.writeUInt32LE(raw.length, 0x14);
		words.writeUInt32LE(0, 0x18);
		const data = v0File({
			index,
			words,
			payload: Buffer.concat([packed, raw]),
			indexLength: plain.length,
		});
		const parsed = parseTacticsIndex(data);
		expect(parsed?.password).toBeUndefined();
		expect(parsed?.records.map((record) => record.name)).toEqual([
			"FILE1.BIN",
			"FILE2.BIN",
		]);
		expect(parsed?.records[0]?.packed).toBe(true);
		expect(parsed?.records[1]?.packed).toBe(false);
		const handle = await tacticsArcFormat.open(
			new BufferByteSource(data),
			"data.arc",
		);
		const first = handle.entries[0];
		const second = handle.entries[1];
		if (!first || !second) throw new Error("no entries");
		expect(
			(await consumeBuffer(await handle.openEntry(first.id))).toString(
				"latin1",
			),
		).toBe("HELLO");
		expect([
			...(await consumeBuffer(await handle.openEntry(second.id))),
		]).toEqual([1, 2, 3]);
	});

	it("reads the words of the index of the words of the picture itself", async () => {
		const password = Buffer.from("KEY", "latin1");
		const text = Buffer.from("WORLD", "latin1");
		const raw = Buffer.from([9, 8, 7, 6]);
		const plain = Buffer.alloc(0x80, 0x00);
		let at = 0;
		plain.write("KEY\0", at, "latin1");
		at += 4;
		const entrySize = 0x18;
		// The places of the picture stand of the words of the index of it: of the first place of the places
		// of the picture of it, and of the places of the picture behind the first of them.
		plain.writeUInt32LE(0, at);
		plain.writeUInt32LE(literalLzssStream(text).length, at + 4);
		plain.writeUInt32LE(text.length, at + 8);
		plain.writeInt32LE(9, at + 0x0c);
		plain.write("FILE1.BIN", at + entrySize, "latin1");
		at += entrySize + 9;
		plain.writeUInt32LE(literalLzssStream(text).length, at);
		plain.writeUInt32LE(raw.length, at + 4);
		plain.writeUInt32LE(0, at + 8);
		plain.writeInt32LE(9, at + 0x0c);
		plain.write("FILE2.BIN", at + entrySize, "latin1");
		at += entrySize + 9;
		const words = plain.subarray(0, at);
		const index = encodeV1(words);
		const payload = Buffer.concat([
			xorCycle(literalLzssStream(text), password),
			xorCycle(raw, password),
		]);
		const data = v1File({ index, words, payload });
		const parsed = parseTacticsIndex(data);
		expect(parsed?.password?.toString("latin1")).toBe("KEY");
		expect(parsed?.records.map((record) => record.name)).toEqual([
			"FILE1.BIN",
			"FILE2.BIN",
		]);
		const handle = await tacticsArcFormat.open(
			new BufferByteSource(data),
			"data.arc",
		);
		const first = handle.entries[0];
		const second = handle.entries[1];
		if (!first || !second) throw new Error("no entries");
		expect(
			(await consumeBuffer(await handle.openEntry(first.id))).toString(
				"latin1",
			),
		).toBe("WORLD");
		expect([
			...(await consumeBuffer(await handle.openEntry(second.id))),
		]).toEqual([9, 8, 7, 6]);
	});

	it("reads the words of the index of the picture of the count of the words of it less", () => {
		// The words of the index of the picture stand of the count of the places of the file of a word of
		// them less, of the words of the picture behind the places of the file of the words of them.
		const plain = Buffer.alloc(0x80, 0x00);
		let at = 0;
		plain.write("KEY\0", at, "latin1");
		at += 4;
		const entrySize = 0x10;
		plain.writeUInt32LE(0, at);
		plain.writeUInt32LE(4, at + 4);
		plain.writeUInt32LE(0, at + 8);
		plain.writeInt32LE(9, at + 0x0c);
		plain.write("FILE1.BIN", at + entrySize, "latin1");
		at += entrySize + 9;
		plain.writeUInt32LE(4, at);
		plain.writeUInt32LE(4, at + 4);
		plain.writeUInt32LE(0, at + 8);
		plain.writeInt32LE(9, at + 0x0c);
		plain.write("FILE2.BIN", at + entrySize, "latin1");
		at += entrySize + 9;
		const words = plain.subarray(0, at);
		const data = v1File({
			index: encodeV1(words),
			words,
			payload: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
		});
		const parsed = parseTacticsIndex(data);
		expect(parsed?.password?.toString("latin1")).toBe("KEY");
		expect(parsed?.records.map((record) => record.name)).toEqual([
			"FILE1.BIN",
			"FILE2.BIN",
		]);
		expect(parsed?.records[1]?.size).toBe(4n);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = v0File({
			index: Buffer.alloc(4),
			words: Buffer.alloc(0x20),
			payload: Buffer.alloc(0),
			indexLength: 0x20,
		});
		expect(await tacticsArcFormat.detect?.(new BufferByteSource(data))).toBe(
			false,
		);
		await expect(
			tacticsArcFormat.open(
				new BufferByteSource(Buffer.from("TACT", "latin1")),
				"data.arc",
			),
		).rejects.toThrow(GarbroError);
		expect(
			await tacticsArcFormat.detect?.(
				new BufferByteSource(
					Buffer.concat([
						Buffer.from("TACT", "latin1"),
						Buffer.from("ICS_ARC_FILE", "latin1"),
						Buffer.alloc(0x10, 0x00),
					]),
				),
			),
		).toBe(false);
	});
});
