import { BufferByteSource, encodeCp932, GarbroError } from "@garbro-mcp/core";
import { AcpxFormat, decompressAcpLzw } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

function packTokens(tokens: number[], width = 9): Buffer {
	const bits: number[] = [];
	for (const token of tokens) {
		for (let shift = width - 1; shift >= 0; shift -= 1) {
			bits.push((token >> shift) & 1);
		}
	}
	const output = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		output[index >> 3] = (output[index >> 3] ?? 0) | (bit << (7 - (index & 7)));
	}
	return output;
}

function compressedEntry(output: Buffer, tokens: number[]): Buffer {
	const payload = packTokens(tokens);
	const entry = Buffer.alloc(8 + payload.length);
	entry.write("acp\0", 0, "binary");
	entry.writeUInt32BE(output.length, 4);
	payload.copy(entry, 8);
	return entry;
}

function buildAcpx(signature = "ACPXPK01"): {
	archive: Buffer;
	contents: Buffer[];
} {
	const repeated = Buffer.from("ABAB");
	const definitions = [
		{
			name: "packed.bin",
			stored: compressedEntry(repeated, [0x41, 0x42, 0x103]),
			output: repeated,
		},
		{
			name: "階層\\raw.dat",
			stored: Buffer.from("raw favorite data"),
			output: Buffer.from("raw favorite data"),
		},
	];
	const dataOffset = 0x0c + definitions.length * 0x28;
	const archive = Buffer.alloc(
		dataOffset +
			definitions.reduce((total, { stored }) => total + stored.length, 0),
	);
	archive.write(signature, 0, "ascii");
	archive.writeUInt32LE(definitions.length, 8);
	let offset = dataOffset;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 0x0c + index * 0x28;
		encodeCp932(definition.name).copy(archive, recordOffset, 0, 0x20);
		archive.writeUInt32LE(offset, recordOffset + 0x20);
		archive.writeUInt32LE(definition.stored.length, recordOffset + 0x24);
		definition.stored.copy(archive, offset);
		offset += definition.stored.length;
	}
	return { archive, contents: definitions.map(({ output }) => output) };
}

describe("Favorite ACPXPK", () => {
	it("reads hierarchical CP932 names and expands ACP LZW dictionary tokens", async () => {
		const fixture = buildAcpx();
		const format = new AcpxFormat();
		const source = new BufferByteSource(fixture.archive);
		expect(await format.detect(source)).toBe(true);
		const archive = await format.open(source, "sample.bin");
		try {
			expect(archive.entries).toMatchObject([
				{
					id: "0",
					path: "packed.bin",
					size: 4n,
					compressed: true,
				},
				{
					id: "1",
					path: "階層/raw.dat",
					compressed: false,
				},
			]);
			for (const [index, entry] of archive.entries.entries()) {
				expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
					fixture.contents[index],
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("recognizes the ACP_PK.1 signature variant", async () => {
		const fixture = buildAcpx("ACP_PK.1").archive;
		expect(await new AcpxFormat().detect(new BufferByteSource(fixture))).toBe(
			true,
		);
	});

	it("rejects an invalid dictionary reference", () => {
		expect(() => decompressAcpLzw(packTokens([0x103]), 1)).toThrowError(
			GarbroError,
		);
	});
});
