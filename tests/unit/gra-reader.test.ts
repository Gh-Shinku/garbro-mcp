import {
	GraBaseReader,
	GraEndOfStream,
	horizontalGeometry,
	type GraGeometry,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

/** Packs an MSB-first bit string into bytes, which is the order the reader consumes them. */
function bits(spec: string): Uint8Array {
	const bytes = new Uint8Array(Math.ceil(spec.length / 8));
	for (let i = 0; i < spec.length; i += 1) {
		if ((spec[i] ?? "") !== "1") continue;
		const index = i >> 3;
		bytes[index] = (bytes[index] ?? 0) | (0x80 >> (i & 7));
	}
	return bytes;
}

/** Exposes the protected members so the decoder's pieces can be checked in isolation. */
class Probe extends GraBaseReader {
	constructor(input: Uint8Array, offset: number, geometry: GraGeometry) {
		super(input, offset, geometry);
		this.initFrame();
	}

	frameEntry(index: number): number {
		return this.frameAt(index);
	}

	pixel(pos: number): number {
		return this.readPixel(pos);
	}

	pairBuffer(index: number): number {
		return this.pairAt(index);
	}

	setPairBuffer(index: number, value: number): void {
		this.setPair(index, value);
	}

	copy(src: number, dst: number, count: number): void {
		this.movePixels(src, dst, count);
	}

	flush(): boolean {
		return this.flushBuffer();
	}

	run(): Uint8Array {
		return this.unpackBits();
	}

	readPairForTest(): number {
		return this.readPair(0);
	}

	firstBitForTest(): number {
		return this.getNextBitForTest();
	}
}

const GEOMETRY = horizontalGeometry(16, 4);

function probe(spec: string, geometry = GEOMETRY): Probe {
	return new Probe(bits(spec), 0, geometry);
}

describe("system98 gra reader", () => {
	it("builds the descending nibble frame", () => {
		const reader = probe("");
		expect(reader.frameEntry(0)).toBe(0x00);
		expect(reader.frameEntry(1)).toBe(0xf0);
		expect(reader.frameEntry(15)).toBe(0x10);
		// The next run starts sixteen higher, and repeats the descent from there.
		expect(reader.frameEntry(16)).toBe(0x10);
		expect(reader.frameEntry(17)).toBe(0x00);
		expect(reader.frameEntry(31)).toBe(0x20);
		// The run that starts the third band begins with the value the previous band ended on, because the
		// increment after each band cancels the decrement that closed it.
		expect(reader.frameEntry(32)).toBe(0x20);
	});

	it("reads a static frame entry for the 1 0 control bits", () => {
		const reader = probe("10");
		// The first entry of the frame is zero before anything is moved.
		expect(reader.pixel(0)).toBe(0x00);
	});

	it("swaps the two entries for the 1 1 control bits", () => {
		const reader = probe("11");
		expect(reader.pixel(0)).toBe(0xf0);
		// The entry that was read moves down, so a repeat of the same control bits reads zero.
		expect(reader.frameEntry(0)).toBe(0xf0);
		expect(reader.frameEntry(1)).toBe(0x00);
	});

	it("shifts a run down for the 0 control bits", () => {
		// Zero control bits take the shortest shift: two extra bits of length, so `count` is 2.
		const reader = probe("00000");
		expect(reader.pixel(0)).toBe(0xe0);
		// The two entries above the read position move down and the read byte lands below them.
		expect(reader.frameEntry(0)).toBe(0xe0);
		expect(reader.frameEntry(1)).toBe(0x00);
		expect(reader.frameEntry(2)).toBe(0xf0);
	});

	it("derives the high nibble position from the low byte it just read", () => {
		// The low byte decodes to `0xF0`, which is then used as the position for the high nibble, so the
		// pair is not two independent reads of the same position.
		const reader = probe("1010");
		const pair = reader.readPairForTest();
		expect(pair & 0xff).toBe(0x00);
		expect(pair >> 8).toBe(reader.frameEntry(0));
	});

	it("decodes an all zero stream deterministically", () => {
		// An all zero stream is not a solid image: the opening pair resolves to `0xC0E0` (packed as
		// `0xEC`) and fills the first ring row, then the repeat branch reads further pairs whose positions
		// come from the bytes it just decoded, so the frame strip keeps adapting as it goes. The second
		// pair is `0x80A0` from frame positions `0xC2` and `0xA2`, packed as `0xA8`. The trailing zeros are
		// needed because the stream has to last until the image is complete.
		const reader = probe("0".repeat(0x200));
		const pixels = reader.run();
		expect(pixels.length).toBe(8 * 4);
		expect([...pixels].slice(0, 8)).toEqual([
			0xec, 0xa8, 0xec, 0xb9, 0xec, 0xca, 0xec, 0xba,
		]);
	});

	it("leaves a truncated stream as a partial image", () => {
		// No data at all: the very first pair read hits the end of the stream, which flushes what has been
		// decoded instead of failing.
		const reader = new Probe(new Uint8Array(0), 0, GEOMETRY);
		const pixels = reader.run();
		expect(pixels.length).toBe(8 * 4);
		// The flush emits the zeroed ring buffer, so the first row is written and the rest stays zero.
		expect(pixels[0]).toBe(0x00);
		expect(pixels[8]).toBe(0x00);
	});

	it("reports the end of the stream rather than reading zero bits", () => {
		const reader = new Probe(new Uint8Array(0), 0, GEOMETRY);
		expect(() => reader.firstBitForTest()).toThrow(GraEndOfStream);
	});

	it("copies overlapping ranges forward in chunks", () => {
		const reader = probe("");
		for (let i = 0; i < 4; i += 1) reader.setPairBuffer(i, 0x1000 + i);
		// Two elements from byte zero to byte two: the source runs into the destination, so the copy has
		// to proceed in chunks of the two byte distance and repeats the pattern.
		reader.copy(0, 2, 2);
		expect(reader.pairBuffer(0)).toBe(0x1000);
		expect(reader.pairBuffer(1)).toBe(0x1000);
		expect(reader.pairBuffer(2)).toBe(0x1000);
		expect(reader.pairBuffer(3)).toBe(0x1003);
	});
});
