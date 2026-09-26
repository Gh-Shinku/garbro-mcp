// The Entis sound port, against sounds built in the test: the head of a sound of the engine (the word of
// the format, the identifier of the kind of the file and the name of it), the sections of the head of it
// (`SoundInf`, of the counts of the sound) and the counts of the walk of the engine of it (`SoundStm`).
//
// The counts of the walk of the engine of a sound of the kind `Lossless_ERI` stand of the counts of a
// picture of the engine alone: the fixture stands of an encoder of the counts of the walk of the engine
// itself (the walk of the tree of the counts of it of the port, of the places of the names of the tree and
// of the places of the count of no name of it), which stands of the walk of the places of the tree of a
// sound the walk of the port stands of. A sound of the kind `LOT_ERI` stands of the walks of a picture of
// the engine (`MioDecoder.DecodeSoundDCT`), whose counts stand of the fixture of the bits of the walk of
// the counts of it (`dctPlaces`) and of the counts of the walk of the engine itself.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { MioDecoder, entisMioAudioFormat } from "@garbro-mcp/formats";
import { ErisaHuffmanTree } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";
import { readWave } from "../../packages/formats/src/shared/wav.js";

const HEADER_SIZE = 0x40;
const FIRST_SECTION_END = 0x50;
const CHUNK_HEADER_SIZE = 0x08;
const ERISA_HUFFMAN_ROOT = 0x200;
const ERISA_HUFFMAN_NULL = 0x8000;
const MIO_LEAD_BLOCK = 0x01;
const CHANNELS = 2;
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
	subbandDegree?: number;
	lappedDegree?: number;
}): Buffer {
	const body = Buffer.alloc(0x28, 0x00);
	body.writeInt32LE(0x00020100, 0);
	body.writeInt32LE(input.transformation ?? 0x03020000, 4);
	body.writeInt32LE(input.architecture ?? -4, 8);
	body.writeInt32LE(input.channels ?? 1, 0x0c);
	body.writeUInt32LE(input.sampleRate ?? 22050, 0x10);
	body.writeUInt32LE(0, 0x14);
	body.writeInt32LE(input.subbandDegree ?? 8, 0x18);
	body.writeUInt32LE(0, 0x1c);
	body.writeUInt32LE(input.lappedDegree ?? 1, 0x20);
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
 * The places of a count of the walk of the counts of the engine of no name at all, of the count of the walk
 * of it (`GetGammaCode`): the count of the walk of the engine stands of a place of the walk of it of its own
 * in front of the counts of the walk of the engine behind it, and every count of the walk of the engine
 * behind the count of the walk of it stands of a place of the count of the walk of it and of the count of
 * the walk of the engine behind the places of the walk of it.
 */
function gammaBits(value: number): number[] {
	if (1 === value) return [0];
	const top = 31 - Math.clz32(value);
	const code = value - (1 << top);
	const bits: number[] = [1];
	for (let at = top - 1; at >= 0; at -= 1) {
		bits.push((code >>> at) & 1);
		bits.push(0 === at ? 0 : 1);
	}
	return bits;
}

/** The places of a name of the walk of the engine, of the tree of the counts of the walk of the engine. */
function addSymbolBits(
	bits: number[],
	tree: ErisaHuffmanTree,
	symbol: number,
): void {
	if (ERISA_HUFFMAN_NULL === tree.escape) {
		// The tree of the counts of the walk of the engine stands of no place of a name at all: the count of
		// the walk of the engine stands of the places of the count of the walk of it itself.
		bits.push(...countPlaces(symbol));
		tree.addNewEntry(symbol);
		return;
	}
	const found = tree.symbolLookup[symbol] ?? ERISA_HUFFMAN_NULL;
	if (ERISA_HUFFMAN_NULL !== found) {
		// The place of the name of the tree stands of the walk of the places of the tree of the counts of the
		// walk of the engine, and the count of the walk of the place stands of the walk of it.
		bits.push(...pathTo(tree, found));
		tree.increaseOccuredCount(found);
		return;
	}
	// The place of the count of the walk of the engine of the places of the walk of the engine of no name at
	// all stands of the places of the count of the walk of the engine itself behind it.
	bits.push(...pathTo(tree, tree.escape));
	tree.increaseOccuredCount(tree.escape);
	bits.push(...countPlaces(symbol));
	tree.addNewEntry(symbol);
}

/**
 * The places of the count of the walk of the engine of the count of no name at all, of the count of the
 * places of the walk of it (`GetLengthHuffman`): the counts of the walk of the engine of the count of no
 * name at all stand of the counts of the walk of the engine of the count of the walk of the engine of its
 * own, of no place of a count of the walk of the engine at all.
 */
function addLengthBits(
	bits: number[],
	tree: ErisaHuffmanTree,
	count: number,
): void {
	if (ERISA_HUFFMAN_NULL === tree.escape) {
		bits.push(...gammaBits(count));
		tree.addNewEntry(count);
		return;
	}
	const found = tree.symbolLookup[count] ?? ERISA_HUFFMAN_NULL;
	if (ERISA_HUFFMAN_NULL !== found) {
		bits.push(...pathTo(tree, found));
		tree.increaseOccuredCount(found);
		return;
	}
	bits.push(...pathTo(tree, tree.escape));
	tree.increaseOccuredCount(tree.escape);
	bits.push(...gammaBits(count));
	tree.addNewEntry(count);
}

/**
 * An encoder of the counts of the walk of the engine: the walk of the port stands of the places of the tree
 * of the counts of the walk of the engine, and this encoder stands of the walk of the places of the tree of
 * it itself (the places of the names of the tree, of the places of the count of no name of it and of the
 * counts of the walks of them).
 */
function encodeErinaBits(places: readonly number[]): number[] {
	// The walk of the engine stands of the tree of the counts of the walk of the engine of the name of the
	// count of the count in front of it: every name of the walk of the engine stands of a tree of its own.
	// The count of the walk of the engine of no name at all stands of a count of the walk of the engine of
	// its own (`0x100`) and of the count of the places of the walk of it.
	const trees: ErisaHuffmanTree[] = [];
	for (let at = 0; at < 0x101; at += 1) trees.push(new ErisaHuffmanTree());
	const lengthTree = new ErisaHuffmanTree();
	const bits: number[] = [];
	let tree = trees[0] ?? new ErisaHuffmanTree();
	let at = 0;
	while (at < places.length) {
		const symbol = (places[at] ?? 0) & 0xff;
		addSymbolBits(bits, tree, symbol);
		at += 1;
		if (0 === symbol) {
			// The count of the walk of the engine of the places of the walk of the engine of no name at all
			// stands of the count of the places of the walk of the engine behind it.
			let run = 1;
			while (at < places.length && 0 === ((places[at] ?? 0) & 0xff)) {
				run += 1;
				at += 1;
			}
			addLengthBits(bits, lengthTree, run);
		}
		tree = trees[symbol] ?? tree;
	}
	return bits;
}

/** The places of a count of the walk of the engine of the port, of the places of the walk of it. */
function bitsToBuffer(bits: readonly number[]): Buffer {
	const out = Buffer.alloc(Math.ceil(bits.length / 8), 0x00);
	for (const [at, bit] of bits.entries()) {
		if (0 !== bit) {
			out[Math.floor(at / 8)] =
				(out[Math.floor(at / 8)] ?? 0) | (1 << (7 - (at % 8)));
		}
	}
	return out;
}

/** The places of the walk of the engine of a count of the walk of a sound of the engine. */
function encodeErina(places: readonly number[]): Buffer {
	return bitsToBuffer(encodeErinaBits(places));
}

/**
 * The places of a count of the walk of the engine of a picture of the engine (`DecodeSoundDCT`): the count
 * of the walk of the engine at the head of it (no count of the walk of it), the counts of the walk of the
 * engine of every count of the walk of a picture, the count of the walk of the engine at the end of it and
 * the places of the walk of the engine itself.
 */
function dctPlaces(input: {
	channels: number;
	weightCodes: readonly number[];
	coefficients: readonly number[];
	places: readonly number[];
	mss?: boolean;
	revolveCodes?: readonly number[];
}): Buffer {
	const bits: number[] = [];
	const word = (value: number, count: number): void => {
		for (let at = count - 1; at >= 0; at -= 1) bits.push((value >>> at) & 1);
	};
	bits.push(0);
	if (input.mss) {
		// The counts of the walk of the engine of the counts of the walk of the engine of a count of the
		// walk of a sound of the engine of two counts of a colour stand of the counts of the walk of the
		// engine of no count of the walk of the engine of the places of a count of the walk of the engine
		// itself: one count of the walk of the engine of a count of a colour.
		word(0, 2);
		word(input.revolveCodes?.[0] ?? 0, 2);
		word(input.weightCodes[0] ?? 0, 32);
		word(input.coefficients[0] ?? 0, 16);
		word(input.revolveCodes?.[1] ?? 0, 2);
		word(input.weightCodes[1] ?? 0, 32);
		word(input.coefficients[1] ?? 0, 16);
	} else {
		for (let channel = 0; channel < input.channels; channel += 1) {
			// The count of the walk of the engine stands of no count of the walk of the places of a count of
			// the walk of the engine: one count of the walk of it of every count of a colour.
			word(0, 2);
			word(input.weightCodes[channel * 2] ?? 0, 32);
			word(input.coefficients[channel * 2] ?? 0, 16);
		}
		for (let channel = 0; channel < input.channels; channel += 1) {
			word(input.weightCodes[channel * 2 + 1] ?? 0, 32);
			word(input.coefficients[channel * 2 + 1] ?? 0, 16);
		}
	}
	bits.push(0);
	bits.push(...encodeErinaBits(input.places));
	return bitsToBuffer(bits);
}

/** The places of the walk of the engine of a sound of the kind `LOT_ERI`, of the counts of the walk of it. */
function lotSound(input: {
	channels?: number;
	sampleCount: number;
	places: readonly number[];
	weightCode?: number;
	coefficient?: number;
	transformation?: number;
	subbandDegree?: number;
	lappedDegree?: number;
	bitsPerSample?: number;
	revolveCodes?: readonly number[];
}): Buffer {
	const channels = input.channels ?? 1;
	const weightCode = input.weightCode ?? 0;
	const coefficient = input.coefficient ?? 0x1000;
	// The counts of the walk of the engine of a count of the walk of a sound of the engine of two counts of
	// a colour stand of the counts of the walk of the engine of the count of the walk of the engine of no
	// count of the walk of the engine of a picture of its own: the reference stands of a sound of one count
	// of a colour of the counts of the walk of the engine of the count of the walk of `LOT_ERI` of it.
	const mss =
		0x00000105 === (input.transformation ?? 0x00000005) &&
		CHANNELS === channels;
	return buildSound({
		info: soundInfoSection({
			transformation: input.transformation ?? 0x00000005,
			channels,
			bitsPerSample: input.bitsPerSample ?? 16,
			subbandDegree: input.subbandDegree ?? 8,
			lappedDegree: input.lappedDegree ?? 1,
		}),
		streams: [
			soundStreamSection({
				sampleCount: input.sampleCount,
				places: dctPlaces({
					channels,
					weightCodes: Array.from({ length: channels * 2 }, () => weightCode),
					coefficients: Array.from({ length: channels * 2 }, () => coefficient),
					places: input.places,
					mss,
					revolveCodes: input.revolveCodes ?? [],
				}),
			}),
		],
	});
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

	it("stands of the counts of the walk of the places of a sound of the kind of a picture of the engine", async () => {
		// The places of the walk of a picture of the engine stand of the counts of the walk of the engine of
		// the counts of the walk of the count of the sound: the counts of the walk of the count of one count
		// at all stand of the counts of the walk of the engine of every count of the walk of it of its own.
		const places = new Array(0x200).fill(1);
		const data = lotSound({ sampleCount: 2, places, coefficient: 0x10 });
		const first = await soundOf(data);
		if (!first.read) throw new Error("no wave file of the walk");
		expect(first.read.format).toMatchObject({
			channels: 1,
			sampleRate: 22050,
			blockAlign: 2,
			bitsPerSample: 16,
		});
		expect(first.read.dataSize).toBe(4);
		// The places of the count of the walk of the engine of the count of the walk of the sound of the
		// engine stand of the counts of the walk of the engine of the count of the walk of the reference, of
		// the count of the walk of the engine of the count of no sign at all of the places of the walk of it.
		expect([
			...first.wave.subarray(first.read.dataOffset, first.read.dataOffset + 4),
		]).toEqual([14, 10, 103, 243]);
		// The counts of the walk of the engine of a count of the walk of a sound stand of the counts of the
		// walk of the engine of the counts of the walk of it itself: the places of the walk of the engine of
		// two counts of the walk of the engine stand of the counts of the walk of the engine of the count of
		// the walk of the sound of the counts of the walk of it.
		const second = await soundOf(data);
		expect([
			...second.wave.subarray(
				second.read?.dataOffset ?? 0,
				(second.read?.dataOffset ?? 0) + 4,
			),
		]).toEqual([14, 10, 103, 243]);
	});

	it("stands of the counts of the walk of the engine of the places of a sound of two counts of a colour", async () => {
		// The counts of the walk of the engine of a sound of two counts of a colour stand of the counts of the
		// walk of the engine of every count of a colour of its own, one behind the other.
		const places = new Array(0x400).fill(1);
		const { wave, read } = await soundOf(
			lotSound({ channels: 2, sampleCount: 2, places, coefficient: 0x10 }),
		);
		if (!read) throw new Error("no wave file of the walk");
		expect(read.format).toMatchObject({
			channels: 2,
			blockAlign: 4,
			bitsPerSample: 16,
		});
		expect(read.dataSize).toBe(8);
		expect([...wave.subarray(read.dataOffset, read.dataOffset + 8)]).toEqual([
			14, 10, 14, 10, 103, 243, 103, 243,
		]);
	});

	it("stands of the counts of the walk of the engine of the counts of the walk of a sound over each other", async () => {
		// The walk of the places of a picture of the engine stands of the counts of a picture of the engine
		// itself, of the counts of the walk of the engine of the counts of the walk of the count: a sound of
		// the counts of the walk of the engine of two counts of a picture of the engine stands of the counts
		// of the walk of the engine of the places of the count of the sound, of the count of the walk of the
		// engine of the places of the sound itself behind it.
		const count = 0x200;
		const single = await soundOf(
			lotSound({
				sampleCount: 2,
				places: new Array(count).fill(1),
				coefficient: 0x10,
			}),
		);
		const double = await soundOf(
			lotSound({
				sampleCount: 2,
				places: new Array(count).fill(2),
				coefficient: 0x10,
			}),
		);
		if (!single.read || !double.read)
			throw new Error("no wave file of the walk");
		const samples = (
			wave: Buffer,
			read: { dataOffset: number; dataSize: number },
		): number[] => {
			const view = new DataView(
				wave.buffer,
				wave.byteOffset + read.dataOffset,
				read.dataSize,
			);
			const out: number[] = [];
			for (let at = 0; at < read.dataSize / 2; at += 1) {
				out.push(view.getInt16(at * 2, true));
			}
			return out;
		};
		const one = samples(single.wave, single.read);
		const two = samples(double.wave, double.read);
		expect(one.length).toBe(2);
		// The counts of the walk of the engine of the places of the count of the walk of a picture of the
		// engine stand of the counts of the walk of the engine of the places of the count of the walk of the
		// sound of the engine itself: the places of the walk of the engine of two counts of a picture of the
		// engine stand of the places of the count of the walk of the engine of the sound, of the counts of
		// the walk of the engine of the count of the walk of it over each other.
		expect(one.some((value) => 0 !== value)).toBe(true);
		for (const [at, value] of two.entries()) {
			expect(Math.abs(value - 2 * (one[at] ?? 0))).toBeLessThanOrEqual(2);
		}
	});

	it("stands of the counts of the walk of the engine of the places of no name at all", async () => {
		// The places of a count of the walk of the engine of no name at all stand of the count of the places
		// of the walk of the engine behind them (`GetLengthHuffman`), of the counts of the walk of the
		// engine of the count of the walk of the engine of its own (`GetGammaCode`): a sound of the engine
		// of the places of no name at all stands of the counts of the walk of the engine of every place of
		// the count of the walk of it over each other.
		const deltas = [0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x03];
		const { wave, read } = await soundOf(
			buildSound({
				streams: [
					soundStreamSection({
						sampleCount: deltas.length,
						places: encodeErina(deltas),
					}),
				],
			}),
		);
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
		expect(expected).toEqual([1, 1, 1, 1, 3, 3, 6]);
		// The places of a sound of the counts of the walk of the engine of sixteen places of a count stand
		// of the counts of the walk of the engine of no name at all as well.
		const folded = [0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x00, 0x00];
		const sixteen = await soundOf(
			buildSound({
				info: soundInfoSection({ bitsPerSample: 16 }),
				streams: [
					soundStreamSection({
						sampleCount: 2,
						places: encodeErina(folded),
					}),
				],
			}),
		);
		if (!sixteen.read) throw new Error("no wave file of the walk");
		let count = 0;
		let eight = 0;
		const words: number[] = [];
		for (let at = 0; at < 2; at += 1) {
			const low = ((folded[2 + at] ?? 0) << 24) >> 24;
			const high = ((folded[at] ?? 0) << 24) >> 24;
			const value16 = (low & 0xff) | ((high ^ (low >> 8)) << 8);
			count = (count + value16) & 0xffff;
			eight = (eight + count) & 0xffff;
			words.push(eight & 0xff, (eight >> 8) & 0xff);
		}
		expect([
			...sixteen.wave.subarray(
				sixteen.read.dataOffset,
				sixteen.read.dataOffset + sixteen.read.dataSize,
			),
		]).toEqual(words);
	});

	it("stands of the counts of the walk of the engine of the places of no place of a picture of the engine", async () => {
		// The places of the walk of the engine of a picture of the engine of no place of the count of the
		// walk of the engine at all stand of the counts of the walk of the engine of no place of the count
		// of the walk of the sound of the engine at all: the counts of the walk of the engine of the count
		// of the walk of the engine of no count of the walk of the engine at all stand of the counts of the
		// walk of the engine of no count of the walk of the engine of its own.
		const { wave, read } = await soundOf(
			lotSound({
				sampleCount: 2,
				places: new Array(0x200).fill(0),
				coefficient: 0x10,
			}),
		);
		if (!read) throw new Error("no wave file of the walk");
		expect(read.dataSize).toBe(4);
		expect([
			...wave.subarray(read.dataOffset, read.dataOffset + read.dataSize),
		]).toEqual([0, 0, 0, 0]);
		// The counts of the walk of the engine of the two counts of a colour of a picture of the engine
		// stand of the counts of the walk of the engine of no place of the count of the walk of the engine
		// at all as well.
		const stereo = await soundOf(
			lotSound({
				channels: 2,
				sampleCount: 2,
				places: new Array(0x400).fill(0),
				coefficient: 0x10,
			}),
		);
		if (!stereo.read) throw new Error("no wave file of the walk");
		expect(stereo.read.dataSize).toBe(8);
		expect([
			...stereo.wave.subarray(
				stereo.read.dataOffset,
				stereo.read.dataOffset + stereo.read.dataSize,
			),
		]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
	});

	it("stands of the counts of the walk of the engine of a count of the walk of a sound of the engine", () => {
		// The counts of the walk of the engine of a count of the walk of a sound stand of the counts of the
		// walk of the count of the walk of it itself: the counts of the walk of the engine of the count of no
		// sign at all of the count of the walk of it stand of the counts of the walk of the engine of every
		// count of the walk of a picture of the engine. The counts of the walk of the engine of the counts of
		// the walk of the engine of the count of the walk of the sound stand of the counts of the walk of the
		// engine of the count of the walk of the engine of the reference outside this port.
		const decoder = new MioDecoder({
			version: 0x00020100,
			transformation: 0x00000005,
			architecture: -4,
			channelCount: 1,
			samplesPerSec: 22050,
			blocksetCount: 0,
			subbandDegree: 8,
			allSampleCount: 0,
			lappedDegree: 1,
			bitsPerSample: 16,
		});
		decoder.initializeWithDegree(8);
		const quantized = new Int32Array(0x100).fill(1);
		const dst = new Float32Array(0x100);
		decoder.iQuantumize(dst, 0, quantized, 0, 0x100, 0, 1024);
		expect(dst[0] ?? 0).toBeCloseTo(0.5, 4);
		expect(dst[66] ?? 0).toBeCloseTo(0.5, 4);
		expect(dst[98] ?? 0).toBeCloseTo(0.5105782856768404, 4);
		expect(dst[130] ?? 0).toBeCloseTo(0.7718552597026428, 4);
		expect(dst[254] ?? 0).toBeCloseTo(90.50966799187809, 4);
		expect(dst[255] ?? 0).toBeCloseTo(0.08838834764831845, 4);
		// The counts of the walk of the engine of the places of the count of the walk of a picture of the
		// engine stand of the counts of the walk of the engine of the count of the walk of the count of the
		// count of the walk of the engine behind the places of the walk of the engine of it: the count of the
		// walk of the engine of the places of the count of the walk of the engine of the count of the walk of
		// the engine of the count of the walk of the sound stand of the counts of the walk of the engine of
		// the count of the walk of it of its own.
		const odd = new Float32Array(0x100);
		decoder.iQuantumize(odd, 0, quantized, 0, 0x100, 0x40000000, 1024);
		expect(odd[15] ?? 0).toBeCloseTo(0.5 / 1.5, 4);
		expect(odd[31] ?? 0).toBeCloseTo(0.5 / 1.5, 4);
		expect(odd[254] ?? 0).toBeCloseTo(90.50966799187809, 4);
		expect(odd[255] ?? 0).toBeCloseTo(0.08838834764831845, 4);
	});

	it("stands of the counts of the walk of the engine of the places of a sound of two counts of a colour of the walk of a picture of it", async () => {
		// A sound of the kind `LOT_ERI_MSS` stands of the counts of the walk of the engine of the two counts
		// of a colour of a count of the walk of a picture of the engine (`DecodeSoundDCT_MSS`): the counts of
		// the walk of the engine of the counts of the walk of the engine of the count of the walk of the
		// picture of the engine itself stand of the counts of the walk of the engine of the count of the
		// walk of the engine of the sound itself.
		const places = new Array(0x400).fill(1);
		const bytesOf = async (data: Buffer): Promise<number[]> => {
			const { wave, read } = await soundOf(data);
			if (!read) throw new Error("no wave file of the walk");
			return [
				...wave.subarray(read.dataOffset, read.dataOffset + read.dataSize),
			];
		};
		const plain = await bytesOf(
			lotSound({ channels: 2, sampleCount: 2, places, coefficient: 0x10 }),
		);
		// The counts of the walk of the engine of no count of the walk of the engine of a picture of the
		// engine stand of the counts of the walk of the engine of the walk of the count of the kind
		// `LOT_ERI` of it: the two counts of the walk of the engine stand of the same places of the walk of
		// the engine of their own.
		const mss = await bytesOf(
			lotSound({
				channels: 2,
				sampleCount: 2,
				places,
				coefficient: 0x10,
				transformation: 0x00000105,
				revolveCodes: [0, 0],
			}),
		);
		expect(mss).toEqual(plain);
		// The counts of the walk of the engine of the count of the walk of the engine of the count of the
		// walk of the sound of the engine of the counts of the walk of the engine of no count at all stand of
		// the counts of the walk of the engine of the count of the walk of the engine of the count of the
		// walk of the engine of the count of the walk of the engine of its own.
		const turned = await bytesOf(
			lotSound({
				channels: 2,
				sampleCount: 2,
				places,
				coefficient: 0x10,
				transformation: 0x00000105,
				revolveCodes: [1, 2],
			}),
		);
		expect(turned).toHaveLength(8);
		expect(turned).not.toEqual(plain);
	});

	it("stands of the counts of the walk of the engine of the places of a sound of one count of a colour of the walk of a picture of it", async () => {
		// A sound of the kind `LOT_ERI_MSS` of one count of a colour stands of the counts of the walk of a
		// picture of the engine alone, of the count of the walk of the engine of the walk of it.
		const mono = await soundOf(
			lotSound({
				sampleCount: 2,
				places: new Array(0x200).fill(1),
				coefficient: 0x10,
				transformation: 0x00000105,
			}),
		);
		if (!mono.read) throw new Error("no wave file of the walk");
		expect(mono.read.format).toMatchObject({ channels: 1, bitsPerSample: 16 });
		expect(mono.read.dataSize).toBe(4);
		expect([
			...mono.wave.subarray(mono.read.dataOffset, mono.read.dataOffset + 4),
		]).toEqual([14, 10, 103, 243]);
	});

	it("turns away a sound of the walks of a picture of the engine of counts of its own", async () => {
		// The reference stands of the counts of the walk of a picture of the engine of a count of the walk of
		// the engine of eight places of a count of it and of the count of the walk of the engine of the
		// places of the count of the walk of it alone: a sound of the counts of the walk of it of no count
		// stands of no sound of this engine.
		for (const info of [
			soundInfoSection({
				transformation: 0x00000005,
				bitsPerSample: 8,
			}),
			soundInfoSection({
				transformation: 0x00000005,
				bitsPerSample: 16,
				subbandDegree: 4,
			}),
			soundInfoSection({
				transformation: 0x00000005,
				bitsPerSample: 16,
				lappedDegree: 2,
			}),
			soundInfoSection({
				transformation: 0x00000005,
				bitsPerSample: 16,
				architecture: -8,
			}),
		]) {
			const data = buildSound({
				info,
				streams: [
					soundStreamSection({ sampleCount: 2, places: Buffer.alloc(8, 0x00) }),
				],
			});
			expect(
				await entisMioAudioFormat.detect(
					new BufferByteSource(data),
					"sound.mio",
				),
			).toBe(false);
		}
		// The reference stands of the counts of the walk of a picture of the engine of the counts of the
		// walk of the engine itself (`RunlengthGamma`) as of the walk of the places of the walk of the
		// engine of no walk of its own at all: the sound stands detected, and the places of it stand refused.
		const data = lotSound({
			sampleCount: 2,
			places: new Array(0x200).fill(1),
		});
		data.writeInt32LE(-1, FIRST_SECTION_END + 0x18);
		const source = new BufferByteSource(data);
		expect(await entisMioAudioFormat.detect(source, "sound.mio")).toBe(true);
		const archive = await entisMioAudioFormat.open(source, "sound.mio");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			const failure = await archive.openEntry(entry.id).then(
				() => undefined,
				(error: unknown) => error,
			);
			expect(failure).toBeInstanceOf(GarbroError);
			expect(failure).toMatchObject({ code: "UNSUPPORTED_FEATURE" });
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
