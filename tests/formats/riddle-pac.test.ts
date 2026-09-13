import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { riddlePacFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

interface Entry {
	name: string;
	payload: Buffer;
	unpackedSize?: number;
	indexMarker?: string;
}

function buildPac(entries: readonly Entry[]): Buffer {
	const dataOffset = 8 + entries.length * 0x20;
	const archive = Buffer.alloc(
		dataOffset +
			entries.reduce((total, entry) => total + entry.payload.length, 0),
	);
	archive.write("PAC1", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = 8 + id * 0x20;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.payload.length, record + 0x10);
		if (entry.indexMarker)
			archive.write(entry.indexMarker, record + 0x14, "ascii");
		archive.writeUInt32LE(
			entry.unpackedSize ?? entry.payload.length,
			record + 0x18,
		);
		entry.payload.copy(archive, offset);
		offset += entry.payload.length;
	}
	return archive;
}

describe("Riddle Soft PAC1 resource archive", () => {
	it("reads stored entries and expands index-marked CMP1 scripts", async () => {
		const packed = Buffer.alloc(15);
		packed.write("CMP1", 0, "ascii");
		packed.writeInt32LE(2, 4);
		Buffer.from([0xa0, 0xd1, 0x00]).copy(packed, 12);
		await expectArchive({
			format: riddlePacFormat,
			archive: buildPac([
				{ name: "plain.dat", payload: Buffer.from("raw") },
				{
					name: "script.scp",
					payload: packed,
					unpackedSize: 2,
					indexMarker: "CMP1",
				},
			]),
			sourcePath: "sample.pac",
			entries: [
				{ path: "plain.dat", size: 3, content: Buffer.from("raw") },
				{ path: "script.scp", size: 2, content: Buffer.from("AD") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("uses the index marker for packed detection and rechecks the payload marker", async () => {
		const payload = Buffer.from("not CMP1 data");
		const archive = buildPac([
			{
				name: "script.scp",
				payload,
				unpackedSize: 99,
				indexMarker: "CMP1",
			},
		]);
		const handle = await riddlePacFormat.open(
			new BufferByteSource(archive),
			"sample.pac",
		);
		try {
			expect(handle.entries[0]).toMatchObject({
				size: 99n,
				packedSize: BigInt(payload.length),
				compressed: true,
			});
			expect(await consumeBuffer(await handle.openEntry("0"))).toEqual(payload);
		} finally {
			await handle.close();
		}
	});

	it("detects by signature regardless of extension", async () => {
		const archive = buildPac([{ name: "a.bin", payload: Buffer.from("x") }]);
		await expectArchive({
			format: riddlePacFormat,
			archive,
			sourcePath: "sample.bin",
			entries: [{ path: "a.bin", size: 1 }],
		});
	});

	it("rejects an out-of-bounds sequential payload", async () => {
		const archive = buildPac([{ name: "a.bin", payload: Buffer.from("x") }]);
		archive.writeUInt32LE(2, 8 + 0x10);
		await expectArchive({
			format: riddlePacFormat,
			archive,
			sourcePath: "sample.pac",
			detected: false,
			entries: [],
		});
	});
});
