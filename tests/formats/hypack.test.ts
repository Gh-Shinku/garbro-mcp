import {
	BufferByteSource,
	encodeCp932,
	type GarbroError,
} from "@garbro-mcp/core";
import { HyPackFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

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

	it("reports Cocotte compression explicitly", async () => {
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
			>({ code: "UNSUPPORTED_FEATURE" });
		} finally {
			await archive.close();
		}
	});
});
