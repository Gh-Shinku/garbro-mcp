import {
	BufferCursor,
	decodeCp932,
	encodeCp932,
	GarbroError,
} from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";

describe("BufferCursor", () => {
	it("reads signed, unsigned, and bigint little-endian values", () => {
		const buffer = Buffer.alloc(22);
		buffer.writeUInt16LE(0xabcd, 0);
		buffer.writeInt16LE(-1234, 2);
		buffer.writeUInt32LE(0xfedcba98, 4);
		buffer.writeInt32LE(-123_456, 8);
		buffer.writeBigUInt64LE(0x1234_5678_9abc_def0n, 12);
		buffer.writeUInt16LE(0x42, 20);

		const cursor = new BufferCursor(buffer);
		expect(cursor.readU16LE()).toBe(0xabcd);
		expect(cursor.readI16LE()).toBe(-1234);
		expect(cursor.readU32LE()).toBe(0xfedcba98);
		expect(cursor.readI32LE()).toBe(-123_456);
		expect(cursor.readU64LE()).toBe(0x1234_5678_9abc_def0n);
		expect(cursor.readU16LE()).toBe(0x42);
	});

	it("rejects truncated input", () => {
		const cursor = new BufferCursor(Buffer.alloc(3));
		expect(() => cursor.readU32LE()).toThrow(GarbroError);
	});

	it("reads big-endian and non-standard-width integers", () => {
		const bigEndian = new BufferCursor(
			Buffer.from([
				0xab, 0xcd, 0x12, 0x34, 0x56, 0x01, 0x23, 0x45, 0x67, 0x89, 0xab, 0x01,
				0x23, 0x45, 0x67, 0x89, 0xab, 0xcd, 0xef,
			]),
		);
		expect(bigEndian.readU16BE()).toBe(0xabcd);
		expect(bigEndian.readU24BE()).toBe(0x123456);
		expect(bigEndian.readU48BE()).toBe(0x0123456789ab);
		expect(bigEndian.readU64BE()).toBe(0x0123456789abcdefn);

		const littleEndian = new BufferCursor(
			Buffer.from([0x56, 0x34, 0x12, 0xab, 0x89, 0x67, 0x45, 0x23, 0x01]),
		);
		expect(littleEndian.readU24LE()).toBe(0x123456);
		expect(littleEndian.readU48LE()).toBe(0x0123456789ab);

		const signed = new BufferCursor(
			Buffer.from([
				0xff, 0xfe, 0xff, 0xff, 0xff, 0xfd, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff,
				0xff, 0xfc,
			]),
		);
		expect(signed.readI16BE()).toBe(-2);
		expect(signed.readI32BE()).toBe(-3);
		expect(signed.readI64BE()).toBe(-4n);
	});

	it("reads bounded CP932 C strings", () => {
		const encoded = encodeCp932("画像");
		const cursor = new BufferCursor(
			Buffer.concat([encoded, Buffer.from([0, 0xff]), Buffer.from("tail")]),
		);
		expect(cursor.readCString(encoded.length + 2)).toBe("画像");
		expect(cursor.readFixedString(4, "ascii")).toBe("tail");
		expect(decodeCp932(encoded)).toBe("画像");
	});
});
