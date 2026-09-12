import { adler32, Adler32, inflateZlibBuffer } from "@garbro-mcp/codecs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

describe("codecs", () => {
	it("computes Adler-32 incrementally with unsigned overflow semantics", () => {
		const first = Buffer.from("Wikipedia");
		expect(adler32(first)).toBe(0x11e60398);
		const incremental = new Adler32()
			.update(first.subarray(0, 4))
			.update(first.subarray(4));
		expect(incremental.value).toBe(0x11e60398);
		expect(incremental.hex).toBe("11e60398");
	});

	it("inflates zlib buffers and validates the declared output length", async () => {
		const input = Buffer.from("streamed zlib fixture");
		await expect(
			inflateZlibBuffer(deflateSync(input), input.length),
		).resolves.toEqual(input);
		await expect(
			inflateZlibBuffer(deflateSync(input), input.length - 1),
		).rejects.toThrow();
	});
});
