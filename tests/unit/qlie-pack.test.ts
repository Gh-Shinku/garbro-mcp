import { decompressQliePack } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";

const MARKER = Buffer.from([0x31, 0x50, 0x43, 0xff]);

/** Assembles a stream: the marker, the flags, the output length, then the blocks. */
function buildStream(outputLength: number, blocks: readonly Buffer[]): Buffer {
	const header = Buffer.alloc(12);
	MARKER.copy(header, 0);
	header.writeUInt32LE(outputLength, 8);
	return Buffer.concat([header, ...blocks]);
}

/** Encodes an identity alphabet, which fills every slot with its own value. */
function identityTable(): Buffer {
	const runs: number[] = [];
	// A table byte counts the slots it fills, so 127 covers the largest run of 128.
	for (let start = 0; start < 256; start += 128) {
		runs.push(127);
		for (let slot = start; slot < start + 128; slot += 1) runs.push(slot);
	}
	return Buffer.from(runs);
}

describe("QLIE pack codec", () => {
	it("decodes literals through an identity alphabet", () => {
		const body = Buffer.from("payload");
		const stream = buildStream(body.length, [
			Buffer.concat([
				identityTable(),
				(() => {
					const count = Buffer.alloc(4);
					count.writeUInt32LE(body.length, 0);
					return count;
				})(),
				body,
			]),
		]);
		expect(decompressQliePack(stream).toString("latin1")).toBe("payload");
	});

	it("walks a table whose slot holds two children", () => {
		// Slot zero becomes an internal node over slots one and two, so a token of zero emits both.
		const table: number[] = [0, 1, 2];
		for (let slot = 1; slot < 256; slot += 1) table.push(0, slot);
		const tokens = Buffer.alloc(4);
		tokens.writeUInt32LE(1, 0);
		const stream = buildStream(2, [
			Buffer.concat([Buffer.from(table), tokens, Buffer.from([0])]),
		]);
		expect([...decompressQliePack(stream)]).toEqual([1, 2]);
	});

	it("decodes through the sixteen-bit token-count flag", () => {
		const body = Buffer.from("hi");
		const header = Buffer.alloc(12);
		MARKER.copy(header, 0);
		header.writeUInt32LE(1, 4);
		header.writeUInt32LE(body.length, 8);
		const count = Buffer.alloc(2);
		count.writeUInt16LE(body.length, 0);
		const stream = Buffer.concat([header, identityTable(), count, body]);
		expect(decompressQliePack(stream).toString("latin1")).toBe("hi");
	});

	it("rejects a stream without the marker", () => {
		const stream = buildStream(0, []);
		stream.writeUInt32LE(0, 0);
		expect(() => decompressQliePack(stream)).toThrow(RangeError);
	});

	it("rejects a stream that does not fill its declared output", () => {
		const tokens = Buffer.alloc(4);
		tokens.writeUInt32LE(1, 0);
		const stream = buildStream(4, [
			Buffer.concat([identityTable(), tokens, Buffer.from([0x41])]),
		]);
		expect(() => decompressQliePack(stream)).toThrow(RangeError);
	});
});
