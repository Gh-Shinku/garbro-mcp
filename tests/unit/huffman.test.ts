import { decompressHuffman } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

/** Packs bits most-significant-first, matching GARbro's `MsbBitStream`. */
function packBits(bits: readonly number[]): Buffer {
	const output = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		if (bit === 0) continue;
		const byte = Math.floor(index / 8);
		output[byte] = (output[byte] ?? 0) | (1 << (7 - (index % 8)));
	}
	return output;
}

function leaf(value: number): number[] {
	return [0, ...value.toString(2).padStart(8, "0").split("").map(Number)];
}

describe("Huffman codec", () => {
	it("decodes two leaves behind an internal root", () => {
		// Root is internal, its left child is 'A' and its right child is 'B'; the data reads 0 then 1.
		const stream = packBits([1, ...leaf(0x41), ...leaf(0x42), 0, 1]);
		expect(decompressHuffman(stream, 2).toString("latin1")).toBe("AB");
	});

	it("emits a leaf root without consuming data bits", () => {
		// A single leaf as the root: GARbro writes it out without reading anything further.
		const stream = packBits(leaf(0x5a));
		expect(decompressHuffman(stream, 3).toString("latin1")).toBe("ZZZ");
	});

	it("keeps decoding the zero padding of the final byte", () => {
		// One explicit bit selects the 'A' leaf; the four padding bits of the last byte follow it as
		// zeroes, and GARbro reads those too because only a real end of stream stops it.
		const stream = packBits([1, ...leaf(0x41), ...leaf(0x42), 0]);
		expect(decompressHuffman(stream, 16).toString("latin1")).toBe("AAAAA");
	});

	it("rejects a tree that runs past the fixed size", () => {
		// Every set bit creates an internal node, and GARbro allows only 256 of them.
		const stream = packBits(new Array(300).fill(1));
		expect(() => decompressHuffman(stream, 1)).toThrow(RangeError);
	});

	it("rejects a tree that ends mid-descent", () => {
		expect(() => decompressHuffman(Buffer.from([0x80]), 1)).toThrow(RangeError);
	});
});
