import {
	adler32,
	Adler32,
	crc32,
	crc32Normal,
	inflateZlibBuffer,
} from "@garbro-mcp/codecs";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

describe("codecs", () => {
	it("computes the standard CRC-32 check vector", () => {
		expect(crc32(Buffer.from("123456789"))).toBe(0xcbf43926);
	});

	it("computes the CRC-32 of the normal polynomial", () => {
		// The normal polynomial stands the other way round, so the same string gives another value than the
		// check vector of the reflected one.
		expect(crc32Normal(Buffer.from("123456789"))).toBe(0x89a1897f);
		expect(crc32Normal(Buffer.alloc(0))).toBe(0);
		expect(crc32Normal(Buffer.from("123456789"), 0xffffffff)).toBe(0x0376e6e7);
	});

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
