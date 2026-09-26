// The LZ4 walk of the format, against blocks and frames built in the test: the places of a run of a block
// and the places of a match of it (a place of a count of no end behind the count of the format, of the
// places of the match itself), and the head of a frame and the blocks of it. The places of a match of a
// block standing over the places of it stand of the two of them over each other, so a match of a count of
// the places of the period of the picture stands of that period every place of it.
import { Buffer } from "node:buffer";
import { GarbroError } from "@garbro-mcp/core";
import {
	decompressLz4Block,
	decompressLz4Frame,
	readLz4BlockSize,
	readLz4FrameHead,
} from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

const BLOCK_SIZE = 0x10000;

/** The places of a period of a picture, of the count a test asks for. */
function period(places: readonly number[], count: number): number[] {
	const out: number[] = [];
	for (let at = 0; at < count; at += 1) {
		out.push(places[at % places.length] ?? 0);
	}
	return out;
}

/** A frame of the format: the head of it and the blocks of it. */
function lz4Frame(blocks: Buffer[], flags = 0x60): Buffer {
	const head = Buffer.alloc(7, 0x00);
	head.writeUInt32LE(0x184d2204, 0);
	head[4] = flags;
	// The counts of a block of the head of the frame: the code of sixty four thousand places a block.
	head[5] = 0x40;
	// The place of the walk of the head, which the walk of the port stands over.
	head[6] = 0x00;
	const body: Buffer[] = [];
	for (const block of blocks) {
		const size = Buffer.alloc(4, 0x00);
		size.writeInt32LE(block.length, 0);
		body.push(size, block);
	}
	body.push(Buffer.alloc(4, 0x00));
	return Buffer.concat([head, ...body]);
}

describe("LZ4", () => {
	it("reads the places of a block of the format", () => {
		// A block of the places of a run alone: the count of them of the head of the token, and the places
		// behind it.
		const literals = Buffer.concat([
			Buffer.from([0x40]),
			Buffer.from("ABCD", "latin1"),
		]);
		expect([...decompressLz4Block(literals, 4)]).toEqual([
			0x41, 0x42, 0x43, 0x44,
		]);
		// A block of a run of four places and a match of five hundred and twenty nine of them, of the count
		// of the match standing of three places of a count of no end behind the token of it, and of a run of
		// eight places behind them. The match stands over the places of the picture, of the two of them
		// standing over each other: the four places of the run stand of every place of the match of them.
		const matched = Buffer.concat([
			Buffer.from([0x4f]),
			Buffer.from("ABCD", "latin1"),
			Buffer.from([0x04, 0x00]),
			Buffer.from([0xff, 0xff, 0x00]),
			Buffer.from([0x80]),
			Buffer.from("IJKLMNOP", "latin1"),
		]);
		const places = decompressLz4Block(matched, BLOCK_SIZE);
		expect(places.length).toBe(4 + 529 + 8);
		expect([...places]).toEqual([
			...period([0x41, 0x42, 0x43, 0x44], 533),
			...Buffer.from("IJKLMNOP", "latin1"),
		]);
	});

	it("turns away a block that stands short of its places", () => {
		// A token of a run of places of no place behind it at all stands of no block of the format.
		expect(() => decompressLz4Block(Buffer.from([0x40]), BLOCK_SIZE)).toThrow(
			GarbroError,
		);
		// A place of a match standing outside the places of the picture of the block stands refused as well.
		expect(() =>
			decompressLz4Block(
				Buffer.concat([Buffer.from([0x40]), Buffer.from("ABCD", "latin1")]),
				2,
			),
		).toThrow(GarbroError);
	});

	it("reads the head of a frame and the blocks of it", () => {
		const head = lz4Frame([]);
		const info = readLz4FrameHead(head);
		expect(info).toMatchObject({
			blockSize: 0x10000,
			independentBlocks: true,
			hasBlockChecksum: false,
			hasContentLength: false,
			hasContentChecksum: false,
			hasDictionary: false,
		});
		expect(readLz4BlockSize(0x70)).toBe(0x400000);
		expect(readLz4BlockSize(0x30)).toBe(undefined);
		// A block standing as it stands stands of the places of the file of it and of no walk of the format:
		// the count of it stands of the highest place of the word of it set, of the count behind it.
		const stored = lz4Frame([Buffer.from("WXYZ", "latin1")]);
		stored.writeInt32LE(0x80000004 | 0, 7);
		expect([...decompressLz4Frame(stored)]).toEqual([0x57, 0x58, 0x59, 0x5a]);
		// And a block of the walk of the format stands of the places of its own walk.
		const walked = lz4Frame([
			Buffer.concat([Buffer.from([0x40]), Buffer.from("ABCD", "latin1")]),
		]);
		expect([...decompressLz4Frame(walked)]).toEqual([0x41, 0x42, 0x43, 0x44]);
	});

	it("stands of the kinds of a frame the reference stands of", () => {
		// The reference reads a frame of blocks standing apart and of no dictionary alone, and so does this
		// port: the two other kinds stand refused rather than guessed at.
		expect(() => decompressLz4Frame(lz4Frame([], 0x40))).toThrow(GarbroError);
		expect(() => decompressLz4Frame(lz4Frame([], 0x61))).toThrow(GarbroError);
		// A word of no frame of the format, of a kind of a frame of its own, stands refused as well.
		expect(() =>
			decompressLz4Frame(Buffer.concat([Buffer.alloc(7, 0x00)])),
		).toThrow(GarbroError);
		expect(() => decompressLz4Frame(lz4Frame([], 0x00))).toThrow(GarbroError);
		expect(() => decompressLz4Frame(lz4Frame([], 0xc0))).toThrow(GarbroError);
	});
});
