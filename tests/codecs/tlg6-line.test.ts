import { describe, expect, it } from "vitest";
import {
	applyTlg6Filter,
	applyTlg6Line,
	tlg6MakeGtMask,
	tlg6Med2,
	tlg6PackedBytesAdd,
	TLG6_LINE_FILTERS,
} from "../../packages/codecs/src/tlg6-line.js";

describe("TLG6 line decoding", () => {
	it("stands the places of the picture of the walk of the places of the picture of the place of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the sound", () => {
		expect(TLG6_LINE_FILTERS.length).toBe(32);
		expect(TLG6_LINE_FILTERS[0]).toEqual([
			false,
			[1, 0, 0],
			[0, 1, 0],
			[0, 0, 1],
		]);
		expect(TLG6_LINE_FILTERS[1]?.[0]).toBe(true);
		for (let i = 1; i < 32; i += 2)
			expect(TLG6_LINE_FILTERS[i]?.[0]).toBe(true);
		for (let i = 0; i < 32; i += 2)
			expect(TLG6_LINE_FILTERS[i]?.[0]).toBe(false);
	});

	it("stands the places of the picture of the walk of the places of the picture of the place of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the sound", () => {
		expect(tlg6MakeGtMask(0x00000200, 0x00000100)).toBe(0x0000ff00);
		expect(tlg6MakeGtMask(0x00000100, 0x00000200)).toBe(0);
		expect(tlg6MakeGtMask(0x00000100, 0x00000100)).toBe(0);
		expect(tlg6MakeGtMask(0x00000300, 0x00000200)).toBe(0x0000ff00);
	});

	it("stands the places of the picture of the walk of the places of the picture of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the sound", () => {
		expect(tlg6PackedBytesAdd(0x01020304, 0x01020304)).toBe(0x02040608);
		expect(tlg6PackedBytesAdd(0x000000ff, 0x00000001)).toBe(0);
		expect(tlg6PackedBytesAdd(0x0000ff00, 0x00000100)).toBe(0);
		expect(tlg6PackedBytesAdd(0x00ffffff, 0x00000001)).toBe(0x00ffff00);
	});

	it("stands the places of the picture of the walk of the places of the picture of the middle of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of their own", () => {
		expect(tlg6Med2(0x10, 0x20, 0x21)).toBe(0x10);
		expect(tlg6Med2(0x10, 0x20, 0x30)).toBe(0x10);
		expect(tlg6Med2(0x10, 0x20, 0x05)).toBe(0x20);
		expect(tlg6Med2(0x11, 0x20, 0x10)).toBe(0x20);
		expect(tlg6Med2(0, 0x10, 0)).toBe(0x10);
	});

	it("stands the places of the picture of the walk of the places of the picture of the line of the places of the picture of the sixth kind of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of their own", () => {
		expect(applyTlg6Filter(0, 0, 0, 0, 0x00010203)).toBe(0x00010203);
		expect(applyTlg6Filter(2, 0, 0, 0, 0x00010203)).toBe(0x00030205);
		expect(applyTlg6Filter(3, 0, 0, 0, 0x00010203)).toBe(0x00030205);
	});

	it("stands the places of the picture of the walk of the places of the picture of the line of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of their own", () => {
		const prevLine = new Uint32Array([0x00000010, 0x00000020]);
		const curLine = new Uint32Array(2);
		applyTlg6Line(
			prevLine,
			0,
			curLine,
			0,
			2,
			0,
			1,
			Uint8Array.from([0]),
			0,
			0,
			Uint32Array.from([0x00000001, 0x00000002]),
			0,
			0,
			0,
			1,
		);
		expect(Array.from(curLine)).toEqual([0x11, 0x22]);
		const backwards = new Uint32Array(2);
		applyTlg6Line(
			prevLine,
			0,
			backwards,
			0,
			2,
			0,
			1,
			Uint8Array.from([0]),
			0,
			0,
			Uint32Array.from([0x00000001, 0x00000002]),
			0,
			0,
			0,
			0,
		);
		expect(Array.from(backwards)).toEqual([0x12, 0x21]);
	});
});
