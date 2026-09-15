import { describe, expect, it } from "vitest";
import { copyOverlapped } from "../../packages/formats/src/shared/copy.js";

describe("overlapped copy", () => {
	it("repeats what it has already written", () => {
		// Copying a run that starts three bytes back repeats those bytes for as long as the run goes on.
		const data = Buffer.from("abcdef....");
		expect(copyOverlapped(data, 3, 6, 4)).toBe(true);
		expect(data.toString("latin1")).toBe("abcdefdefd");
	});

	it("moves a run that stands before its destination", () => {
		const data = Buffer.from("abcdefgh");
		expect(copyOverlapped(data, 0, 4, 4)).toBe(true);
		expect(data.toString("latin1")).toBe("abcdabcd");
	});

	it("writes zeroes for a range outside the buffer and says so", () => {
		const data = Buffer.from("abcd");
		expect(copyOverlapped(data, 2, 2, 4)).toBe(false);
		expect(data.equals(Buffer.from([0x61, 0x62, 0x63, 0x64]))).toBe(true);
		const behind = Buffer.from("abcd");
		expect(copyOverlapped(behind, -2, 0, 2)).toBe(false);
		expect(behind.subarray(0, 2)).toEqual(Buffer.from([0, 0]));
		const nothing = Buffer.from("abcd");
		expect(copyOverlapped(nothing, 0, 0, -1)).toBe(false);
		expect(nothing.equals(Buffer.from("abcd", "latin1"))).toBe(true);
	});
});
