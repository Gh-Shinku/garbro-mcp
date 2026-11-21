import { buffer as consumeBuffer } from "node:stream/consumers";
import {
	BufferByteSource,
	encodeCp932,
	type GarbroError,
} from "@garbro-mcp/core";
import { decompressCocotte, HyPackFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { encodeCocotte } from "../helpers/cocotte.js";

const COCOTTE_PATTERN = "The quick brown fox jumps over the lazy dog. ";

/** A text of `size` bytes, of the pattern the Cocotte streams below were written from. */
function cocotteText(size: number): Buffer {
	const text = Buffer.alloc(size);
	for (let index = 0; index < size; index += 1) {
		text[index] = COCOTTE_PATTERN.charCodeAt(index % COCOTTE_PATTERN.length);
	}
	return text;
}

/** A run of bytes of little pattern, so that the writer stores a small block of it as it stands. */
function cocotteStepping(size: number): Buffer {
	const data = Buffer.alloc(size);
	for (let index = 0; index < size; index += 1) {
		data[index] = (index * 73 + 41) & 0xff;
	}
	return data;
}

// The three streams below were written by the published qscoder encoder of Michael Schindler
// (`rangecod.c`/`qsmodel.c`) behind a forward Burrows-Wheeler transform and a move-to-front order, not by
// the writer of this project's tests, so that the reader is held to the format rather than to its own
// writer. The three of them cover a block the coder shortened, a stream of two blocks whose model and order
// stand across the boundary, and a block the coder stored as it stands.
const COCOTTE_CODED = Buffer.from(
	"VAAsAQDh3nlEHttHnE0eLUHc+Qp15AeKHNpWampHRfwkwAdqYfIPqPB1g8nWnmFgWm2t3T06CwuvU4+b13f3mkWPeJANK1lMY5P0OoQMjNm8AABQ",
	"base64",
);
const COCOTTE_CODED_BLOCKS = Buffer.from(
	"ywAAIAD6N/KMAAAAAAAAAAAAAAAAAAAAMsJ8CgAAAA9C46IAAAhSR3gAGjOsGAKN0GwACA1O4AFwN0oInQUAC7RwogMiBfAA3r2kbygDqCIwGdsoQB3kGTGw3EgAAABwcsHggfd1JG3LgAVHx9g6YGIWwGW/yhgGq9rwKYc/XHba+DxnwxyXq8CfQa3YHjoxvLNMVt4h8hwS/WmAbPrgMogRvgkZ67gj3We+iIDGroInUDNKyyGIdOAAAAAAAFOm98lI4IAFOU0AAMdSACgDAPN/G/GFAS3JJ/d1tWzuaaS2xPECpG7dLe86aoqaJzQkUKNvUqfj6UvEFW98Jm8fOClG2isdFbjy+xu+1rJ9EIWjFdqyeJU10qtdAABO",
	"base64",
);
const COCOTTE_STORED = Buffer.from(
	"RgBAAA4Bt7i5urvX2Nna29zd3t8u/P3+/xMVFhcYMzQ1Njc4OTo7V1hZWltcXV5ffH1+f4CBgoOEoKGio6SlpqeoxcbHyA==",
	"base64",
);

describe("Cocotte", () => {
	it("reads a block the coder shortened", () => {
		expect(decompressCocotte(COCOTTE_CODED, 300)).toEqual(cocotteText(300));
	});

	it("reads blocks whose model and order stand across their boundary", () => {
		expect(decompressCocotte(COCOTTE_CODED_BLOCKS, 9000)).toEqual(
			cocotteText(9000),
		);
	});

	it("reads a block that stands as it was written", () => {
		expect(decompressCocotte(COCOTTE_STORED, 64)).toEqual(cocotteStepping(64));
	});

	for (const mode of ["auto", "store"] as const) {
		it(`round-trips the blocks its writer lays down (${mode})`, () => {
			for (const size of [1, 2, 300, 8192, 8193, 20000]) {
				for (const data of [
					cocotteText(size),
					Buffer.alloc(size, 0x41),
					cocotteStepping(size),
				]) {
					expect(
						decompressCocotte(encodeCocotte(data, { mode }), size),
					).toEqual(data);
				}
			}
		});
	}

	it("rejects a stream whose declared size does not match", () => {
		expect(() => decompressCocotte(COCOTTE_CODED, 301)).toThrow(
			/Cocotte stream is shorter/,
		);
		expect(() => decompressCocotte(COCOTTE_CODED, 299)).toThrow(
			/Cocotte stream is longer/,
		);
	});

	it("reads an empty stream as no bytes", () => {
		expect(decompressCocotte(Buffer.alloc(0), 0)).toEqual(Buffer.alloc(0));
	});

	it("rejects a block whose transform index is outside it", () => {
		const stream = Buffer.from([
			0x08, 0x00, 0x02, 0x00, 0x05, 0x00, 0x00, 0x00,
		]);
		expect(() => decompressCocotte(stream, 2)).toThrow(
			/Cocotte transform index is outside its block/,
		);
	});

	it("rejects a truncated stream and an empty block", () => {
		expect(() => decompressCocotte(Buffer.from([0x10, 0x00]), 1)).toThrow(
			/Cocotte block header is truncated/,
		);
		expect(() =>
			decompressCocotte(Buffer.from([0x04, 0x00, 0x00, 0x00, 0x00]), 1),
		).toThrow(/Cocotte block size is invalid/);
		expect(() =>
			decompressCocotte(Buffer.from([0x05, 0x00, 0x00, 0x00, 0x00]), 1),
		).toThrow(/Cocotte block size is invalid/);
		expect(() => decompressCocotte(COCOTTE_CODED.subarray(0, 20), 300)).toThrow(
			/Cocotte block is truncated/,
		);
	});
});

interface Definition {
	name: string;
	extension: string;
	stored: Buffer;
	output: Buffer;
	compressionType: number;
}

function recordSize(version: number): number {
	if (version === 0x100) return 0x20;
	if (version === 0x200) return 0x28;
	return 0x30;
}

function buildHyPack(version: number, definitions: Definition[]): Buffer {
	const dataSize = definitions.reduce(
		(total, definition) => total + definition.stored.length,
		0,
	);
	const indexOffset = 0x10 + dataSize;
	const size = recordSize(version);
	const archive = Buffer.alloc(indexOffset + definitions.length * size);
	archive.write("HyPack", 0, "ascii");
	archive.writeUInt16LE(version, 6);
	archive.writeUInt32LE(indexOffset - 0x10, 8);
	archive.writeUInt32LE(definitions.length, 12);
	let dataOffset = 0x10;
	for (const [index, definition] of definitions.entries()) {
		definition.stored.copy(archive, dataOffset);
		const entryOffset = indexOffset + index * size;
		encodeCp932(definition.name).copy(archive, entryOffset, 0, 0x15);
		encodeCp932(definition.extension).copy(archive, entryOffset + 0x15, 0, 3);
		archive.writeUInt32LE(dataOffset - 0x10, entryOffset + 0x18);
		if (version === 0x100) {
			archive.writeUInt32LE(definition.stored.length, entryOffset + 0x1c);
		} else {
			archive.writeUInt32LE(definition.output.length, entryOffset + 0x1c);
			archive.writeUInt32LE(definition.stored.length, entryOffset + 0x20);
			archive[entryOffset + 0x24] = definition.compressionType;
			if (version >= 0x300) {
				archive[entryOffset + 0x25] = 1;
				archive.writeUInt16LE(0x1234, entryOffset + 0x26);
				archive.writeBigInt64LE(638000000000000000n, entryOffset + 0x28);
			}
		}
		dataOffset += definition.stored.length;
	}
	return archive;
}

function rawDefinition(name = "plain", extension = "txt"): Definition {
	const output = Buffer.from("raw HyPack data");
	return { name, extension, stored: output, output, compressionType: 0 };
}

describe("Kogado HyPack", () => {
	it("recognizes embedded ADP1 by decoded header across storage methods", async () => {
		const output = Buffer.alloc(32);
		output.write("ADP1");
		output.writeUInt32LE(32, 4);
		output.writeUInt32LE(22050, 8);
		output.writeUInt16LE(1, 12);
		const stored = [
			output,
			Buffer.concat([Buffer.alloc(4), output]),
			encodeCocotte(output),
			Buffer.from(output.map((byte) => byte ^ 0xff)),
		];
		const definitions = stored.map((bytes, compressionType) => ({
			name: `voice${compressionType}`,
			extension: "ADP",
			output,
			stored: bytes,
			compressionType,
		}));
		const invalid = Buffer.from(output);
		invalid.writeUInt32LE(0, 8);
		definitions.push({
			name: "other",
			extension: "adp",
			output: invalid,
			stored: invalid,
			compressionType: 0,
		});
		const archive = await new HyPackFormat().open(
			new BufferByteSource(buildHyPack(0x301, definitions)),
			"sample.pak",
		);
		try {
			expect(archive.entries.map((entry) => entry.resourceType)).toEqual([
				"audio",
				"audio",
				"audio",
				"audio",
				undefined,
			]);
		} finally {
			await archive.close();
		}
	});
	for (const version of [0x100, 0x200, 0x300, 0x301]) {
		it(`reads version 0x${version.toString(16)} indexes`, async () => {
			const fixture = buildHyPack(version, [rawDefinition("", "dat")]);
			const archive = await new HyPackFormat().open(
				new BufferByteSource(fixture),
				"sample.pak",
			);
			try {
				expect(archive.metadata).toEqual({
					version: `0x${version.toString(16)}`,
				});
				expect(archive.entries[0]).toMatchObject({ path: "00000.dat" });
				expect(await consumeBuffer(await archive.openEntry("0"))).toEqual(
					Buffer.from("raw HyPack data"),
				);
			} finally {
				await archive.close();
			}
		});
	}

	it("expands Mariel references and XOR-FF entries", async () => {
		const marielOutput = Buffer.from("AAAA");
		const mariel = Buffer.alloc(6);
		mariel.writeUInt32LE(0x40000000, 0);
		mariel[4] = 0x41;
		mariel[5] = 0x20;
		const xorOutput = Buffer.from("encrypted bytes");
		const xorStored = Buffer.from(xorOutput);
		for (let index = 0; index < xorStored.length; index += 1) {
			xorStored[index] = (xorStored[index] ?? 0) ^ 0xff;
		}
		const fixture = buildHyPack(0x301, [
			{
				name: "mariel",
				extension: "bin",
				stored: mariel,
				output: marielOutput,
				compressionType: 1,
			},
			{
				name: "secret",
				extension: "dat",
				stored: xorStored,
				output: xorOutput,
				compressionType: 3,
			},
		]);
		const archive = await new HyPackFormat().open(
			new BufferByteSource(fixture),
			"sample.pak",
		);
		try {
			expect(archive.entries).toMatchObject([
				{ path: "mariel.bin", compressed: true },
				{ path: "secret.dat", encrypted: true },
			]);
			expect(await consumeBuffer(await archive.openEntry("0"))).toEqual(
				marielOutput,
			);
			expect(await consumeBuffer(await archive.openEntry("1"))).toEqual(
				xorOutput,
			);
		} finally {
			await archive.close();
		}
	});

	it("expands Cocotte entries", async () => {
		const output = cocotteText(300);
		const fixture = buildHyPack(0x200, [
			{
				name: "cocotte",
				extension: "bin",
				stored: COCOTTE_CODED,
				output,
				compressionType: 2,
			},
		]);
		const archive = await new HyPackFormat().open(
			new BufferByteSource(fixture),
			"sample.pak",
		);
		try {
			expect(archive.entries).toMatchObject([
				{ path: "cocotte.bin", compressed: true },
			]);
			expect(await consumeBuffer(await archive.openEntry("0"))).toEqual(output);
		} finally {
			await archive.close();
		}
	});

	it("reports a Cocotte entry that does not decode", async () => {
		const fixture = buildHyPack(0x200, [
			{
				name: "cocotte",
				extension: "bin",
				stored: Buffer.from("packed"),
				output: Buffer.alloc(16),
				compressionType: 2,
			},
		]);
		const archive = await new HyPackFormat().open(
			new BufferByteSource(fixture),
			"sample.pak",
		);
		try {
			await expect(archive.openEntry("0")).rejects.toMatchObject<
				Partial<GarbroError>
			>({ code: "INVALID_ARCHIVE" });
		} finally {
			await archive.close();
		}
	});
});
