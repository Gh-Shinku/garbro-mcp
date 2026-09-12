import { BufferCursor, GarbroError } from "@garbro-mcp/core";
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
});
