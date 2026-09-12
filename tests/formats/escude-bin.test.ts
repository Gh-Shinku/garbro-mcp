import { BufferByteSource, encodeCp932, GarbroError } from "@garbro-mcp/core";
import { EscudeBinFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

class TestKeyGenerator {
	#seed: number;

	constructor(seed: number) {
		this.#seed = seed >>> 0;
	}

	next(): number {
		this.#seed = (this.#seed ^ 0x65ac9365) >>> 0;
		const right = (((this.#seed >>> 1) ^ this.#seed) >>> 3) >>> 0;
		const left = (((this.#seed << 1) ^ this.#seed) << 3) >>> 0;
		this.#seed = (this.#seed ^ right ^ left) >>> 0;
		return this.#seed;
	}
}

function cryptWords(data: Buffer, keys: TestKeyGenerator): void {
	for (let offset = 0; offset < data.length; offset += 4) {
		data.writeUInt32LE((data.readUInt32LE(offset) ^ keys.next()) >>> 0, offset);
	}
}

function compressedAbab(): Buffer {
	const tokens = [0x41, 0x42, 0x103];
	const bits: number[] = [];
	for (const token of tokens) {
		for (let shift = 8; shift >= 0; shift -= 1) bits.push((token >> shift) & 1);
	}
	const payload = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		payload[index >> 3] =
			(payload[index >> 3] ?? 0) | (bit << (7 - (index & 7)));
	}
	const output = Buffer.alloc(8 + payload.length);
	output.write("acp\0", 0, "binary");
	output.writeUInt32BE(4, 4);
	payload.copy(output, 8);
	return output;
}

function buildV1(): { archive: Buffer; outputs: Buffer[] } {
	const definitions = [
		{
			name: "PACKED.BIN",
			stored: compressedAbab(),
			output: Buffer.from("ABAB"),
		},
		{
			name: "階層\\RAW.DAT",
			stored: Buffer.from("v1 raw data"),
			output: Buffer.from("v1 raw data"),
		},
	];
	const index = Buffer.alloc(definitions.length * 0x88);
	const dataFloor = 0x10 + index.length;
	let dataOffset = dataFloor;
	for (const [id, definition] of definitions.entries()) {
		const recordOffset = id * 0x88;
		encodeCp932(definition.name).copy(index, recordOffset, 0, 0x80);
		index.writeUInt32LE(dataOffset, recordOffset + 0x80);
		index.writeUInt32LE(definition.stored.length, recordOffset + 0x84);
		dataOffset += definition.stored.length;
	}
	const archive = Buffer.alloc(dataOffset);
	archive.write("ESC-ARC1", 0, "ascii");
	const seed = 0x12345678;
	archive.writeUInt32LE(seed, 8);
	const keys = new TestKeyGenerator(seed);
	archive.writeUInt32LE((definitions.length ^ keys.next()) >>> 0, 12);
	cryptWords(index, keys);
	index.copy(archive, 0x10);
	dataOffset = dataFloor;
	for (const definition of definitions) {
		definition.stored.copy(archive, dataOffset);
		dataOffset += definition.stored.length;
	}
	return { archive, outputs: definitions.map(({ output }) => output) };
}

function buildV2(): { archive: Buffer; outputs: Buffer[] } {
	const definitions = [
		{ name: "VOICE.OGG", stored: Buffer.from("OggS synthetic") },
		{ name: "DIR\\SCRIPT.BIN", stored: Buffer.from("v2 script") },
	];
	const encodedNames = definitions.map(({ name }) =>
		Buffer.concat([encodeCp932(name), Buffer.from([0])]),
	);
	const names = Buffer.concat(encodedNames);
	const nameOffsets: number[] = [];
	let nameOffset = 0;
	for (const name of encodedNames) {
		nameOffsets.push(nameOffset);
		nameOffset += name.length;
	}
	const index = Buffer.alloc(definitions.length * 12);
	const dataFloor = 0x14 + index.length + names.length;
	let dataOffset = dataFloor;
	for (const [id, definition] of definitions.entries()) {
		const recordOffset = id * 12;
		index.writeUInt32LE(nameOffsets[id] ?? 0, recordOffset);
		index.writeUInt32LE(dataOffset, recordOffset + 4);
		index.writeUInt32LE(definition.stored.length, recordOffset + 8);
		dataOffset += definition.stored.length;
	}
	const archive = Buffer.alloc(dataOffset);
	archive.write("ESC-ARC2", 0, "ascii");
	const seed = 0x89abcdef;
	archive.writeUInt32LE(seed, 8);
	const keys = new TestKeyGenerator(seed);
	archive.writeUInt32LE((definitions.length ^ keys.next()) >>> 0, 12);
	archive.writeUInt32LE((names.length ^ keys.next()) >>> 0, 0x10);
	cryptWords(index, keys);
	index.copy(archive, 0x14);
	names.copy(archive, 0x14 + index.length);
	dataOffset = dataFloor;
	for (const definition of definitions) {
		definition.stored.copy(archive, dataOffset);
		dataOffset += definition.stored.length;
	}
	return {
		archive,
		outputs: definitions.map(({ stored }) => stored),
	};
}

describe("Escu:de ESC-ARC", () => {
	it("decrypts v1 fixed records and expands ACP entries", async () => {
		const fixture = buildV1();
		const format = new EscudeBinFormat();
		const source = new BufferByteSource(fixture.archive);
		expect(await format.detect(source)).toBe(true);
		const archive = await format.open(source, "sample.bin");
		try {
			expect(archive.metadata).toEqual({ version: 1 });
			expect(archive.entries).toMatchObject([
				{ path: "PACKED.BIN", compressed: true, size: 4n },
				{ path: "階層/RAW.DAT", compressed: false },
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

	it("decrypts v2 records and resolves its separate CP932 name table", async () => {
		const fixture = buildV2();
		const archive = await new EscudeBinFormat().open(
			new BufferByteSource(fixture.archive),
			"sample.bin",
		);
		try {
			expect(archive.metadata).toEqual({ version: 2 });
			expect(archive.entries).toMatchObject([
				{ path: "VOICE.OGG" },
				{ path: "DIR/SCRIPT.BIN" },
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

	it("rejects a truncated encrypted index", async () => {
		const fixture = buildV1().archive.subarray(0, 0x20);
		await expect(
			new EscudeBinFormat().open(new BufferByteSource(fixture), "broken.bin"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
