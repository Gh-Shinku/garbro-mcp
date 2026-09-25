// The archive of the Primel ADV System engine, against archives built in the test: the head of the
// reference, the block of the entries at the end of the file, and an index of its own behind them.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { AesCfb8, rc6EncryptBlock, rc6KeySchedule } from "@garbro-mcp/codecs";
import { BufferByteSource } from "@garbro-mcp/core";
import { primelPcfFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	type PrimelSchemeKind,
	primelGeneratedKey,
} from "../../packages/formats/src/primel/pcf-archive.js";

const HEAD_SIZE = 0x60;
const RECORD_SIZE = 0x80;
/** The flags of an index and of an entry: the cipher over them, and the streams behind it. */
const CIPHER_RC6 = 0x80000;
const CIPHER_AES = 0xa0000;
const STREAM_RLE_MTF = 0x400;
const STREAM_LZSS = 0x700;

interface FixtureEntry {
	name: string;
	/** The places of the entry as they stand. */
	data: Buffer;
	/** The flags of the record of the entry; zero reads the places of it as they stand. */
	flags?: number;
	key?: string;
	/** The count of the places the entry unpacks to, where it stands packed. */
	unpackedSize?: number;
}

/** The record of an entry: the name, the offset within the block, and the counts and flags of the entry. */
function record(entry: FixtureEntry, offset: number): Buffer {
	const out = Buffer.alloc(RECORD_SIZE, 0x00);
	out.write(entry.name, 0, "latin1");
	out.writeBigInt64LE(BigInt(offset), 0x50);
	out.writeUInt32LE(entry.unpackedSize ?? entry.data.length, 0x58);
	out.writeUInt32LE(entry.data.length, 0x60);
	out.writeUInt32LE(entry.flags ?? 0, 0x68);
	Buffer.from(entry.key ?? "00000000", "hex").copy(out, 0x78, 0, 8);
	return out;
}

/**
 * An archive of the engine: the head, the block of the places of the entries, and the index at the end of
 * that block, of the flags the head and the records stand of.
 */
function buildPcf(input: {
	entries: readonly FixtureEntry[];
	indexFlags?: number;
	indexKey?: string;
}): Buffer {
	const body = Buffer.concat(input.entries.map((entry) => entry.data));
	const index = Buffer.concat(
		input.entries.map((entry, at) =>
			record(
				entry,
				input.entries
					.slice(0, at)
					.reduce((sum, one) => sum + one.data.length, 0),
			),
		),
	);
	const indexFlags = input.indexFlags ?? 0;
	const indexKey = Buffer.from(input.indexKey ?? "0000000000000000", "hex");
	const written =
		0 === (indexFlags & 0xf0000)
			? index
			: encodeIndex(index, indexFlags, indexKey);
	const block = Buffer.concat([body, written]);
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("Pack", 0, "latin1");
	head.write("Code", 4, "latin1");
	head.writeInt32LE(input.entries.length, 8);
	head.writeBigInt64LE(BigInt(block.length), 0x10);
	head.writeBigInt64LE(BigInt(body.length), 0x28);
	head.writeUInt32LE(written.length, 0x30);
	head.writeUInt32LE(indexFlags, 0x38);
	indexKey.copy(head, 0x58, 0, 8);
	return Buffer.concat([head, block]);
}

/** The places of the walk of `RC6` backwards: the block of the cipher over the chaining place. */
function rc6Encode(
	key: Buffer,
	data: Buffer,
	layout: { scheme: PrimelSchemeKind },
): Buffer {
	const key1 = primelGeneratedKey(key, layout.scheme);
	const chainingPlace = primelGeneratedKey(key1, layout.scheme);
	const schedule = rc6KeySchedule(key1);
	const chaining = Buffer.from(chainingPlace);
	const whole = data.length - (data.length % 16);
	const out = Buffer.alloc(whole);
	for (let at = 0; at + 16 <= data.length; at += 16) {
		const stream = rc6EncryptBlock(schedule, chaining);
		const block = Buffer.alloc(16);
		for (let place = 0; place < 16; place += 1) {
			block[place] = (data[at + place] ?? 0) ^ (stream[place] ?? 0);
		}
		block.copy(out, at);
		// The chaining place of the reference stands of the places of the run it read.
		block.copy(chaining);
	}
	return Buffer.concat([out, data.subarray(whole)]);
}

/** The places of an index the head of which stands of the cipher of `RC6`. */
function encodeIndex(index: Buffer, flags: number, key: Buffer): Buffer {
	if (CIPHER_RC6 !== (flags & 0xf0000))
		throw new Error("an index of the walk of RC6 alone");
	return rc6Encode(key, index, { scheme: "primel" });
}

/** The places of an entry the record of which stands of AES of a segment of one byte. */
function encodeEntry(entry: FixtureEntry, scheme: PrimelSchemeKind): Buffer {
	const key = Buffer.from(entry.key ?? "00000000", "hex");
	const key1 = primelGeneratedKey(key, scheme);
	const iv = primelGeneratedKey(key1, scheme);
	return new AesCfb8(key1, iv).encrypt(entry.data);
}

/**
 * The stream of `LzssPackedStream`: the count of the places of the picture, the place of the window of the
 * walk, and then a control byte of eight pictures whose lowest place stands for the one in front of it, of a
 * place of a picture as it stands.
 */
function lzssEncode(places: Buffer): Buffer {
	const out: number[] = [];
	const head = Buffer.alloc(6);
	head.writeInt32LE(places.length, 0);
	head.writeUInt16LE(4, 4);
	for (let at = 0; at < places.length; at += 8) {
		const group = places.subarray(at, at + 8);
		let control = 0;
		for (let place = 0; place < group.length; place += 1) control |= 1 << place;
		out.push(control, ...group);
	}
	return Buffer.concat([head, Buffer.from(out)]);
}

/**
 * The stream of `RlePackedStream`: the count of the places of the picture and then the places themselves,
 * of a place that stands where the one in front of it stands read as a run behind that place.
 */
function rleEncode(places: Buffer): Buffer {
	const head = Buffer.alloc(4);
	head.writeInt32LE(places.length, 0);
	const out: number[] = [];
	let at = 0;
	while (at < places.length) {
		let run = 1;
		while (
			at + run < places.length &&
			run < 0x101 &&
			places[at + run] === places[at]
		) {
			run += 1;
		}
		if (run < 3) {
			for (let place = 0; place < run; place += 1)
				out.push(places[at + place] ?? 0);
		} else {
			out.push(places[at] ?? 0, places[at] ?? 0, run - 2);
		}
		at += run;
	}
	return Buffer.concat([head, Buffer.from(out)]);
}

/**
 * The stream of `RlePackedStream` and `MtfPackedStream` behind it, for a picture whose places are all of
 * them different: the walk of the table of the places of a byte turns a picture out of the run of the places
 * of the stream rather than out of the places themselves, of the place of every place within a stable count
 * of them by their own place. A picture of different places therefore stands of a table of the walk, of the
 * place of the walk the picture begins at, and of the places of the stream behind that.
 */
function tableStream(clear: Buffer): Buffer {
	const values = [...new Set(clear)].sort((left, right) => left - right);
	const rank = new Map(values.map((value, at) => [value, at]));
	const order = new Array<number>(values.length).fill(-1);
	for (let at = 0; at + 1 < values.length; at += 1) {
		order[rank.get(clear[at] ?? 0) ?? 0] = rank.get(clear[at + 1] ?? 0) ?? 0;
	}
	const used = new Set(order.filter((place) => place >= 0));
	let spare = 0;
	for (let at = 0; at < order.length; at += 1) {
		if ((order[at] ?? -1) >= 0) continue;
		while (used.has(spare)) spare += 1;
		order[at] = spare;
		used.add(spare);
	}
	const places = new Array<number>(values.length).fill(0);
	for (let at = 0; at < order.length; at += 1)
		places[order[at] ?? 0] = values[at] ?? 0;
	return rleEncode(
		mtfEncode(Buffer.from(places), rank.get(clear[0] ?? 0) ?? 0),
	);
}

/** The stream of `MtfPackedStream`: the place of the walk of the table, then the places of the table. */
function mtfEncode(places: Buffer, start = 0): Buffer {
	const head = Buffer.alloc(4);
	head.writeInt32LE(start, 0);
	const table = Array.from({ length: 256 }, (_value, place) => place);
	const out: number[] = [];
	for (const place of places) {
		const at = table.indexOf(place);
		out.push(at);
		table.splice(at, 1);
		table.unshift(place);
	}
	return Buffer.concat([head, Buffer.from(out)]);
}

describe("Primel PCF archive", () => {
	it("reads an archive of the places of its entries as they stand", async () => {
		const data = buildPcf({
			entries: [
				{ name: "first.txt", data: Buffer.from("hello", "latin1") },
				{ name: "dir/second.bin", data: Buffer.from("xyzzy", "latin1") },
			],
		});
		const source = new BufferByteSource(data);
		expect(await primelPcfFormat.detect(source)).toBe(true);
		const handle = await primelPcfFormat.open(source, "sample.pcf");
		expect(handle.entries.map((entry) => entry.path)).toEqual([
			"first.txt",
			"dir/second.bin",
		]);
		expect(handle.entries.map((entry) => Number(entry.size))).toEqual([5, 5]);
		expect(handle.metadata.scheme).toBe("primel");
		const first = handle.entries[0];
		const second = handle.entries[1];
		if (!first || !second) throw new Error("no entries");
		expect(
			(await consumeBuffer(await handle.openEntry(first.id))).toString(
				"latin1",
			),
		).toBe("hello");
		expect(
			(await consumeBuffer(await handle.openEntry(second.id))).toString(
				"latin1",
			),
		).toBe("xyzzy");
	});

	it("reads the places of an entry the record of which stands of AES", async () => {
		// The record of the entry names the cipher of a segment of one byte, of a key of its own, so the
		// places of it stand of the walk of AES over the key the scheme makes of that key.
		const clear = Buffer.from("the places of an entry of the engine", "latin1");
		const entry: FixtureEntry = {
			name: "hidden.dat",
			data: clear,
			flags: CIPHER_AES,
			key: "0102030405060708",
		};
		const stored = encodeEntry(entry, "primel");
		const data = buildPcf({ entries: [{ ...entry, data: stored }] });
		const source = new BufferByteSource(data);
		const handle = await primelPcfFormat.open(source, "sample.pcf");
		const only = handle.entries[0];
		if (!only) throw new Error("no entry");
		expect(only.encrypted).toBe(true);
		const places = await consumeBuffer(await handle.openEntry(only.id));
		expect(places.toString("latin1")).toBe(clear.toString("latin1"));
	});

	it("reads an index the head of which stands of the cipher of RC6", async () => {
		const entries: FixtureEntry[] = [
			{ name: "one.txt", data: Buffer.from("one", "latin1") },
			{ name: "two.txt", data: Buffer.from("two", "latin1") },
		];
		const data = buildPcf({
			entries,
			indexFlags: CIPHER_RC6,
			indexKey: "a1b2c3d4e5f60718",
		});
		const source = new BufferByteSource(data);
		const handle = await primelPcfFormat.open(source, "sample.pcf");
		expect(handle.entries.map((entry) => entry.path)).toEqual([
			"one.txt",
			"two.txt",
		]);
		const first = handle.entries[0];
		if (!first) throw new Error("no entry");
		expect(
			(await consumeBuffer(await handle.openEntry(first.id))).toString(
				"latin1",
			),
		).toBe("one");
	});

	it("reads the places of an entry the record of which stands of the packed streams", async () => {
		// The flags of a record name the streams the places of the entry stand of behind the cipher: the
		// window walk of a place of a picture as it stands, and the walk of a run of one place behind the
		// table of the places of a byte. The streams here are written in the test, of their own terms.
		const clear = Buffer.from("abracadabra and abracadabra again", "latin1");
		const window = {
			...({} as FixtureEntry),
			name: "window.dat",
			data: lzssEncode(clear),
			flags: STREAM_LZSS,
			unpackedSize: clear.length,
		};
		const distinct = Buffer.from("Primelxyz", "latin1");
		const table = {
			...({} as FixtureEntry),
			name: "table.dat",
			data: tableStream(distinct),
			flags: STREAM_RLE_MTF,
			unpackedSize: distinct.length,
		};
		const data = buildPcf({ entries: [window, table] });
		const source = new BufferByteSource(data);
		const handle = await primelPcfFormat.open(source, "sample.pcf");
		expect(handle.entries.map((entry) => entry.compressed)).toEqual([
			true,
			true,
		]);
		const first = handle.entries[0];
		const second = handle.entries[1];
		if (!first || !second) throw new Error("no entries");
		expect(
			(await consumeBuffer(await handle.openEntry(first.id))).toString(
				"latin1",
			),
		).toBe(clear.toString("latin1"));
		// The walk of the table of the places of a byte turns a picture out of the run of the places of the
		// stream rather than out of those places themselves, and the places of that walk are all of them
		// different here, which is what the stream of the fixture stands of.
		expect(
			(await consumeBuffer(await handle.openEntry(second.id))).toString(
				"latin1",
			),
		).toBe(distinct.toString("latin1"));
	});

	it("turns away a head that does not stand of the engine", async () => {
		const short = Buffer.alloc(HEAD_SIZE - 1, 0x00);
		expect(await primelPcfFormat.detect(new BufferByteSource(short))).toBe(
			false,
		);
		const other = Buffer.concat([
			Buffer.from("PackOther", "latin1"),
			Buffer.alloc(0x60, 0),
		]);
		expect(await primelPcfFormat.detect(new BufferByteSource(other))).toBe(
			false,
		);
		// A count of no entries, and an index that stands past the file, are turned away as well.
		const empty = Buffer.alloc(HEAD_SIZE, 0x00);
		empty.write("PackCode", 0, "latin1");
		empty.writeInt32LE(0, 8);
		expect(await primelPcfFormat.detect(new BufferByteSource(empty))).toBe(
			false,
		);
		const beyond = Buffer.alloc(HEAD_SIZE, 0x00);
		beyond.write("PackCode", 0, "latin1");
		beyond.writeInt32LE(2, 8);
		beyond.writeBigInt64LE(BigInt(0x1000), 0x10);
		beyond.writeBigInt64LE(BigInt(0x1000), 0x28);
		expect(await primelPcfFormat.detect(new BufferByteSource(beyond))).toBe(
			false,
		);
	});
});
