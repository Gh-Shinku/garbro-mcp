import { BufferByteSource, encodeCp932, GarbroError } from "@garbro-mcp/core";
import { MpxFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

function script(signature: number, key: number): Buffer {
	const data = Buffer.alloc(20);
	data.write("ISF\0", 0, "binary");
	data.writeUInt16LE(signature, 4);
	data[6] = key;
	for (let index = 8; index < data.length; index += 1) data[index] = index * 7;
	return data;
}

function transform(data: Buffer, kind: "rotate" | "invert" | "xor"): Buffer {
	const output = Buffer.from(data);
	for (let index = 8; index < output.length; index += 1) {
		const value = output[index] ?? 0;
		if (kind === "rotate") output[index] = (value >>> 2) | (value << 6);
		else if (kind === "invert") output[index] = ~value;
		else output[index] = value ^ (output[6] ?? 0);
	}
	return output;
}

function buildMpx(): { archive: Buffer; outputs: Buffer[]; stored: Buffer[] } {
	const rotate = script(0x9795, 0);
	const invert = script(0xd197, 0);
	const xor = script(0xce89, 0x5a);
	const secret = Buffer.concat([
		Buffer.from("encoded script body"),
		Buffer.from("SECRETFILTER100a"),
	]);
	const raw = Buffer.from("raw image data");
	const definitions = [
		{ name: "ROTATE.ISF", stored: rotate, output: transform(rotate, "rotate") },
		{ name: "INVERT.SNR", stored: invert, output: transform(invert, "invert") },
		{ name: "XOR.ISF", stored: xor, output: transform(xor, "xor") },
		{ name: "SECRET.SNR", stored: secret, output: secret },
		{ name: "IMAGE.BIN", stored: raw, output: raw },
	];
	const indexSize = definitions.length * 0x14;
	const dataFloor = 0x20 + indexSize;
	const archive = Buffer.alloc(
		dataFloor +
			definitions.reduce((total, { stored }) => total + stored.length, 0),
	);
	archive.write("SM2MPX10", 0, "ascii");
	archive.writeUInt32LE(definitions.length, 8);
	archive.writeUInt32LE(indexSize, 12);
	let dataOffset = dataFloor;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 0x20 + index * 0x14;
		encodeCp932(definition.name).copy(archive, recordOffset, 0, 12);
		archive.writeUInt32LE(dataOffset, recordOffset + 12);
		archive.writeUInt32LE(definition.stored.length, recordOffset + 16);
		definition.stored.copy(archive, dataOffset);
		dataOffset += definition.stored.length;
	}
	return {
		archive,
		outputs: definitions.map(({ output }) => output),
		stored: definitions.map(({ stored }) => stored),
	};
}

describe("IKURA GDL", () => {
	it("reads entries and applies the three inline script transforms", async () => {
		const fixture = buildMpx();
		const archive = await new MpxFormat().open(
			new BufferByteSource(fixture.archive),
			"sample",
		);
		try {
			expect(archive.metadata).toEqual({
				hasScripts: true,
				hasSecretFilteredScripts: true,
			});
			expect(archive.entries).toMatchObject([
				{ path: "rotate.isf", metadata: { scriptTransform: "rotate-right-2" } },
				{ path: "invert.snr", metadata: { scriptTransform: "invert" } },
				{ path: "xor.isf", metadata: { scriptTransform: "xor-key" } },
				{
					path: "secret.snr",
					encrypted: true,
					metadata: { requiresSecret: true },
				},
				{ path: "image.bin", encrypted: false },
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

	it("rejects an index entry outside the archive", async () => {
		const fixture = buildMpx().archive;
		fixture.writeUInt32LE(fixture.length, 0x20 + 12);
		await expect(
			new MpxFormat().open(new BufferByteSource(fixture), "broken"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
