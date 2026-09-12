import { BufferByteSource, encodeCp932, GarbroError } from "@garbro-mcp/core";
import { PackDatFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

function rotateLeft32(value: number, count: number): number {
	if (count === 0) return value >>> 0;
	return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function encodeEntry(output: Buffer, flags: number, script: boolean): Buffer {
	const data = Buffer.from(output);
	if (script) {
		for (let index = 0; index < data.length; index += 1) {
			data[index] = (data[index] ?? 0) ^ 0xff;
		}
	}
	if ((flags & 0x10000) !== 0) {
		let key = data.length >>> 2;
		key = (key ^ (key << ((key & 7) + 8))) >>> 0;
		for (let offset = 0; offset + 4 <= data.length; offset += 4) {
			const plain = data.readUInt32LE(offset);
			data.writeUInt32LE((plain ^ key) >>> 0, offset);
			key = rotateLeft32(key, plain % 24);
		}
	}
	return data;
}

function buildPackDat(): { archive: Buffer; outputs: Buffer[] } {
	const definitions = [
		{ name: "raw.bin", flags: 0, output: Buffer.from("raw bytes") },
		{ name: "script.s", flags: 0, output: Buffer.from("script bytes!") },
		{
			name: "encrypted.dat",
			flags: 0x10000,
			output: Buffer.from("rotating xor payload!"),
		},
		{
			name: "combined.s",
			flags: 0x10000,
			output: Buffer.from("combined transform!"),
		},
	];
	const stored = definitions.map((definition) =>
		encodeEntry(
			definition.output,
			definition.flags,
			definition.name.endsWith(".s"),
		),
	);
	const dataFloor = 0x10 + definitions.length * 0x30;
	const archive = Buffer.alloc(
		dataFloor + stored.reduce((total, data) => total + data.length, 0),
	);
	archive.write("PACKDAT.", 0, "ascii");
	archive.writeUInt32LE(definitions.length, 8);
	let dataOffset = dataFloor;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 0x10 + index * 0x30;
		const data = stored[index];
		if (!data) throw new Error("PACKDAT fixture data is missing");
		encodeCp932(definition.name).copy(archive, recordOffset, 0, 0x20);
		archive.writeUInt32LE(dataOffset, recordOffset + 0x20);
		archive.writeUInt32LE(definition.flags, recordOffset + 0x24);
		archive.writeUInt32LE(data.length, recordOffset + 0x28);
		archive.writeUInt32LE(definition.output.length, recordOffset + 0x2c);
		data.copy(archive, dataOffset);
		dataOffset += data.length;
	}
	return { archive, outputs: definitions.map(({ output }) => output) };
}

describe("SYSTEM-epsilon PACKDAT", () => {
	it("extracts raw, inverted script, rotating-XOR, and combined entries", async () => {
		const fixture = buildPackDat();
		const archive = await new PackDatFormat().open(
			new BufferByteSource(fixture.archive),
			"sample.pak",
		);
		try {
			expect(archive.entries).toMatchObject([
				{ path: "raw.bin", encrypted: false },
				{ path: "script.s", encrypted: true },
				{ path: "encrypted.dat", encrypted: true },
				{ path: "combined.s", encrypted: true },
			]);
			for (const [index, entry] of archive.entries.entries()) {
				expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
					fixture.outputs[index],
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("rejects an entry outside the archive", async () => {
		const fixture = buildPackDat().archive;
		fixture.writeUInt32LE(fixture.length, 0x10 + 0x20);
		await expect(
			new PackDatFormat().open(new BufferByteSource(fixture), "broken.pak"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
