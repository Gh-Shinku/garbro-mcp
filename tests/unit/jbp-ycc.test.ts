import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	clampJbpColour,
	standJbpColours,
} from "../../packages/codecs/src/jbp-ycc.js";

describe("Purple places of the colours of a picture", () => {
	it("stands the places of a colour of a picture behind the places of the colour of the file", () => {
		expect(clampJbpColour(0x180)).toBe(0x80);
		expect(clampJbpColour(0)).toBe(0);
		expect(clampJbpColour(0xff)).toBe(0);
		expect(clampJbpColour(0x100)).toBe(0);
		expect(clampJbpColour(0x1ff)).toBe(0xff);
		expect(clampJbpColour(0x200)).toBe(0xff);
		expect(clampJbpColour(0xffff)).toBe(0xff);
	});

	it("stands the places of the picture itself as the places of the colours of the picture", () => {
		const output: Buffer = Buffer.alloc(64 * 16, 0x00);
		const places = new Int16Array(64);
		standJbpColours({
			output,
			stride: 64,
			dc: 0,
			ac: 64,
			y: places,
			cb: places,
			cr: places,
			cbcrSrc: 0,
		});
		for (let at = 0; at < 4 * 4; at += 1) {
			const x = at % 4;
			const y = Math.floor(at / 4);
			const from = y * 128 + x * 8;
			expect(output[from]).toBe(0x80);
			expect(output[from + 1]).toBe(0x80);
			expect(output[from + 2]).toBe(0x80);
			expect(output[from + 3]).toBe(0);
			expect(output[from + 4]).toBe(0x80);
		}
	});

	it("stands the places of the picture as the places of the colours the walk of its places names", () => {
		const output: Buffer = Buffer.alloc(64 * 16, 0x00);
		const y = new Int16Array(64);
		const cb = new Int16Array(64).fill(4);
		const cr = new Int16Array(64).fill(4);
		standJbpColours({
			output,
			stride: 64,
			dc: 0,
			ac: 64,
			y,
			cb,
			cr,
			cbcrSrc: 0,
		});
		expect(Math.imul(4, 0x1c590) >> 16).toBe(7);
		expect((Math.imul(4, 0x5810) >> 16) + (Math.imul(4, 0xb6c0) >> 16)).toBe(3);
		expect(Math.imul(4, 0x166f0) >> 16).toBe(5);
		expect(output[0]).toBe(0x180 + 7 - 0x100);
		expect(output[1]).toBe(0x180 - 3 - 0x100);
		expect(output[2]).toBe(0x180 + 5 - 0x100);
		expect(output[4]).toBe(output[0]);
		expect(output[64]).toBe(output[0]);
	});
});
