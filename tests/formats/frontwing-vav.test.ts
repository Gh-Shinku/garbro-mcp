import { BufferByteSource } from "@garbro-mcp/core";
import { vavFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const SIGNATURE = "vav";
const HEADER_SIZE = 0x10;
const FOOTER_SIZE = 0x18;
const WEIGHT_COUNT = 0x100;
const TREE_SIZE = 0x201;
const END_SYMBOL = 0x100;
const NO_WEIGHT = 0x10000;

interface Spec {
	name: string;
	plain: Buffer;
	compression: number;
}

function nameSize(version: number): number {
	return version < 200 ? 0x10 : 0x20;
}

/** The inverse of the difference chain, or of the plain key, which only touches one byte in old archives. */
function encryptBytes(
	plain: Buffer,
	stride: number,
	oldVersion: boolean,
): Buffer {
	const output = Buffer.from(plain);
	if (stride > 0) {
		for (let position = output.length - 1; position >= stride; position -= 1)
			output[position] =
				(plain[position] ?? 0) ^ (plain[position - stride] ?? 0);
		return output;
	}
	const length = oldVersion ? Math.min(1, output.length) : output.length;
	for (let position = 0; position < length; position += 1)
		output[position] = (plain[position] ?? 0) ^ 0x55;
	return output;
}

/** The rle encoder: runs of three or more bytes repeat, everything else becomes literals. */
function encodeRle(plain: Buffer): Buffer {
	const parts: number[] = [];
	let position = 0;
	while (position < plain.length) {
		let run = 1;
		while (
			position + run < plain.length &&
			plain[position + run] === plain[position] &&
			run < 0x7f
		)
			run += 1;
		if (run >= 3) {
			parts.push(0x80 | run, plain[position] ?? 0);
			position += run;
			continue;
		}
		let literal = position;
		while (literal < plain.length && literal - position < 0x7f) {
			const byte = plain[literal] ?? 0;
			if (
				literal + 2 < plain.length &&
				plain[literal + 1] === byte &&
				plain[literal + 2] === byte
			)
				break;
			literal += 1;
		}
		parts.push(literal - position, ...plain.subarray(position, literal));
		position = literal;
	}
	return Buffer.from(parts);
}

interface VavTree {
	left: Uint16Array;
	right: Uint16Array;
	root: number;
}

/** The reference's tree builder, which merges the two lightest nodes until a single one is left. */
function buildTree(weights: readonly number[]): VavTree {
	const weight = new Int32Array(TREE_SIZE);
	weights.forEach((value, index) => {
		weight[index] = value;
	});
	weight[END_SYMBOL] = 1;
	const left = new Uint16Array(TREE_SIZE);
	const right = new Uint16Array(TREE_SIZE);
	let root = END_SYMBOL;
	for (;;) {
		let lmin = NO_WEIGHT;
		let rmin = NO_WEIGHT;
		let lhs = TREE_SIZE;
		let rhs = TREE_SIZE;
		for (let index = 0; index < TREE_SIZE; index += 1) {
			const value = weight[index] ?? 0;
			if (value !== 0 && value < rmin) {
				rmin = lmin;
				rhs = lhs;
				lmin = value;
				lhs = index;
			}
		}
		if (rmin === NO_WEIGHT || lmin === NO_WEIGHT || lmin === 0 || rmin === 0)
			break;
		root += 1;
		left[root] = lhs;
		right[root] = rhs;
		weight[root] = rmin + lmin;
		weight[lhs] = 0;
		weight[rhs] = 0;
	}
	return { left, right, root };
}

function collectCodes(tree: VavTree): Map<number, number[]> {
	const codes = new Map<number, number[]>();
	const walk = (symbol: number, bits: number[]): void => {
		if (symbol <= END_SYMBOL) {
			codes.set(symbol, bits);
			return;
		}
		walk(tree.left[symbol] ?? 0, [...bits, 0]);
		walk(tree.right[symbol] ?? 0, [...bits, 1]);
	};
	walk(tree.root, []);
	return codes;
}

/** The huffman encoder: the weights are the byte frequencies, keyed with 0x55 like the reference reads them. */
function encodeHuffman(plain: Buffer): Buffer {
	const weights = new Array(WEIGHT_COUNT).fill(0);
	for (const byte of plain) weights[byte] += 1;
	const tree = buildTree(weights);
	const codes = collectCodes(tree);
	const bits: number[] = [];
	for (const byte of plain) bits.push(...(codes.get(byte) ?? []));
	bits.push(...(codes.get(END_SYMBOL) ?? []));
	const output = Buffer.alloc(WEIGHT_COUNT + Math.ceil(bits.length / 8));
	for (const [index, weight] of weights.entries())
		output[index] = (weight ^ 0x55) & 0xff;
	for (const [index, bit] of bits.entries()) {
		if (bit === 0) continue;
		const at = WEIGHT_COUNT + Math.floor(index / 8);
		output[at] = (output[at] ?? 0) | (0x80 >> (index % 8));
	}
	return output;
}

/** Lays out the header, the index and the payloads, applying the store side codecs in reverse order. */
function buildVav(specs: readonly Spec[], version: number): Buffer {
	const names = nameSize(version);
	const recordSize = names + FOOTER_SIZE;
	const indexSize = recordSize * specs.length;
	const dataOffset = HEADER_SIZE + indexSize;
	const payloads = specs.map((spec) => {
		let data = encryptBytes(spec.plain, spec.compression & 0x0f, version < 200);
		if ((spec.compression & 0x10) !== 0) data = encodeRle(data);
		if ((spec.compression & 0x80) !== 0) data = encodeHuffman(data);
		return data;
	});
	const index = Buffer.alloc(indexSize);
	let offset = dataOffset;
	for (const [id, spec] of specs.entries()) {
		const position = id * recordSize;
		index.write(spec.name, position, "latin1");
		const footer = position + names;
		index.writeUInt32LE(payloads[id]?.length ?? 0, footer);
		index.writeUInt32LE(spec.plain.length, footer + 4);
		index.writeUInt32LE(offset, footer + 8);
		index.writeInt32LE(spec.compression, footer + 0xc);
		offset += payloads[id]?.length ?? 0;
	}
	const header = Buffer.alloc(HEADER_SIZE);
	header.write(SIGNATURE, 0, "latin1");
	header.writeInt32LE(version, 4);
	header.writeInt32LE(specs.length, 8);
	header.writeUInt32LE(HEADER_SIZE, 0xc);
	return Buffer.concat([header, index, ...payloads]);
}

async function expectDeclined(
	file: Buffer,
	name = "sample.vav",
): Promise<void> {
	expect(await vavFormat.detect(new BufferByteSource(file), name)).toBe(false);
}

describe("FrontWing ADV System resource archive", () => {
	it("reads plain payloads of a new version", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		await expectArchive({
			format: vavFormat,
			sourcePath: "sample.vav",
			archive: buildVav(
				[
					{ name: "first.bin", plain: first, compression: 0 },
					{ name: "second.bin", plain: second, compression: 0 },
				],
				200,
			),
			entries: [
				{ path: "first.bin", size: first.length, content: first },
				{ path: "second.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2, version: 200 },
		});
	});

	it("keys only one byte of an old version without a stride", async () => {
		const plain = Buffer.from("old version payload");
		await expectArchive({
			format: vavFormat,
			sourcePath: "sample.vav",
			archive: buildVav([{ name: "old.bin", plain, compression: 0 }], 100),
			entries: [{ path: "old.bin", size: plain.length, content: plain }],
			metadata: { version: 100 },
		});
	});

	it("reverses a difference chain", async () => {
		const plain = Buffer.alloc(64);
		for (let index = 0; index < plain.length; index += 1)
			plain[index] = (index * 37) & 0xff;
		await expectArchive({
			format: vavFormat,
			sourcePath: "sample.vav",
			archive: buildVav([{ name: "chain.bin", plain, compression: 1 }], 201),
			entries: [{ path: "chain.bin", size: plain.length, content: plain }],
		});
	});

	it("unpacks a huffman payload", async () => {
		const plain = Buffer.from(
			"huffman payload with a few repeated letters aaaa",
		);
		await expectArchive({
			format: vavFormat,
			sourcePath: "sample.vav",
			archive: buildVav(
				[{ name: "packed.bin", plain, compression: 0x80 }],
				200,
			),
			entries: [{ path: "packed.bin", size: plain.length, content: plain }],
		});
	});

	it("unpacks an rle payload", async () => {
		const plain = Buffer.concat([
			Buffer.from("head"),
			Buffer.alloc(40, 0x41),
			Buffer.from("tail"),
		]);
		await expectArchive({
			format: vavFormat,
			sourcePath: "sample.vav",
			archive: buildVav([{ name: "run.bin", plain, compression: 0x10 }], 200),
			entries: [{ path: "run.bin", size: plain.length, content: plain }],
		});
	});

	it("unpacks huffman before rle", async () => {
		const plain = Buffer.concat([
			Buffer.from("compressed with both codecs "),
			Buffer.alloc(30, 0x42),
		]);
		await expectArchive({
			format: vavFormat,
			sourcePath: "sample.vav",
			archive: buildVav([{ name: "both.bin", plain, compression: 0x90 }], 200),
			entries: [{ path: "both.bin", size: plain.length, content: plain }],
		});
	});

	it("marks entries of a voice archive as audio", async () => {
		const plain = Buffer.from("voice payload");
		const file = buildVav([{ name: "voice.bin", plain, compression: 0 }], 200);
		const archive = await vavFormat.open(
			new BufferByteSource(file),
			"voice.vav",
		);
		expect(archive.entries[0]?.metadata?.type).toBe("audio");
		expect(archive.entries[0]?.encrypted).toBe(true);
	});

	it("rejects an unknown version", async () => {
		const file = buildVav(
			[{ name: "first.bin", plain: Buffer.from("x"), compression: 0 }],
			101,
		);
		await expectDeclined(file);
	});

	it("rejects an archive without entries", async () => {
		const file = buildVav(
			[{ name: "first.bin", plain: Buffer.from("x"), compression: 0 }],
			200,
		);
		file.writeInt32LE(0, 8);
		await expectDeclined(file);
	});

	it("rejects a foreign signature", async () => {
		const file = buildVav(
			[{ name: "first.bin", plain: Buffer.from("x"), compression: 0 }],
			200,
		);
		file.write("vaw", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildVav(
			[{ name: "first.bin", plain: Buffer.from("x"), compression: 0 }],
			200,
		);
		file.writeUInt32LE(file.length, HEADER_SIZE + nameSize(200));
		await expectDeclined(file);
	});
});
