import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import {
	decryptFpk,
	findFpkKey,
	moonhirFpkFormat,
	readFpkIndex,
	unpackFbx,
} from "../../packages/formats/src/moonhir/fpk-archive.js";

const INDEX_AT = 0x20;
const RECORD_SIZE = 0x18;
const DATA_AT = 0x100;

interface Wanted {
	name: string;
	content: Buffer;
	/** Whether the record says the entry is keyed. */
	keyed?: boolean;
}

/** An archive of this engine: the head, the index and the entries behind it. */
function buildFpk(
	wanted: readonly Wanted[],
	options: { mark?: string } = {},
): Buffer {
	const end = Math.max(
		INDEX_AT + wanted.length * RECORD_SIZE,
		...wanted.map(
			(entry, number) =>
				DATA_AT +
				wanted
					.slice(0, number)
					.reduce((total, before) => total + before.content.length, 0) +
				entry.content.length,
		),
	);
	const data = Buffer.alloc(end, 0x00);
	data.write("FPK", 0, "latin1");
	data.write(options.mark ?? "0100", 4, "latin1");
	data.writeUInt32LE(INDEX_AT, 8);
	data.writeInt32LE(wanted.length, 0x0c);
	let place = DATA_AT;
	for (const [number, entry] of wanted.entries()) {
		const at = INDEX_AT + number * RECORD_SIZE;
		data.writeUInt32LE(entry.keyed ? 1 : 0, at);
		data.writeUInt32LE(place, at + 4);
		data.writeUInt32LE(entry.content.length, at + 8);
		data.write(entry.name, at + 0x0c, "latin1");
		entry.content.copy(data, place);
		place += entry.content.length;
	}
	return data;
}

/**
 * Turns the words of a payload into the ones the archive stores, walking them from the last back to the
 * first: the cipher of the reference read backwards, with the key of its own that walks on with every word.
 */
function encryptFpk(plain: Buffer, key: number): Buffer {
	const words = new Uint32Array(plain.length / 4);
	for (let at = 0; at < words.length; at += 1) {
		words[at] = plain.readUInt32LE(at * 4);
	}
	let first = (key + plain.length - 4) >>> 0;
	let second = key >>> 0;
	for (let at = words.length - 1; at >= 0; at -= 1) {
		const word = words[at] ?? 0;
		words[at] = ((word ^ second) + first) >>> 0;
		second = (((second - word) >>> 0) >>> 7) ^ (((first + second) << 7) >>> 0);
		first = (first - 3) >>> 0;
	}
	const stored = Buffer.alloc(plain.length, 0x00);
	for (let at = 0; at < words.length; at += 1) {
		stored.writeUInt32LE(words[at] ?? 0, at * 4);
	}
	return stored;
}

/** A payload of the given bytes, with the length the keyed entries carry behind it. */
function keyedPayload(plain: Buffer): Buffer {
	const size = Math.ceil((plain.length + 8) / 4) * 4;
	const payload = Buffer.alloc(size, 0x00);
	plain.copy(payload, 0);
	payload.writeInt32LE(plain.length, size - 8);
	return payload;
}

/** A picture of this engine: its own word, its head and the walk behind them. */
function buildFbx(stream: readonly number[], unpackedSize: number): Buffer {
	const head = Buffer.alloc(0x10, 0x00);
	head.write("FBX\x01", 0, "latin1");
	head.writeInt32LE(stream.length, 8);
	head.writeInt32LE(unpackedSize, 0x0c);
	head[7] = 0x10;
	return Buffer.concat([head, Buffer.from(stream)]);
}

async function extract(
	data: Buffer,
	position = 0,
	sourcePath = "archive.fpk",
): Promise<Buffer> {
	const handle = await moonhirFpkFormat.open(
		new BufferByteSource(data),
		sourcePath,
	);
	const entry = handle.entries[position];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("MoonhirGames engine resource archive", () => {
	it("lists and hands over the entries of an archive", async () => {
		const wanted = [
			{ name: "first.bin", content: Buffer.from("first entry", "latin1") },
			{ name: "second.bin", content: Buffer.from("second", "latin1") },
		];
		await expectArchive({
			format: moonhirFpkFormat,
			archive: buildFpk(wanted),
			sourcePath: "data.fpk",
			entries: wanted.map((entry) => ({
				path: entry.name,
				size: entry.content.length,
				content: entry.content,
			})),
			metadata: { entryCount: 2, hasKey: false },
		});
	});

	it("draws a picture out of the walk of its own stream", async () => {
		// A byte of its own, a run of three, and a byte of its own: the control byte names four decisions,
		// two bits at a time from its lowest up.
		const stream = [0x04, 0x41, 0x01, 0xb1, 0xb2, 0xb3, 0x42];
		const data = buildFpk([
			{ name: "title.fbx", content: buildFbx(stream, 5) },
		]);
		expect([...(await extract(data))]).toEqual([0x41, 0xb1, 0xb2, 0xb3, 0x42]);
		expect(
			readFpkIndex(data, BigInt(data.length), "title.fpk")?.entries[0],
		).toMatchObject({
			type: "image",
		});
	});

	it("steps over a stretch the picture holds no room for, and refills its bits", () => {
		// A byte of its own, then the fourth way with its own way of three: a stretch of one byte the picture
		// holds no room for is stepped over, and the control bits are read anew behind it.
		// The word the walk steps over carries a value nothing reads, and the refill behind it names a
		// literal of its own.
		const stream = [0x0c, 0x41, 0xc1, 0xee, 0x40, 0x42];
		const data = Buffer.concat([Buffer.alloc(0x10, 0), Buffer.from(stream)]);
		expect([...unpackFbx(data, 0x10, 2)]).toEqual([0x41, 0x42]);
	});

	it("draws a long run of the fourth way", () => {
		// The fourth way with its own way of nothing: a length of two bytes plus the bias of the reference.
		const stream = [0x03, 0x00, 0x00, 0x00];
		const data = Buffer.concat([Buffer.alloc(0x10, 0), Buffer.from(stream)]);
		const unpacked = unpackFbx(data, 0x10, 0x104);
		expect(unpacked.length).toBe(0x104);
		expect([...unpacked.subarray(0, 4)]).toEqual([0, 0, 0, 0]);
	});

	it("finds the key of an archive behind the end of its first keyed entry", async () => {
		const plain = Buffer.from("a script of the archive", "latin1");
		const payload = keyedPayload(plain);
		const data = buildFpk([
			{ name: "main.s", keyed: true, content: encryptFpk(payload, 0) },
		]);
		// The words behind the entry really do name the length the reference reads out of them.
		const index = readFpkIndex(data, BigInt(data.length), "data.fpk");
		expect(index?.key).toBe(0);
		expect(findFpkKey(data, DATA_AT, payload.length)).toBe(0);
		expect([...(await extract(data))]).toEqual([...plain]);
	});

	it("turns away a keyed entry it holds no key for", async () => {
		const plain = Buffer.from("another script", "latin1");
		const payload = keyedPayload(plain);
		const data = buildFpk([
			{ name: "main.s", keyed: true, content: encryptFpk(payload, 0x12345678) },
		]);
		expect(
			readFpkIndex(data, BigInt(data.length), "data.fpk")?.key,
		).toBeUndefined();
		const handle = await moonhirFpkFormat.open(
			new BufferByteSource(data),
			"data.fpk",
		);
		expect(handle.entries[0]).toMatchObject({ encrypted: true });
		await expect(extract(data)).rejects.toThrow(GarbroError);
	});

	it("walks the same words back that it read, so a payload round trips", () => {
		const plain = Buffer.alloc(0x40, 0x00);
		for (let at = 0; at < plain.length; at += 4) plain.writeUInt32LE(at, at);
		const stored = encryptFpk(plain, 7);
		const words = new Uint32Array(stored.length / 4);
		for (let at = 0; at < words.length; at += 1) {
			words[at] = stored.readUInt32LE(at * 4);
		}
		decryptFpk(words, 7);
		const back = Buffer.alloc(stored.length, 0x00);
		for (let at = 0; at < words.length; at += 1) {
			back.writeUInt32LE(words[at] ?? 0, at * 4);
		}
		expect([...back]).toEqual([...plain]);
	});

	it("turns away a mark, a count and an entry it does not name", async () => {
		const data = buildFpk([
			{ name: "first.bin", content: Buffer.from("first", "latin1") },
		]);
		const otherMark = buildFpk(
			[{ name: "first.bin", content: Buffer.from("first", "latin1") }],
			{ mark: "0101" },
		);
		expect(
			readFpkIndex(otherMark, BigInt(otherMark.length), "a.fpk"),
		).toBeUndefined();
		expect(
			await moonhirFpkFormat.detect(new BufferByteSource(otherMark), "a.fpk"),
		).toBe(false);

		const beyond = Buffer.from(data);
		beyond.writeInt32LE(0x400, 0x0c);
		expect(
			readFpkIndex(beyond, BigInt(beyond.length), "a.fpk"),
		).toBeUndefined();

		const outside = Buffer.from(data);
		outside.writeUInt32LE(outside.length - 2, INDEX_AT + 4);
		outside.writeUInt32LE(0x40, INDEX_AT + 8);
		expect(
			readFpkIndex(outside, BigInt(outside.length), "a.fpk"),
		).toBeUndefined();
	});
});
