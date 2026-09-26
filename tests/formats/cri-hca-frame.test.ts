// The walks of the counts of a frame of a sound of the Cri engine, against counts built in the test: the
// counts of the places of the sound of the engine (`HsaBitStream`), the counts of the places of a block of
// the walk of the engine (`CheckSum`) and the counts of the places of a picture of the engine of a sound of
// the engine (`Channel.Decode1`, `Decode2`, `Decode3` and `Decode4`).
import { Buffer } from "node:buffer";
import { HcaBitStream, HcaChannel, checkHcaBlock } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

/** The counts of the walk of the engine, of the counts of the places of the picture of the engine. */
function bits(stream: string): Buffer {
	const padded = stream.padEnd(Math.ceil(stream.length / 8) * 8, "0");
	const out = Buffer.alloc(padded.length / 8);
	for (let at = 0; at < padded.length; at += 1) {
		if ("1" === padded[at])
			out[at >> 3] = (out[at >> 3] ?? 0) | (0x80 >> (at & 7));
	}
	return out;
}

/** The counts of the walk of the engine of the places of a sound of the engine of no places at all. */
function sound(stream: string): HcaBitStream {
	return new HcaBitStream(bits(stream));
}

describe("Cri engine sound frame", () => {
	it("stands of the counts of the places of the sound of the engine", () => {
		const reader = sound("1011001001011101");
		// The counts of the walk of the engine stand of the places of the sound of the engine of the last
		// counts of the walk of the engine that stand in front of them.
		expect(reader.getBits(3)).toBe(0b101);
		expect(reader.getBits(5)).toBe(0b10010);
		expect(reader.peek(4)).toBe(0b0101);
		expect(reader.getBits(4)).toBe(0b0101);
		expect(reader.getBits(4)).toBe(0b1101);
		// The walk of the engine of the counts of the places of the picture of the engine stands of the
		// counts of the walk of the engine itself, of the places of the sound of the engine that stand behind
		// the counts of the walk of the engine.
		reader.seek(-4);
		expect(reader.getBits(4)).toBe(0b1101);
		// A walk of the engine behind the end of the sound of the engine stands of no count at all.
		expect(reader.peek(1)).toBe(-1);
		expect(reader.getBits(1)).toBe(-1);
		const wide = sound("111111110000000010101010");
		expect(wide.getBits(8)).toBe(0xff);
		wide.seek(4);
		expect(wide.getBits(4)).toBe(0);
		// The counts of the places of the sound of the engine stand of the counts of the walk of the engine of
		// the counts of the places of the picture of the engine that stand in front of them: a count of the
		// places of the picture of the engine of no counts at all at the walk of the engine stands of the
		// counts of the places of the sound of the engine that stand behind it.
		expect(wide.getBits(8)).toBe(0xaa);
		// A walk of the engine behind the places of the sound of the engine stands at the places of the sound
		// of the engine that stand in front of it.
		wide.seek(-0x1000);
		expect(wide.getBits(8)).toBe(0xff);
	});

	it("stands of the counts of the places of a block of the walk of the engine", () => {
		// The walk of the engine stands of the counts of the places of the block of the sound of the engine
		// of the counts of the places of the counts of the walk of the engine of the table of them.
		expect(checkHcaBlock(Buffer.from([1]))).toBe(0x8005);
		expect(checkHcaBlock(Buffer.from([1, 2]))).toBe(0x060c);
		expect(checkHcaBlock(Buffer.from([]))).toBe(0);
		// A block of a sound of the engine stands of the last two counts of the block, which stand of the
		// counts of the walk of the engine of the places of the block itself: the walk of the engine of the
		// block of those counts stands of no counts of the places of the picture of the engine at all.
		const block = Buffer.from([0x12, 0x34, 0, 0]);
		let zeroing = -1;
		for (let place = 0; place <= 0xffff && zeroing < 0; place += 1) {
			block[2] = place >> 8;
			block[3] = place & 0xff;
			if (0 === checkHcaBlock(block)) zeroing = place;
		}
		expect(zeroing).toBeGreaterThanOrEqual(0);
	});

	it("stands of the counts of the places of a picture of the engine of a sound of the engine", () => {
		// The counts of the places of the picture of the engine of a count of the walk of the engine that
		// stand of no count at all stand of no counts of the places of the picture of the engine at all.
		const zero = new HcaChannel(0, 1, 1);
		zero.decode1(sound("000"), 0, 0, new Uint8Array(0x80));
		expect([...zero.value.subarray(0, 2)]).toEqual([0, 0]);
		expect([...zero.scale.subarray(0, 2)]).toEqual([0, 0]);
		expect([...zero.base.subarray(0, 2)]).toEqual([0, 0]);
		// The counts of the places of the picture of the engine of the counts of the walk of the engine that
		// stand of the counts of the places of the walk of the engine of the engine itself stand of the counts
		// of the places of the picture of the engine of the counts of the walk of the engine of the places of
		// the picture of the engine that stand behind them.
		const fixed = new HcaChannel(0, 1, 1);
		fixed.decode1(sound("110000001000001"), 0, 0, new Uint8Array(0x80));
		expect([...fixed.value.subarray(0, 2)]).toEqual([1, 1]);
		// Every count of one place of the counts of the walk of the engine stands of the counts of the places
		// of the picture of the engine behind the counts of the places of the counts of the walk of the engine
		// itself, which stand of the counts of the places of the picture of the engine of the last places of
		// the counts of the walk of the engine.
		expect([...fixed.scale.subarray(0, 2)]).toEqual([15, 15]);
		expect(fixed.base[0]).toBeCloseTo(
			Math.fround(2.116414e-7) * Math.fround(2 / 4095),
			12,
		);
		// The counts of the places of the counts of the walk of the engine of the table of the places of the
		// sound of the engine stand of the counts of the places of the picture of the engine of the counts of
		// the walk of the engine of the places of the counts of the walk of the engine of the counts of the
		// places of the picture of the engine themselves.
		const scaled = new HcaChannel(0, 1, 1);
		const ath = new Uint8Array(0x80);
		ath[0] = 40;
		ath[1] = 40;
		scaled.decode1(sound("110000001000001"), 0, 0, ath);
		expect([...scaled.scale.subarray(0, 2)]).toEqual([0x08, 0x08]);
		expect(scaled.base[0]).toBeCloseTo(
			Math.fround(2.116414e-7) * Math.fround(2 / 31),
			12,
		);
		// The counts of the places of the picture of the engine of the kind of the counts of the walk of the
		// engine of the counts of two places of the places of the picture stand of the counts of the walk of
		// the engine of the counts of four places of the places of the counts of the walk of the engine.
		const wide = new HcaChannel(2, 2, 1);
		wide.decode1(
			sound("00000000000000000000000000000000000"),
			0,
			0,
			new Uint8Array(0x80),
		);
		expect([...wide.value2]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
		const narrow = new HcaChannel(2, 1, 1);
		narrow.decode1(
			sound("00000010000000100000001000000010000"),
			0,
			0,
			new Uint8Array(0x80),
		);
		expect([...narrow.value2]).toEqual([1, 0, 1, 0, 1, 0, 1, 0]);
		// The counts of the places of the picture of the engine of the count of the walk of the engine of the
		// counts of four places of the counts of the walk of the engine stand of the counts of the places of
		// the picture of the engine of the counts of the walk of the engine that stand in front of them alone.
		const locked = new HcaChannel(2, 1, 1);
		locked.value2[1] = 7;
		locked.decode1(sound("0001111"), 0, 0, new Uint8Array(0x80));
		expect([...locked.value2]).toEqual([15, 7, 0, 0, 0, 0, 0, 0]);
	});

	it("stands of the counts of the places of a picture of the engine of a count of the walk of the engine", () => {
		// A count of the walk of the engine of no counts of the places of the picture of the engine at all
		// stands of no counts of the places of the picture of the engine at all.
		const zero = new HcaChannel(0, 2, 1);
		zero.decode1(sound("000"), 0, 0, new Uint8Array(0x80));
		zero.decode2(sound(""));
		expect([...zero.block.subarray(0, 3)]).toEqual([0, 0, 0]);
		// The counts of the places of the counts of the walk of the engine of the counts of the places of the
		// picture of the engine of the walks of the engine stand of the counts of the walk of the engine of
		// the counts of the places of the picture of the engine of the counts of the walk of the engine of
		// the counts of the places of the picture of the engine that stand behind them.
		const scaled = new HcaChannel(0, 1, 0);
		scaled.value[0] = 1;
		scaled.scale[0] = 9;
		scaled.base[0] = 4;
		scaled.decode2(sound("000011"));
		// The counts of the places of the walk of the engine of the counts of the places of the picture of
		// the engine stand of the counts of the walk of the engine of the counts of the places of the count
		// of the walk of the engine that stand in front of them: the counts of three places of the counts of
		// the walk of the engine stand of the counts of the places of the picture of the engine of the count
		// of one place of the counts of the walk of the engine of the counts of them.
		expect(scaled.block[0]).toBe(-4);
		const even = new HcaChannel(0, 1, 0);
		even.value[0] = 1;
		even.scale[0] = 9;
		even.base[0] = 4;
		even.decode2(sound("000001"));
		// The counts of the places of the picture of the engine of no count of the walk of the engine at all
		// stand of the counts of the places of the picture of the engine of no count at all of every sign.
		expect((even.block[0] ?? 1) + 0).toBe(0);
	});

	it("stands of the counts of the places of a picture of the engine of the counts of them", () => {
		// The counts of the places of the picture of the engine of a count of the walk of the engine of the
		// counts of the places of the picture of the engine itself stand of no counts of the places of the
		// picture of the engine of the counts of the walk of the engine at all.
		const channel = new HcaChannel(0, 1, 1);
		channel.block[0] = 1;
		channel.block[1] = 2;
		channel.decode3(1, 1, 1, 2);
		// The counts of the places of the picture of the engine of the counts of the walk of the engine stand
		// of the counts of the places of the picture of the engine of the count of the walk of the engine that
		// stands in front of them, of the counts of the walk of the engine of the counts of them of no count
		// of the places of the picture of the engine at all.
		expect(channel.block[1]).toBe(1);
		// The counts of the places of the picture of the engine of the counts of the walk of the engine of
		// the counts of the places of the picture of the engine itself stand of no counts of the places of
		// the picture of the engine of the last count of the walk of the engine.
		expect(channel.block[0x7f]).toBe(0);
		// The reference stands of the counts of the places of the picture of the engine of no counts of the
		// walk of the engine behind the counts of the walk of the engine itself: this port stands of the
		// counts of the places of the picture of the engine of such a count as no picture at all.
		const bad = new HcaChannel(0, 1, 1);
		bad.value[bad.valuePtr] = 0;
		bad.value[0] = 1;
		expect(() => bad.decode3(1, 1, 1, 2)).toThrowError();
	});

	it("stands of the counts of the places of a picture of the engine of a count of the walk of the engine behind it", () => {
		// The counts of the places of the picture of the engine of the kind of one count of the walk of the
		// engine stand of the counts of the places of the picture of the engine of the count of the walk of
		// the engine that stands behind it, of the counts of the places of the counts of the walk of the
		// engine of the count of the walk of the engine itself.
		const next = new HcaChannel(0, 2, 0);
		next.block[0] = 3;
		const channel = new HcaChannel(1, 2, 0);
		channel.block[0] = 4;
		channel.value2[0] = 0;
		channel.decode4(0, 1, 0, 1, next);
		// The counts of the places of the picture of the engine of the count of the walk of the engine that
		// stands behind it stand of the counts of the places of the picture of the engine of the count of the
		// walk of the engine that stands in front of it of the counts of the walk of the engine of the counts
		// of the places of the picture of the engine of no count at all, which stand of the counts of the
		// walk of the engine of the counts of the places of the picture of the engine of the count of the
		// walk of the engine itself.
		expect(next.block[0]).toBe(0);
		expect(channel.block[0]).toBe(8);
	});
});
