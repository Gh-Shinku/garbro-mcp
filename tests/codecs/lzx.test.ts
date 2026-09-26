// LZX, the compression of the folders of a cabinet, against streams built in the test by the writer of
// `tests/helpers/lzx.ts`. The streams the reader was checked against beyond those are the two real cabinets
// of Windows recorded in `docs/formats/microsoft-cab-archive.md`.
import { describe, expect, it } from "vitest";
import {
	decompressLzx,
	lzxPositionSlots,
} from "../../packages/codecs/src/lzx.js";
import {
	LZX_TEST_FRAME,
	literalStream,
	uncompressedStream,
} from "../helpers/lzx.js";
import { BitWriter } from "../helpers/lzx.js";

describe("LZX", () => {
	it("walks a verbatim block of literals", () => {
		const text = "ABCDABCDABCD";
		const result = decompressLzx(literalStream(text), text.length, 15);
		expect(result.output.toString("latin1")).toBe(text);
	});

	it("walks an uncompressed block and the places behind it", () => {
		const text = Buffer.from(
			"the bytes as they stand, of an odd length!",
			"latin1",
		);
		const result = decompressLzx(uncompressedStream(text), text.length, 15);
		expect(result.output.equals(text)).toBe(true);
	});

	it("walks the frames of a stream that stands of more than one", () => {
		const text = "ABCD".repeat(9000).slice(0, LZX_TEST_FRAME + 35);
		const result = decompressLzx(literalStream(text), text.length, 15);
		expect(result.output.toString("latin1")).toBe(text);
	});

	it("rewrites the places behind the calls of a frame the stream names a length for", () => {
		const text = Buffer.alloc(64, 0x41);
		text.writeUInt32LE(0x00000020, 8);
		text[7] = 0xe8;
		const result = decompressLzx(
			uncompressedStream(text, 4096),
			text.length,
			15,
		);
		const expected = Buffer.from(text);
		expected.writeInt32LE(0x20 - 7, 8);
		expect(result.output.equals(expected)).toBe(true);
		expect(result.intelFilesize).toBe(4096);
	});

	it("turns away a stream that stands of a block of a kind it does not know", () => {
		const writer = new BitWriter();
		writer.bits(0, 1);
		writer.bits(6, 3);
		writer.bits(0, 24);
		const stream = writer.toBuffer();
		expect(() => decompressLzx(stream, 32, 15)).toThrow();
	});

	it("names the places of a window of every size the format allows", () => {
		expect(lzxPositionSlots(15)).toBe(30);
		expect(lzxPositionSlots(21)).toBe(50);
		expect(() => lzxPositionSlots(14)).toThrow();
	});
});
