import { deflateSync } from "node:zlib";
import { encodeCp932 } from "@garbro-mcp/core";
import { aarFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0xc;

interface Entry {
	name: string;
	payload: Buffer;
	flag: number;
}

/** Records hold an offset, a size, a flag word and a null-terminated name, with payloads behind. */
function buildAar(entries: readonly Entry[]): Buffer {
	const records = entries.map((entry) =>
		Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
	);
	const indexSize = records.reduce(
		(sum, record) => sum + 12 + record.length,
		0,
	);
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.payload.length, 0),
	);
	archive.write("AAR\0", 0, "latin1");
	archive.writeUInt32LE(archive.length, 4);
	archive.writeInt32LE(entries.length, 8);
	let position = INDEX_OFFSET;
	let data = dataOffset;
	for (const [id, entry] of entries.entries()) {
		archive.writeUInt32LE(data, position);
		archive.writeUInt32LE(entry.payload.length, position + 4);
		archive.writeInt32LE(entry.flag, position + 8);
		records[id]?.copy(archive, position + 12);
		position += 12 + (records[id]?.length ?? 0);
		entry.payload.copy(archive, data);
		data += entry.payload.length;
	}
	return archive;
}

/** A ZLB header: the marker, the unpacked size, the packed size, then the zlib stream. */
function zlb(unpackedSize: number, stream: Buffer): Buffer {
	const header = Buffer.alloc(0x10);
	header.write("ZLB\0", 0, "latin1");
	header.writeUInt32LE(unpackedSize, 8);
	header.writeUInt32LE(stream.length, 12);
	return Buffer.concat([header, stream]);
}

describe("AliceSoft AAR resource archive", () => {
	it("reads plain payloads and decodes ZLB payloads", async () => {
		const plain = Buffer.from("plain body");
		const unpacked = Buffer.from("inflated contents");
		const packed = zlb(unpacked.length, deflateSync(unpacked));
		await expectArchive({
			format: aarFormat,
			archive: buildAar([
				{ name: "one.dat", payload: plain, flag: 1 },
				{ name: "two.dat", payload: packed, flag: 0 },
			]),
			sourcePath: "sample.red",
			entries: [
				{ path: "one.dat", size: plain.length, content: plain },
				{ path: "two.dat", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildAar([
			{ name: "one.dat", payload: Buffer.from("x"), flag: 1 },
		]);
		archive.write("AAS\0", 0, "latin1");
		await expectArchive({
			format: aarFormat,
			archive,
			sourcePath: "sample.red",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty entry count", async () => {
		const archive = buildAar([
			{ name: "one.dat", payload: Buffer.from("x"), flag: 1 },
		]);
		archive.writeInt32LE(0, 8);
		await expectArchive({
			format: aarFormat,
			archive,
			sourcePath: "sample.red",
			detected: false,
			entries: [],
		});
	});

	it("rejects a payload outside the file", async () => {
		const archive = buildAar([
			{ name: "one.dat", payload: Buffer.from("x"), flag: 1 },
		]);
		archive.writeUInt32LE(archive.length + 4, INDEX_OFFSET);
		await expectArchive({
			format: aarFormat,
			archive,
			sourcePath: "sample.red",
			detected: false,
			entries: [],
		});
	});
});
