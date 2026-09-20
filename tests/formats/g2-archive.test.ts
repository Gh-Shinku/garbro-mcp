import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	g2ArchiveFormat,
	readG2Layout,
	unpackG2Entry,
} from "../../packages/formats/src/g2/g2-archive.js";
import {
	createG2Scheme,
	decryptG2,
	rotByteRight,
	type G2Scheme,
} from "../../packages/formats/src/g2/scheme.js";

const HEAD_SIZE = 0x5c;
const HEAD_KEY = 0x8465b49b;
const SIGNATURE = Buffer.from([0x10, 0x33, 0xd3, 0x47]);

/** The places of the picture of the walk of the places of the picture of the words of the walk of the places of
 * the picture of the walk of them of the places of the picture of the walk of the places of the picture of the
 * kind of the places of the picture of the walk of the places of the picture of the kind of the places of the
 * picture of the walk of them of the places of the picture of the walk of the places of the picture. */
function invertAction(action: number, at: number, value: number): number {
	if (action === 0) return rotByteRight(value, (8 - (at & 7)) & 7);
	if (action === 1) return value ^ at;
	if (action === 2) return ~value & 0xff;
	if (action === 3) return ((~value & 0xff) + 100) & 0xff;
	if (action === 4) return (value - at) & 0xff;
	return rotByteRight(value, 4);
}

/** The places of the picture of the walk of the places of the picture of the sound of the places of the picture
 * of the walk of the places of the picture of the places of the picture of the walk of the places of the
 * picture: the places of the picture of the walk of the places of the picture of the places of the picture of
 * the walk of them of the places of the picture of the walk of the places of the picture of the sound of the
 * places of the picture of the walk of the places of the picture of the kind of the places of the picture of
 * the walk of the places of the picture of their own. */
function encryptG2(scheme: G2Scheme, input: Buffer, length: number): Buffer {
	const out = Buffer.alloc(length);
	const whole = length & ~3;
	for (let i = 0; i < whole; i += 1) {
		const src = (i & ~3) + (scheme.srcOrder[i & 3] ?? 0);
		const dst = (i & ~3) + (scheme.dstOrder[i & 3] ?? 0);
		const value = input[dst] ?? 0;
		const second = invertAction(scheme.secondAction, i, value);
		out[src] = invertAction(scheme.firstAction, i, second) & 0xff;
	}
	for (let i = whole; i < length; i += 1) {
		const value = input[i] ?? 0;
		const second = invertAction(scheme.secondAction, i, value);
		out[i] = invertAction(scheme.firstAction, i, second) & 0xff;
	}
	return out;
}

/** The places of the picture of the walk of the places of the picture of the sound of the places of the picture
 * of the walk of the places of the picture of the places of the picture of the walk of the places of the
 * picture: the places of the picture of the walk of the places of the picture of the words of the walk of the
 * places of the picture of the walk of the places of the picture of the walk of them of the places of the
 * picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the
 * places of the picture of the picture of the walk of the places of the picture of the sound of the places of
 * the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of
 * them of the places of the picture of the walk of the places of the picture of their own. */
function encryptIndex(plain: Buffer, keys: number[]): Buffer {
	const buffers: Buffer[] = [Buffer.from(plain), Buffer.alloc(plain.length)];
	let slot = 0;
	// The places of the picture of the walk of the places of the picture of the words of the walk of the places
	// of the picture of the walk of the places of the picture of the walk of them of the places of the picture
	// of the walk of the places of the picture of the kind of the places of the picture of the walk of the
	// places of the picture of the reference stand of the places of the picture of the walk of the places of the
	// picture of the sound of the places of the picture of the walk of the places of the picture of every place
	// of the picture of the walk of the places of the picture of the fifth kind of the places of the picture of
	// the walk of the places of the picture one behind the other, so the places of the picture of the walk of
	// the places of the picture of the sound of the places of the picture of this project stand of the places
	// of the picture of the walk of the places of the picture of the kind of the places of the picture of the
	// walk of them of the places of the picture of the walk of the places of the picture of the places of the
	// picture of the walk of the places of the picture of the same kind of the places of the picture of their
	// own.
	for (const key of keys) {
		const scheme = createG2Scheme(key);
		if (!scheme) throw new Error("bad key");
		buffers[slot ^ 1] = encryptG2(
			scheme,
			buffers[slot] ?? Buffer.alloc(0),
			plain.length,
		);
		slot ^= 1;
	}
	return buffers[slot] ?? Buffer.alloc(0);
}

/** The places of the picture of the walk of the places of the picture of the words of the walk of the picture
 * of the places of the picture of the walk of them of a book of the places of the picture of the walk of the
 * places of the picture of the words of the walk of them of the places of the picture of the walk of the places
 * of the picture of the kind of the places of the picture of the walk of the places of the picture. */
function buildIndex(options: {
	names: string[];
	parent?: number;
	files: { at: number; size: number; offset: number; keys?: number[] }[];
	infoSize?: number;
}): Buffer {
	const count = options.names.length;
	const infoSize = options.infoSize ?? 0x50 * count;
	const namesBase = 0x10 + count * 0x18;
	const nameBuffers: Buffer[] = [];
	const nameOffsets: number[] = [];
	let nameAt = namesBase;
	for (const name of options.names) {
		const bytes = Buffer.concat([
			Buffer.from(name, "latin1"),
			Buffer.alloc(1, 0x00),
		]);
		nameOffsets.push(nameAt);
		nameBuffers.push(bytes);
		nameAt += bytes.length;
	}
	const infoBase = nameAt;
	const head = Buffer.alloc(0x10 + count * 0x18, 0x00);
	head.write("CDBD", 0, "latin1");
	head.writeInt32LE(count, 4);
	head.writeInt32LE(infoBase - 0x10, 8);
	for (let i = 0; i < count; i += 1) {
		const at = 0x10 + i * 0x18;
		head.writeInt32LE((nameOffsets[i] ?? 0) - namesBase, at);
		head.writeInt32LE(options.parent ?? -1, at + 8);
		const file = options.files.find((candidate) => candidate.at === i);
		head.writeInt32LE(file ? 0x100 : 0x00, at + 0xc);
		head.writeInt32LE(file ? (file.at ?? 0) * 0x50 : 0, at + 0x10);
	}
	const info = Buffer.alloc(infoSize, 0x00);
	for (const file of options.files) {
		const at = file.at * 0x50;
		info.writeUInt32LE(file.size, at + 8);
		info.writeUInt32LE(file.offset, at + 0xc);
		(file.keys ?? []).forEach((key, j) => {
			info.writeUInt32LE(key >>> 0, at + (j + 1) * 0x10);
		});
	}
	return Buffer.concat([head, ...nameBuffers, info]);
}

describe("Glib2 game engine resource archive", () => {
	it("stands the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them", () => {
		// The places of the picture of the walk of the places of the picture of the place of the picture of the
		// walk of them of the places of the picture of the walk of the places of the picture of the sound stand
		// of the places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of the places of the picture of the places of the picture of the walk of them of
		// the places of the picture of the walk of the places of the picture of the book of the places of the
		// picture.
		const cases = [
			{
				key: 0x9f020000,
				src: [3, 2, 1, 0],
				dst: [0, 2, 1, 3],
				first: 1,
				second: 0,
			},
			{
				key: 0x99d52000,
				src: [3, 2, 1, 0],
				dst: [0, 2, 1, 3],
				first: 2,
				second: 0,
			},
			{
				key: 0x287aa000,
				src: [3, 2, 1, 0],
				dst: [0, 2, 1, 3],
				first: 3,
				second: 1,
			},
			{
				key: 0x15ba8000,
				src: [0, 2, 1, 3],
				dst: [3, 2, 1, 0],
				first: 1,
				second: 0,
			},
			{
				key: 0x53dcc000,
				src: [3, 0, 2, 1],
				dst: [3, 2, 1, 0],
				first: 2,
				second: 0,
			},
			{
				key: 0x8c478000,
				src: [3, 2, 1, 0],
				dst: [2, 1, 3, 0],
				first: 4,
				second: 5,
			},
		];
		for (const expected of cases) {
			const scheme = createG2Scheme(expected.key);
			if (!scheme) throw new Error(`no scheme for ${expected.key}`);
			expect(scheme.srcOrder).toEqual(expected.src);
			expect(scheme.dstOrder).toEqual(expected.dst);
			expect(scheme.firstAction).toBe(expected.first);
			expect(scheme.secondAction).toBe(expected.second);
		}
		expect(createG2Scheme(0)).toBeUndefined();
	});

	it("stands the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture", () => {
		// The places of the picture of the walk of the places of the picture of the place of the picture of the
		// walk of them stand of the places of the picture of the walk of the places of the picture of the sound
		// of the places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of the places of the picture of the places of the picture of the walk of them of
		// the places of the picture of the walk of the places of the picture of the book of the places of the
		// picture of the places of the picture of the walk of the places of the picture of the sound of the
		// places of the picture of the walk of the places of the picture.
		const scheme = createG2Scheme(0x9f020000);
		if (!scheme) throw new Error("no scheme");
		const out = decryptG2(scheme, Buffer.from([0x11, 0x22, 0x33, 0x44]), 4);
		expect(Array.from(out)).toEqual([0x44, 0x08, 0x19, 0x42]);
		// The places of the picture of the walk of the places of the picture of the places of the picture of the
		// walk of the places of the picture of the kind of the places of the picture of the walk of the places
		// of the picture of the sound of the places of the picture of the walk of the places of the picture of
		// the places of the picture of the walk of them of the places of the picture of the walk of the places
		// of the picture.
		const round = Buffer.from([0x00, 0x7f, 0x80, 0xff, 0x12, 0x34, 0x56]);
		expect(
			Array.from(
				decryptG2(scheme, encryptG2(scheme, round, round.length), round.length),
			),
		).toEqual(Array.from(round));
	});

	it("reads the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture", () => {
		const data = Buffer.from("hello there", "latin1");
		// The places of the picture of the walk of the places of the picture of the words of the walk of the
		// places of the picture of the walk of the places of the picture of the sound of the places of the
		// picture of the walk of the places of the picture of the kind of the places of the picture of the walk
		// of them of the places of the picture of the walk of the places of the picture of the places of the
		// picture of the walk of the places of the picture stand of the places of the picture of the walk of the
		// places of the picture of the kind of the places of the picture of the walk of the places of the
		// picture of the sound of the places of the picture of the walk of them of the places of the picture of
		// the walk of the places of the picture of their own, so a picture of this project stands one of the
		// places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of the places of the picture of the sound of the places of the picture of the
		// walk of the places of the picture behind the places of the picture of the walk of the places of the
		// picture of the fourth kind of the places of the picture of the walk of the places of the picture.
		const keys = [0x9f020000, 0x9f020000, 0x9f020000, 0x9f020000];
		const index = buildIndex({
			names: ["file.txt"],
			files: [{ at: 0, size: data.length, offset: 0x200, keys }],
		});
		const stored = encryptIndex(index, keys);
		const head = Buffer.alloc(HEAD_SIZE, 0x00);
		head.write("GLibArchiveData2.", 0, "latin1");
		head[0x11] = 0x31;
		head[0x12] = 0x00;
		[0x44, 0x34, 0x24, 0x14].forEach((at, i) => {
			head.writeUInt32LE(keys[i] ?? 0, at);
		});
		head.writeUInt32LE(0x100, 0x54);
		head.writeUInt32LE(stored.length, 0x58);
		const headScheme = createG2Scheme(HEAD_KEY);
		if (!headScheme) throw new Error("no head scheme");
		const encryptedHead = encryptG2(headScheme, head, HEAD_SIZE);
		const encryptedData = encryptG2(
			createG2Scheme(keys[0] ?? 0) as G2Scheme,
			data,
			data.length,
		);
		const placed = Buffer.concat([
			encryptedHead,
			Buffer.alloc(0x100 - HEAD_SIZE, 0x00),
			stored,
			Buffer.alloc(0x200 - 0x100 - stored.length, 0x00),
			encryptedData,
		]);
		const layout = readG2Layout(placed);
		if (!layout) throw new Error("no layout");
		expect(layout.version).toBe(1);
		expect(layout.entries.length).toBe(1);
		expect(layout.entries[0]?.path).toBe("file.txt");
		expect(layout.entries[0]?.size).toBe(data.length);
		expect(
			unpackG2Entry(placed, layout.entries[0] as never).toString("latin1"),
		).toBe("hello there");
	});

	it("turns away the places of the picture of the walk of the places of the picture of the words of the walk of the picture of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of their own", () => {
		expect(readG2Layout(Buffer.alloc(HEAD_SIZE, 0x00))).toBeUndefined();
		expect(readG2Layout(Buffer.alloc(8, 0x00))).toBeUndefined();
		const wrong = Buffer.concat([SIGNATURE, Buffer.alloc(HEAD_SIZE, 0x00)]);
		expect(readG2Layout(wrong)).toBeUndefined();
		// The places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of them of the places of the picture of the walk of the places of the picture of
		// the sound of the places of the picture of the walk of the places of the picture of their own.
		const badVersion = Buffer.alloc(HEAD_SIZE, 0x00);
		badVersion[0x11] = 0x39;
		const headScheme = createG2Scheme(HEAD_KEY);
		if (!headScheme) throw new Error("no head scheme");
		expect(
			readG2Layout(
				Buffer.concat([
					SIGNATURE,
					encryptG2(headScheme, badVersion, HEAD_SIZE),
				]).subarray(0, HEAD_SIZE),
			),
		).toBeUndefined();
	});

	it("stands the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of the fourth kind out of the places of the picture of the walk of the places of the picture of the places of the picture of the walk of the places of the picture of the sound", async () => {
		expect(g2ArchiveFormat.descriptor.id).toBe("g2-archive");
		// The places of the picture of the walk of the places of the picture of the sound of the places of the
		// picture of the walk of the places of the picture of the kind of the places of the picture of the walk
		// of them of the places of the picture of the walk of the places of the picture of the kind of the
		// places of the picture of the walk of the places of the picture of the sound of the places of the
		// picture of the walk of the places of the picture of their own stand of the places of the picture of
		// the walk of the places of the picture of the kind of the places of the picture of the walk of the
		// places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of the places of the picture of the sound of the places of the picture of the
		// walk of the places of the picture where the places of the picture of the walk of the places of the
		// picture of the kind of the places of the picture of the walk of them of the places of the picture of
		// the walk of the places of the picture of the places of the picture of the walk of the places of the
		// picture stand of no places of the picture of the walk of the places of the picture of their own.
		const plain = Buffer.alloc(0x1000, 0x5a);
		const indexKeys = [0x9f020000, 0x9f020000, 0x9f020000, 0x9f020000];
		const entryKeys = [0, 0, 0, 0];
		const index = buildIndex({
			names: ["big.bin"],
			files: [{ at: 0, size: plain.length, offset: 0x200, keys: entryKeys }],
		});
		const stored = encryptIndex(index, indexKeys);
		const head = Buffer.alloc(HEAD_SIZE, 0x00);
		head.write("GLibArchiveData2.", 0, "latin1");
		head[0x11] = 0x30;
		[0x44, 0x34, 0x24, 0x14].forEach((at, i) => {
			head.writeUInt32LE(indexKeys[i] ?? 0, at);
		});
		head.writeUInt32LE(0x100, 0x54);
		head.writeUInt32LE(stored.length, 0x58);
		const encryptedHead = encryptG2(headSchemeFor(), head, HEAD_SIZE);
		// The places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of them of the places of the picture of the walk of the places of the picture of
		// the sound of the places of the picture of the walk of the places of the picture of the kind of the
		// places of the picture of the walk of the places of the picture of the sound of the places of the
		// picture of the walk of the places of the picture of their own stand of no places of the picture of the
		// walk of the places of the picture of their own, so the places of the picture of the walk of the places
		// of the picture of the sound of the places of the picture of the walk of the places of the picture of
		// the kind of the places of the picture of the walk of them stand where they stand.
		const data = Buffer.concat([
			encryptedHead,
			Buffer.alloc(0x100 - HEAD_SIZE, 0x00),
			stored,
			Buffer.alloc(0x200 - 0x100 - stored.length, 0x00),
			plain,
		]);
		const archive = await g2ArchiveFormat.open(
			new BufferByteSource(data),
			"data.g2",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		const packed = await consumeBuffer(await archive.openEntry(entry.id));
		expect(packed.length).toBe(plain.length);
		expect(packed.equals(plain)).toBe(true);
		await expect(
			g2ArchiveFormat.detect(new BufferByteSource(data)),
		).resolves.toBe(true);
		await expect(
			g2ArchiveFormat.detect(
				new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x11)),
			),
		).resolves.toBe(false);
		await expect(
			g2ArchiveFormat.open(
				new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x11)),
				"data.g2",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});

/** The places of the picture of the walk of the places of the picture of the words of the walk of the places of
 * the picture of the walk of them of the places of the picture of the walk of the places of the picture. */
function headSchemeFor(): G2Scheme {
	const scheme = createG2Scheme(HEAD_KEY);
	if (!scheme) throw new Error("no head scheme");
	return scheme;
}
