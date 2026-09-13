import { encodeCp932 } from "@garbro-mcp/core";
import { bsaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

interface Record {
	/** The name, or `>` to push a directory level and `<` to pop one. */
	marker: string;
	offset?: number;
	size?: number;
}

const RECORDS: readonly Record[] = [
	{ marker: ">dir" },
	{ marker: "a.dat", offset: 0, size: 8 },
	{ marker: "<" },
	{ marker: "b.dat", offset: 8, size: 6 },
];

/** Version 1: 0x28-byte records with a 0x20-byte name field. */
function buildV1(records: readonly Record[], version: number): Buffer {
	const indexOffset = 0x10;
	const indexSize = records.length * 0x28;
	const archive = Buffer.alloc(indexOffset + indexSize + 8 + 6);
	archive.write("BSAr", 0, "ascii");
	archive.writeInt16LE(0x63, 4);
	archive.writeInt16LE(version, 8);
	archive.writeInt16LE(records.length, 0xa);
	archive.writeUInt32LE(indexOffset, 0xc);
	for (const [id, record] of records.entries()) {
		const position = indexOffset + id * 0x28;
		encodeCp932(record.marker).copy(archive, position);
		archive.writeUInt32LE(
			0x10 + indexSize + (record.offset ?? 0),
			position + 0x20,
		);
		archive.writeUInt32LE(record.size ?? 0, position + 0x24);
	}
	Buffer.from("first bd").copy(archive, 0x10 + indexSize);
	Buffer.from("second").copy(archive, 0x10 + indexSize + 8);
	return archive;
}

/** Version 2: twelve-byte records and a name pool that trails the whole table. */
function buildV2(records: readonly Record[], version: number): Buffer {
	const indexOffset = 0x10;
	const recordsSize = records.length * 0xc;
	const names: Buffer[] = [];
	const offsets: number[] = [];
	let position = 0;
	for (const record of records) {
		offsets.push(position);
		const encoded = Buffer.concat([
			encodeCp932(record.marker),
			Buffer.from([0]),
		]);
		names.push(encoded);
		position += encoded.length;
	}
	const pool = Buffer.concat(names);
	const archive = Buffer.alloc(indexOffset + recordsSize + pool.length + 14);
	archive.write("BSAr", 0, "ascii");
	archive.writeInt16LE(0x63, 4);
	archive.writeInt16LE(version, 8);
	archive.writeInt16LE(records.length, 0xa);
	archive.writeUInt32LE(indexOffset, 0xc);
	for (const [id, record] of records.entries()) {
		const record0 = indexOffset + id * 0xc;
		archive.writeInt32LE(offsets[id] ?? 0, record0);
		archive.writeUInt32LE(
			0x10 + recordsSize + pool.length + (record.offset ?? 0),
			record0 + 4,
		);
		archive.writeUInt32LE(record.size ?? 0, record0 + 8);
	}
	pool.copy(archive, indexOffset + recordsSize);
	Buffer.from("first bd").copy(archive, 0x10 + recordsSize + pool.length);
	Buffer.from("second").copy(archive, 0x10 + recordsSize + pool.length + 8);
	return archive;
}

describe("Bishop BSA resource archive", () => {
	it("walks version 1 directory markers", async () => {
		await expectArchive({
			format: bsaFormat,
			archive: buildV1(RECORDS, 1),
			sourcePath: "sample.bsa",
			entries: [
				{ path: "dir/a.dat", size: 8, content: Buffer.from("first bd") },
				{ path: "b.dat", size: 6, content: Buffer.from("second") },
			],
		});
	});

	it("reads version 2 records with their name pool", async () => {
		await expectArchive({
			format: bsaFormat,
			archive: buildV2(RECORDS, 2),
			sourcePath: "sample.bsa",
			entries: [
				{ path: "dir/a.dat", size: 8, content: Buffer.from("first bd") },
				{ path: "b.dat", size: 6, content: Buffer.from("second") },
			],
		});
	});

	it("falls back to the version 1 reader when the wider layout fails", async () => {
		await expectArchive({
			format: bsaFormat,
			archive: buildV1(RECORDS, 2),
			sourcePath: "sample.bsa",
			entries: [
				{ path: "dir/a.dat", size: 8, content: Buffer.from("first bd") },
				{ path: "b.dat", size: 6, content: Buffer.from("second") },
			],
		});
	});

	it("rejects an unsupported version", async () => {
		await expectArchive({
			format: bsaFormat,
			archive: buildV1(RECORDS, 4),
			sourcePath: "sample.bsa",
			detected: false,
			entries: [],
		});
	});

	it("rejects a missing marker letter", async () => {
		const archive = buildV1(RECORDS, 1);
		archive.writeInt16LE(0x64, 4);
		await expectArchive({
			format: bsaFormat,
			archive,
			sourcePath: "sample.bsa",
			detected: false,
			entries: [],
		});
	});
});
