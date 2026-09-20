import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	decodeTlg6GolombValues,
	TLG6_GOLOMB_BIT_LENGTH_TABLE,
	TLG6_LEADING_ZERO_TABLE,
} from "../../packages/codecs/src/tlg6-golomb.js";

const GOLOMB_N_COUNT = 4;

describe("TLG6 Golomb values", () => {
	it("stands the places of the picture of the walk of the places of the picture of the place of the picture of the walk of them of the places of the picture of the walk of them", () => {
		expect(TLG6_LEADING_ZERO_TABLE[0]).toBe(0);
		expect(TLG6_LEADING_ZERO_TABLE[1]).toBe(1);
		expect(TLG6_LEADING_ZERO_TABLE[2]).toBe(2);
		expect(TLG6_LEADING_ZERO_TABLE[3]).toBe(1);
		expect(TLG6_LEADING_ZERO_TABLE[4]).toBe(3);
		expect(TLG6_LEADING_ZERO_TABLE[0x800]).toBe(12);
		expect(TLG6_LEADING_ZERO_TABLE[0xfff]).toBe(1);
		expect(TLG6_LEADING_ZERO_TABLE.length).toBe(4096);
	});

	it("stands the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the picture of the walk of them", () => {
		const table = TLG6_GOLOMB_BIT_LENGTH_TABLE;
		expect(table.length).toBe(1024 * GOLOMB_N_COUNT);
		expect(table[0 * GOLOMB_N_COUNT + 0]).toBe(0);
		expect(table[2 * GOLOMB_N_COUNT + 0]).toBe(0);
		expect(table[3 * GOLOMB_N_COUNT + 0]).toBe(1);
		expect(table[9 * GOLOMB_N_COUNT + 0]).toBe(1);
		expect(table[10 * GOLOMB_N_COUNT + 0]).toBe(2);
		expect(table[24 * GOLOMB_N_COUNT + 0]).toBe(2);
		expect(table[25 * GOLOMB_N_COUNT + 0]).toBe(3);
		expect(table[0 * GOLOMB_N_COUNT + 3]).toBe(0);
		expect(table[1 * GOLOMB_N_COUNT + 3]).toBe(0);
		expect(table[2 * GOLOMB_N_COUNT + 3]).toBe(1);
		expect(table[4 * GOLOMB_N_COUNT + 3]).toBe(1);
		expect(table[5 * GOLOMB_N_COUNT + 3]).toBe(2);
	});

	it("reads the places of the picture of the walk of the places of the picture of the runs of the places of the picture of no places of their own", () => {
		const one = new Uint32Array(1).fill(0xffffffff);
		decodeTlg6GolombValues(one, 0, 1, Buffer.from([0x02]), true);
		expect(Array.from(one)).toEqual([0]);
		const many = new Uint32Array(3).fill(0xffffffff);
		decodeTlg6GolombValues(many, 0, 3, Buffer.from([0x0c]), true);
		expect(Array.from(many)).toEqual([0, 0, 0]);
	});

	it("reads the places of the picture of the walk of the places of the picture of the places of the picture of the walk of them", () => {
		const one = new Uint32Array(1);
		decodeTlg6GolombValues(one, 0, 1, Buffer.from([0x07]), true);
		expect(Array.from(one)).toEqual([0xff]);
		const two = new Uint32Array(2);
		decodeTlg6GolombValues(two, 0, 2, Buffer.from([0x55]), true);
		expect(Array.from(two)).toEqual([0xff, 0x01]);
	});

	it("stands the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture with the places of the picture of the walk of the places of the picture of their own beside them", () => {
		const pixels = new Uint32Array([0x12345678]);
		decodeTlg6GolombValues(pixels, 0, 1, Buffer.from([0x07]), false);
		expect(Array.from(pixels)).toEqual([0x123456ff]);
		const green = new Uint32Array([0x12345678]);
		decodeTlg6GolombValues(green, 8, 1, Buffer.from([0x07]), false);
		expect(Array.from(green)).toEqual([0x1234ff78]);
		const none = new Uint32Array([0x12345678]);
		decodeTlg6GolombValues(none, 0, 1, Buffer.from([0x02]), false);
		expect(Array.from(none)).toEqual([0x12345600]);
	});

	it("turns the places of the picture of the walk of the places of the picture of the words of the walk of the picture away where they stand past the places of the picture of the walk of the places of the picture", () => {
		expect(() =>
			decodeTlg6GolombValues(
				new Uint32Array(4),
				0,
				4,
				Buffer.from([0x01]),
				true,
			),
		).toThrow(RangeError);
	});
});
