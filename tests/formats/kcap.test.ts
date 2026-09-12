import { BufferByteSource, encodeCp932, GarbroError } from "@garbro-mcp/core";
import { createKcapKeyTable, KcapFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

function xorWithTable(input: Buffer, table: Buffer): Buffer {
	const output = Buffer.alloc(input.length);
	for (let index = 0; index < input.length; index += 1) {
		output[index] = (input[index] ?? 0) ^ (table[index & 0xffff] ?? 0);
	}
	return output;
}

function buildKcap(passphrase = ""): { archive: Buffer; outputs: Buffer[] } {
	const keyTable = createKcapKeyTable(passphrase);
	const encryptedOutput = Buffer.alloc(0x10005);
	for (let index = 0; index < encryptedOutput.length; index += 1) {
		encryptedOutput[index] = (index * 37 + 11) & 0xff;
	}
	const definitions = [
		{
			name: "plain.txt",
			stored: Buffer.from("plain KCAP data"),
			output: Buffer.from("plain KCAP data"),
			encrypted: false,
		},
		{
			name: "画像\\secret.bin",
			stored: xorWithTable(encryptedOutput, keyTable),
			output: encryptedOutput,
			encrypted: true,
		},
	];
	const dataFloor = 8 + definitions.length * 0x54;
	const archive = Buffer.alloc(
		dataFloor +
			definitions.reduce((total, { stored }) => total + stored.length, 0),
	);
	archive.write("KCAP", 0, "ascii");
	archive.writeUInt32LE(definitions.length, 4);
	let dataOffset = dataFloor;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 8 + index * 0x54;
		encodeCp932(definition.name).copy(archive, recordOffset, 0, 0x40);
		archive.writeUInt32LE(dataOffset, recordOffset + 0x48);
		archive.writeUInt32LE(definition.stored.length, recordOffset + 0x4c);
		archive.writeUInt32LE(definition.encrypted ? 1 : 0, recordOffset + 0x50);
		definition.stored.copy(archive, dataOffset);
		dataOffset += definition.stored.length;
	}
	return { archive, outputs: definitions.map(({ output }) => output) };
}

describe("Selene KCAP", () => {
	it("matches the GARbro signed-MT default key vector", () => {
		expect(createKcapKeyTable("").subarray(0, 32).toString("hex")).toBe(
			"2b99f62e73039ccd6bf14ddbd8b10d47f2b71902c14c965bf0177379bd5a3d7e",
		);
	});

	it("extracts raw and encrypted entries across a key-table boundary", async () => {
		const fixture = buildKcap();
		const archive = await new KcapFormat().open(
			new BufferByteSource(fixture.archive),
			"DATA.Pack",
		);
		try {
			expect(archive.metadata).toEqual({
				hasEncryptedEntries: true,
				usesDefaultPassphrase: true,
			});
			expect(archive.entries).toMatchObject([
				{ path: "plain.txt", encrypted: false },
				{ path: "画像/secret.bin", encrypted: true, size: 0x10005n },
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

	it("accepts an explicit game passphrase", async () => {
		const passphrase = "custom-passphrase";
		const fixture = buildKcap(passphrase);
		const archive = await new KcapFormat(passphrase).open(
			new BufferByteSource(fixture.archive),
			"DATA.Pack",
		);
		try {
			expect(archive.metadata).toMatchObject({ usesDefaultPassphrase: false });
			expect(await consumeBuffer(await archive.openEntry("1"))).toEqual(
				fixture.outputs[1],
			);
		} finally {
			await archive.close();
		}
	});

	it("rejects an entry outside the archive", async () => {
		const fixture = buildKcap().archive;
		fixture.writeUInt32LE(fixture.length, 8 + 0x48);
		await expect(
			new KcapFormat().open(new BufferByteSource(fixture), "broken.pack"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
