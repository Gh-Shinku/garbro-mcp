// The Entis sound port, against sounds built in the test: the head of a sound of the engine (the word of
// the format, the identifier of the kind of the file and the name of it), the sections of the head of it
// (`SoundInf`, of the counts of the sound) and the counts of the walk of the engine of it (`SoundStm`).
//
// The counts of the walk of the engine of a sound of the kind `Lossless_ERI` stand of the counts of a
// picture of the engine alone: the fixture stands of an encoder of the counts of the walk of the engine
// itself (the walk of the tree of the counts of it of the port, of the places of the names of the tree and
// of the places of the count of no name of it), which stands of the walk of the places of the tree of a
// sound the walk of the port stands of. A sound of the kinds of the walks of a picture of the engine stands
// refused.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { entisMioAudioFormat } from "@garbro-mcp/formats";
import { ErisaHuffmanTree } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";
import { readWave } from "../../packages/formats/src/shared/wav.js";

const HEADER_SIZE = 0x40;
const FIRST_SECTION_END = 0x50;
const CHUNK_HEADER_SIZE = 0x08;
const ERISA_HUFFMAN_ROOT = 0x200;
const ERISA_HUFFMAN_NULL = 0x8000;
const MIO_LEAD_BLOCK = 0x01;
const SOUND_INFO_SECTION = "SoundInf";
const SOUND_STREAM_SECTION = "SoundStm";

function section(id: string, body: Buffer): Buffer {
	const head = Buffer.alloc(0x10, 0x00);
	head.write(id.padEnd(8, " "), 0, "latin1");
	head.writeBigInt64LE(BigInt(body.length), 8);
	return Buffer.concat([head, body]);
}

/** An `SoundInf` section: the counts of a sound of the engine and the kind of the walk of it. */
function soundInfoSection(input: {
	transformation?: number;
	architecture?: number;
	channels?: number;
	sampleRate?: number;
	bitsPerSample?: number;
}): Buffer {
	const body = Buffer.alloc(0x28, 0x00);
	body.writeInt32LE(0x00020100, 0);
	body.writeInt32LE(input.transformation ?? 0x03020000, 4);
	body.writeInt32LE(input.architecture ?? -4, 8);
	body.writeInt32LE(input.channels ?? 1, 0x0c);
	body.writeUInt32LE(input.sampleRate ?? 22050, 0x10);
	body.writeUInt32LE(0, 0x14);
	body.writeInt32LE(8, 0x18);
	body.writeUInt32LE(0, 0x1c);
	body.writeUInt32LE(1, 0x20);
	body.writeUInt32LE(input.bitsPerSample ?? 8, 0x24);
	return section(SOUND_INFO_SECTION, body);
}

/** A count of the walk of the engine of a sound: the counts of the count and the places of the walk. */
function soundStreamSection(input: {
	sampleCount: number;
	flags?: number;
	places: Buffer;
}): Buffer {
	const head = Buffer.alloc(CHUNK_HEADER_SIZE, 0x00);
	head[0] = 1;
	head[1] = input.flags ?? MIO_LEAD_BLOCK;
	head.writeInt16LE(0, 2);
	head.writeUInt32LE(input.sampleCount, 4);
	return section(SOUND_STREAM_SECTION, Buffer.concat([head, input.places]));
}

/** A sound of the engine: the head of it and the sections of the walk of it. */
function buildSound(input: {
	name?: string;
	id?: number;
	info?: Buffer;
	streams: Buffer[];
}): Buffer {
	const header = input.info ?? soundInfoSection({});
	const head = Buffer.alloc(FIRST_SECTION_END, 0x00);
	head.write("Enti", 0, "latin1");
	head.writeUInt32LE(input.id ?? 0x03000100, 8);
	head.write(input.name ?? "Music Interleaved", 0x10, "latin1");
	// The places of the counts of the walk of the engine stand of the sections of the head of the sound
	// behind the places of the places of the head of it, and the counts of the walk of the engine behind
	// the places of the places of the head of the sound.
	head.set(section("Header  ", header).subarray(0, 0x10), HEADER_SIZE);
	return Buffer.concat([
		head,
		header,
		section("Stream  ", Buffer.concat(input.streams)),
	]);
}

/** The places of the walk of the tree of the counts of the engine, of the name of a place of it. */
function pathTo(tree: ErisaHuffmanTree, place: number): number[] {
	const bits: number[] = [];
	let at = place;
	for (let level = 0; level < 0x40; level += 1) {
		const parent = tree.tree[at]?.parent ?? -1;
		if (parent < 0)
			throw new Error("the place of the tree stands of no walk of it");
		const child = tree.tree[parent]?.childCode ?? 0;
		// The places of the walk of the tree stand of the two places of a walk of it: the places of the
		// count of the walk of the engine in front of the places of the count of the walk of it.
		bits.unshift(at - child);
		if (parent === ERISA_HUFFMAN_ROOT) return bits;
		at = parent;
	}
	throw new Error("the place of the tree stands of no place of the root of it");
}

/** The places of a count of the walk of the engine, of the name of the count. */
function countPlaces(count: number): number[] {
	const bits: number[] = [];
	for (let at = 7; at >= 0; at -= 1) bits.push((count >> at) & 1);
	return bits;
}

/**
 * An encoder of the counts of the walk of the engine: the walk of the port stands of the places of the tree
 * of the counts of the walk of the engine, and this encoder stands of the walk of the places of the tree of
 * it itself (the places of the names of the tree, of the places of the count of no name of it and of the
 * counts of the walks of them).
 */
function encodeErina(places: readonly number[]): Buffer {
	// The walk of the engine stands of the tree of the counts of the walk of the engine of the name of the
	// count of the count in front of it: every name of the walk of the engine stands of a tree of its own.
	const trees: ErisaHuffmanTree[] = [];
	for (let at = 0; at < 0x101; at += 1) trees.push(new ErisaHuffmanTree());
	const bits: number[] = [];
	let tree = trees[0] ?? new ErisaHuffmanTree();
	for (const place of places) {
		const symbol = place & 0xff;
		const next = trees[symbol & 0xff];
		if (ERISA_HUFFMAN_NULL === tree.escape) {
			// The tree of the counts of the walk of the engine stands of no place of a name at all: the
			// count of the walk of the engine stands of the places of the count of the walk of it itself.
			bits.push(...countPlaces(symbol));
			tree.addNewEntry(symbol);
			tree = next ?? tree;
			continue;
		}
		const found = tree.symbolLookup[symbol] ?? ERISA_HUFFMAN_NULL;
		if (ERISA_HUFFMAN_NULL !== found) {
			// The place of the name of the tree stands of the walk of the places of the tree of the counts
			// of the walk of the engine, and the count of the walk of the place stands of the walk of it.
			bits.push(...pathTo(tree, found));
			tree.increaseOccuredCount(found);
			tree = next ?? tree;
			continue;
		}
		// The place of the count of the walk of the engine of the places of the walk of the engine of no
		// name at all stands of the places of the count of the walk of the engine itself behind it.
		bits.push(...pathTo(tree, tree.escape));
		tree.increaseOccuredCount(tree.escape);
		bits.push(...countPlaces(symbol));
		tree.addNewEntry(symbol);
		tree = next ?? tree;
	}
	const out = Buffer.alloc(Math.ceil(bits.length / 8), 0x00);
	for (const [at, bit] of bits.entries()) {
		if (0 !== bit) {
			out[Math.floor(at / 8)] =
				(out[Math.floor(at / 8)] ?? 0) | (1 << (7 - (at % 8)));
		}
	}
	return out;
}

async function soundOf(data: Buffer) {
	const source = new BufferByteSource(data);
	expect(await entisMioAudioFormat.detect(source, "sound.mio")).toBe(true);
	const archive = await entisMioAudioFormat.open(source, "sound.mio");
	const entry = archive.entries[0];
	if (!entry) throw new Error("no entry");
	const wave = await consumeBuffer(await archive.openEntry(entry.id));
	await archive.close();
	return { wave, read: readWave(wave) };
}

describe("Entis sound", () => {
	it("reads the head of a sound of the engine and the counts of the walk of it", async () => {
		// The counts of the walk of the engine stand of the counts of the walk of the sound of the engine,
		// of the count of the walk of a picture of the engine of its own.
		const deltas = [1, 2, 3, 4];
		const data = buildSound({
			streams: [
				soundStreamSection({
					sampleCount: deltas.length,
					places: encodeErina(deltas),
				}),
			],
		});
		const source = new BufferByteSource(data);
		expect(await entisMioAudioFormat.detect(source, "sound.mio")).toBe(true);
		const archive = await entisMioAudioFormat.open(source, "sound.mio");
		try {
			expect(archive.metadata).toMatchObject({
				audio: "wav",
				compression: "pcm",
				sampleRate: 22050,
				channels: 1,
				bitsPerSample: 8,
				chunks: 1,
			});
			expect(archive.entries[0]?.path).toBe("sound.wav");
		} finally {
			await archive.close();
		}
		const { read } = await soundOf(data);
		if (!read) throw new Error("no wave file of the walk");
		expect(read.format).toMatchObject({
			formatTag: 1,
			channels: 1,
			sampleRate: 22050,
			blockAlign: 1,
			bitsPerSample: 8,
		});
	});

	it("stands of the places of the counts of the walk of the engine", async () => {
		// The places of a sound of the engine stand of the counts of the walk of the engine over each other:
		// the count of the walk of the engine stands of the count of the walk of the engine in front of it.
		const deltas = [0x10, 0xf0, 0x20, 0x05, 0xff, 0x01, 0x7f, 0x81];
		const data = buildSound({
			streams: [
				soundStreamSection({
					sampleCount: deltas.length,
					places: encodeErina(deltas),
				}),
			],
		});
		const { wave, read } = await soundOf(data);
		if (!read) throw new Error("no wave file of the walk");
		let value = 0;
		const expected: number[] = [];
		for (const delta of deltas) {
			value = (value + delta) & 0xff;
			expected.push(value);
		}
		expect([
			...wave.subarray(read.dataOffset, read.dataOffset + read.dataSize),
		]).toEqual(expected);
	});

	it("stands of the counts of the walk of the engine of the two kinds of the places of a sound", async () => {
		// A sound of the engine of two places of a colour stands of the counts of the walk of the engine of
		// every place of a colour behind the counts of the walk of the engine in front of it.
		// The places of the walk of the engine stand of the counts of a colour one behind the other, of
		// every place of a colour of its own.
		// Two counts of a colour and two places of a sound: the places of the walk of the engine stand of
		// the places of the first count of a colour in front of the places of the second.
		const deltas = [0x01, 0x02, 0x03, 0x04];
		const data = buildSound({
			info: soundInfoSection({ channels: 2, sampleRate: 44100 }),
			streams: [
				soundStreamSection({
					sampleCount: deltas.length / 2,
					places: encodeErina(deltas),
				}),
			],
		});
		const { wave, read } = await soundOf(data);
		if (!read) throw new Error("no wave file of the walk");
		expect(read.format).toMatchObject({
			channels: 2,
			sampleRate: 44100,
			blockAlign: 2,
			bitsPerSample: 8,
		});
		// The places of the walk of the engine stand of the counts of a colour one behind the other: every
		// count of a colour stands of the counts of the walk of the engine of the places of it, of the
		// counts of the walk of the engine in front of it.
		const half = deltas.length / 2;
		let left = 0;
		let right = 0;
		const expected: number[] = [];
		for (let at = 0; at < half; at += 1) {
			left = (left + (deltas[at] ?? 0)) & 0xff;
			right = (right + (deltas[half + at] ?? 0)) & 0xff;
			expected.push(left, right);
		}
		expect([
			...wave.subarray(read.dataOffset, read.dataOffset + read.dataSize),
		]).toEqual(expected);
	});

	it("stands of the counts of the walk of a sound of sixteen places of a count of it", async () => {
		// The places of a count of the walk of the engine of a sound of sixteen places of a count stand of
		// the count of the places of the walk of a count of no sign at all and of the count of the places of
		// the count behind it, every one of them of the places of the count of the walk of a count of its own
		// within a count of the walk of a colour.
		const decoded = [0x01, 0x01, 0x01, 0x01];
		const data = buildSound({
			info: soundInfoSection({ bitsPerSample: 16 }),
			streams: [
				soundStreamSection({
					sampleCount: 2,
					places: encodeErina(decoded),
				}),
			],
		});
		const { wave, read } = await soundOf(data);
		if (!read) throw new Error("no wave file of the walk");
		expect(read.format).toMatchObject({
			channels: 1,
			blockAlign: 2,
			bitsPerSample: 16,
		});
		// The count of the places of the walk of the engine of sixteen places of a count stands of the
		// counts of the walk of the engine of every count of a sound over each other, of the count of the
		// count of the walk of the engine behind the walk of it: the count of the places of a count of the
		// walk of the engine stands of the count of the count in front of it, and the places of the walk of
		// the engine stand of the counts of the walk of every one of them over each other.
		let delta = 0;
		let value = 0;
		const expected: number[] = [];
		for (let at = 0; at < 2; at += 1) {
			delta = (delta + 0x101) & 0xffff;
			value = (value + delta) & 0xffff;
			expected.push(value & 0xff, (value >> 8) & 0xff);
		}
		expect([
			...wave.subarray(read.dataOffset, read.dataOffset + read.dataSize),
		]).toEqual(expected);
	});

	it("stands of the counts of the walk of the engine of the places of a sound of a kind of its own", async () => {
		// A sound of the kind `LOT_ERI` stands of the walks of a picture of the engine, which this port holds
		// no walk of: the sound stands of this engine, and the places of it stand refused.
		const data = buildSound({
			info: soundInfoSection({ transformation: 0x00000005, bitsPerSample: 16 }),
			streams: [
				soundStreamSection({ sampleCount: 4, places: Buffer.alloc(4, 0x00) }),
			],
		});
		const source = new BufferByteSource(data);
		expect(await entisMioAudioFormat.detect(source, "sound.mio")).toBe(true);
		const archive = await entisMioAudioFormat.open(source, "sound.mio");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "UNSUPPORTED_FEATURE",
			});
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
		} finally {
			await archive.close();
		}
	});

	it("turns away a name of another kind, another identifier and a sound of no count of a walk", async () => {
		const other = buildSound({
			name: "Another Sound",
			streams: [
				soundStreamSection({ sampleCount: 1, places: encodeErina([1]) }),
			],
		});
		expect(
			await entisMioAudioFormat.detect(
				new BufferByteSource(other),
				"other.mio",
			),
		).toBe(false);
		const wrongId = buildSound({
			id: 0x01000100,
			streams: [
				soundStreamSection({ sampleCount: 1, places: encodeErina([1]) }),
			],
		});
		expect(
			await entisMioAudioFormat.detect(
				new BufferByteSource(wrongId),
				"wrong.mio",
			),
		).toBe(false);
		// The reference stands of a sound of no count of the walk of the engine of its own as of a sound of
		// no places at all; this port stands of it as of no sound of the engine.
		const empty = buildSound({ streams: [] });
		expect(
			await entisMioAudioFormat.detect(
				new BufferByteSource(empty),
				"empty.mio",
			),
		).toBe(false);
	});
});
