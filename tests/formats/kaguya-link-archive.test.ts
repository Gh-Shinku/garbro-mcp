// The walk of the places of the file of a KaGuYa LINK archive, against archives written out of the
// reference's own record layout, its Lin2 walk and its `BmrDecoder`.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { kaguyaLinkFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readLinkLayout } from "../../packages/formats/src/kaguya/link.js";

/** `LinkReader.ReadName`: a byte of length, two letters of nothing and the name of the older layouts. */
function oldNameField(name: string): Buffer {
	const bytes = Buffer.from(name, "latin1");
	const field = Buffer.alloc(1 + 2 + bytes.length, 0);
	field[0] = bytes.length;
	bytes.copy(field, 3);
	return field;
}

/** `Link6Reader.ReadName`: a word of length and the letters of the name. */
function wideNameField(name: string): Buffer {
	const bytes = Buffer.from(name, "utf16le");
	const field = Buffer.alloc(2 + bytes.length, 0);
	field.writeUInt16LE(bytes.length, 0);
	bytes.copy(field, 2);
	return field;
}

interface LinkEntrySpec {
	name: string;
	data: Buffer;
	flags?: number;
}

/** `LinkOpener.TryOpen` and `LinkReader.ReadIndex` of the three newer layouts. */
function buildLink(spec: {
	version: number;
	headTail?: number;
	entries: LinkEntrySpec[];
}): Buffer {
	const dataAt =
		6 === spec.version
			? 8 + (spec.headTail ?? 0)
			: 3 === spec.version
				? 8
				: 0xa;
	const head = Buffer.alloc(Math.max(dataAt, 8), 0);
	head.write("LINK", 0, "latin1");
	head[4] = 0x30 + spec.version;
	if (6 === spec.version) head[7] = spec.headTail ?? 0;
	const parts: Buffer[] = [head.subarray(0, dataAt)];
	for (const entry of spec.entries) {
		const name =
			6 === spec.version ? wideNameField(entry.name) : oldNameField(entry.name);
		const headSize = 4 + 2 + 7 + name.length;
		const record = Buffer.alloc(headSize, 0);
		record.writeUInt32LE(headSize + entry.data.length, 0);
		record.writeUInt16LE(entry.flags ?? 0, 4);
		name.copy(record, 4 + 2 + 7);
		parts.push(record, entry.data);
	}
	// A size of nothing ends the walk.
	parts.push(Buffer.alloc(4, 0));
	return Buffer.concat(parts);
}

/** `LinkOpener.ReadOldIndex`: the names first, then a place and a size for every entry. */
function buildOldLink(entries: { name: string; data: Buffer }[]): Buffer {
	const names = Buffer.concat(
		entries.map((entry) =>
			Buffer.concat([Buffer.from(entry.name, "latin1"), Buffer.from([0])]),
		),
	);
	const head = Buffer.alloc(12, 0);
	head.write("LINK", 0, "latin1");
	head[4] = 0x30;
	head.writeInt32LE(entries.length, 4);
	head.writeUInt32LE(names.length, 8);
	const places: Buffer[] = [];
	// The places of every entry stand together behind the names, and the data of every entry behind them.
	let at = 12 + names.length + 8 * entries.length;
	for (const entry of entries) {
		const place = Buffer.alloc(8, 0);
		place.writeUInt32LE(at, 0);
		place.writeUInt32LE(entry.data.length, 4);
		places.push(place);
		at += entry.data.length;
	}
	return Buffer.concat([
		head,
		names,
		...places,
		...entries.map((entry) => entry.data),
	]);
}

/** The Lin2 walk of literal places alone: a control letter of every letter set, then the places. */
function lin2Literals(values: Buffer): Buffer {
	const out: number[] = [];
	for (let at = 0; at < values.length; at += 8) {
		out.push(0xff);
		for (let i = 0; i < 8; i += 1) out.push(values[at + i] ?? 0);
	}
	return Buffer.from(out);
}

/** The places of an entry whose stored stream is a Lin2 walk of a picture. */
function bmEntry(picture: Buffer): Buffer {
	const stream = lin2Literals(picture);
	const data = Buffer.alloc(4 + stream.length, 0);
	data.writeUInt32LE(picture.length, 0);
	stream.copy(data, 4);
	return data;
}

/** The letters of a place, most significant first. */
function bitsOf(value: number, count: number): number[] {
	const out: number[] = [];
	for (let i = count - 1; i >= 0; i -= 1) out.push((value >> i) & 1);
	return out;
}

/**
 * `BmrDecoder`: the head of the walk, then a tree whose root is one branch over two leaves and the places
 * the walk carries, a letter each.
 */
function bmrEntry(spec: {
	first: number;
	second: number;
	symbols: number[];
	step: number;
	finalSize: number;
	key: number;
}): Buffer {
	const bits: number[] = [
		1,
		0,
		...bitsOf(spec.first, 8),
		0,
		...bitsOf(spec.second, 8),
	];
	for (const symbol of spec.symbols) {
		bits.push(symbol === spec.first ? 0 : 1);
	}
	const stream: number[] = [];
	for (let at = 0; at < bits.length; at += 8) {
		let value = 0;
		for (let i = 0; i < 8; i += 1) value = (value << 1) | (bits[at + i] ?? 0);
		stream.push(value);
	}
	const head = Buffer.alloc(0x14, 0);
	head.write("BMR", 0, "latin1");
	head[BMR_STEP_AT] = spec.step;
	head.writeInt32LE(spec.finalSize, BMR_FINAL_SIZE_AT);
	head.writeInt32LE(spec.key, BMR_KEY_AT);
	head.writeInt32LE(spec.symbols.length, BMR_UNPACKED_AT);
	return Buffer.concat([head, Buffer.from(stream)]);
}

const BMR_STEP_AT = 3;
const BMR_FINAL_SIZE_AT = 4;
const BMR_KEY_AT = 8;
const BMR_UNPACKED_AT = 12;

async function contentOf(archive: Buffer, at: number): Promise<Buffer> {
	const handle = await kaguyaLinkFormat.open(
		new BufferByteSource(archive),
		"sample.arc",
	);
	const entry = handle.entries[at];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("KaGuYa script engine resource archive", () => {
	it("reads the index of the third version", async () => {
		const archive = buildLink({
			version: 3,
			entries: [
				{ name: "one.txt", data: Buffer.from("plain") },
				{ name: "two.bin", data: Buffer.from([1, 2, 3, 4]) },
			],
		});
		const layout = readLinkLayout(archive);
		expect(layout.version).toBe(3);
		expect(layout.entries.map((entry) => entry.name)).toEqual([
			"one.txt",
			"two.bin",
		]);
		expect([...(await contentOf(archive, 0))]).toEqual([
			...Buffer.from("plain"),
		]);
		expect([...(await contentOf(archive, 1))]).toEqual([1, 2, 3, 4]);
	});

	it("reads the index of the fourth and the sixth version", async () => {
		const fourth = buildLink({
			version: 4,
			entries: [{ name: "data/one.txt", data: Buffer.from("plain") }],
		});
		const layout = readLinkLayout(fourth);
		expect(layout.version).toBe(4);
		expect(layout.entries.map((entry) => entry.name)).toEqual(["data/one.txt"]);
		expect([...(await contentOf(fourth, 0))]).toEqual([
			...Buffer.from("plain"),
		]);
		// The sixth layout carries a word of length and the letters of the name, and its head names how
		// many letters of its own stand behind the mark.
		const sixth = buildLink({
			version: 6,
			headTail: 0x10,
			entries: [
				{ name: "テスト.txt", data: Buffer.from("the places of the file") },
			],
		});
		const wide = readLinkLayout(sixth);
		expect(wide.version).toBe(6);
		expect(wide.entries.map((entry) => entry.name)).toEqual(["テスト.txt"]);
		expect([...(await contentOf(sixth, 0))]).toEqual([
			...Buffer.from("the places of the file"),
		]);
	});

	it("reads the index of the older layout", async () => {
		const archive = buildOldLink([
			{ name: "one.txt", data: Buffer.from("plain") },
			{ name: "two.bin", data: Buffer.from([9, 8, 7]) },
		]);
		const layout = readLinkLayout(archive);
		expect(layout.version).toBe(2);
		expect(layout.entries.map((entry) => entry.name)).toEqual([
			"one.txt",
			"two.bin",
		]);
		expect([...(await contentOf(archive, 0))]).toEqual([
			...Buffer.from("plain"),
		]);
		expect([...(await contentOf(archive, 1))]).toEqual([9, 8, 7]);
	});

	it("reads an entry whose stream is a Lin2 walk", async () => {
		// The places of the entry carry the letters of a picture behind their own count, so the reference
		// reads the walk of the Lin2 engine out of them.
		const picture = Buffer.concat([
			Buffer.from("BM", "latin1"),
			Buffer.from([0x36, 0x00, 0x00, 0x00]),
			Buffer.from("the places of the picture", "latin1"),
		]);
		const archive = buildLink({
			version: 3,
			entries: [{ name: "one.bmp", data: bmEntry(picture) }],
		});
		expect([...(await contentOf(archive, 0))]).toEqual([...picture]);
	});

	it("reads a walk of the packed entry of the engine", async () => {
		// The places stand from an independent transcription of the walk of the reference: the move to
		// front undone, then the walk of the places by their own colour from the key of the head.
		const archive = buildLink({
			version: 3,
			entries: [
				{
					name: "one.bin",
					flags: 1,
					data: bmrEntry({
						first: 0x41,
						second: 0x42,
						symbols: [0x41, 0x42, 0x41, 0x42, 0x41, 0x42, 0x41, 0x42],
						step: 0,
						finalSize: 8,
						key: 0,
					}),
				},
			],
		});
		expect([...(await contentOf(archive, 0))]).toEqual([
			59, 65, 59, 65, 59, 65, 59, 65,
		]);
	});

	it("reads the runs of a walk of the engine", async () => {
		const archive = buildLink({
			version: 3,
			entries: [
				{
					name: "two.bin",
					flags: 1,
					data: bmrEntry({
						first: 0x41,
						second: 0x42,
						symbols: [0x41, 0x42, 0x41, 0x42, 0x41, 0x42, 0x41, 0x42],
						step: 2,
						finalSize: 6,
						key: 3,
					}),
				},
			],
		});
		expect([...(await contentOf(archive, 0))]).toEqual([
			62, 64, 64, 62, 62, 64,
		]);
	});

	it("refuses an entry of a game of the engine", async () => {
		const archive = buildLink({
			version: 3,
			entries: [{ name: "one.bin", flags: 4, data: Buffer.from("the places") }],
		});
		await expect(contentOf(archive, 0)).rejects.toMatchObject({
			code: "UNSUPPORTED_FEATURE",
		});
	});

	it("refuses an index the reference cannot walk", async () => {
		// A mark of another engine.
		const other = Buffer.from(
			buildLink({
				version: 3,
				entries: [{ name: "one.txt", data: Buffer.from("plain") }],
			}),
		);
		other.write("LUNC", 0, "latin1");
		expect(await kaguyaLinkFormat.detect(new BufferByteSource(other))).toBe(
			false,
		);
		expect(
			await kaguyaLinkFormat.detect(new BufferByteSource(Buffer.alloc(0x20))),
		).toBe(false);
		// A record of fewer places than the reference asks for.
		const short = Buffer.from(
			buildLink({
				version: 3,
				entries: [{ name: "one.txt", data: Buffer.from("plain") }],
			}),
		);
		short.writeUInt32LE(8, 8);
		expect(await kaguyaLinkFormat.detect(new BufferByteSource(short))).toBe(
			false,
		);
		await expect(
			kaguyaLinkFormat.open(new BufferByteSource(short), "sample.arc"),
		).rejects.toThrow(GarbroError);
		// A record whose places of the file reach past the file itself.
		const beyond = Buffer.from(
			buildLink({
				version: 3,
				entries: [{ name: "one.txt", data: Buffer.from("plain") }],
			}),
		);
		beyond.writeUInt32LE(0x1000, 8);
		expect(await kaguyaLinkFormat.detect(new BufferByteSource(beyond))).toBe(
			false,
		);
	});
});
