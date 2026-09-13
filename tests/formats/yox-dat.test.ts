import { yoxDatFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0x14;

interface Record {
	payload: Buffer;
}

function buildYox(records: readonly Record[], stride: 8 | 0x10): Buffer {
	const indexSize = records.length * stride;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset +
			records.reduce((total, record) => total + record.payload.length, 0),
	);
	archive.write("YOX\0", 0, "ascii");
	archive.writeUInt32LE(INDEX_OFFSET, 8);
	archive.writeInt32LE(records.length, 0x0c);
	let offset = dataOffset;
	for (const [id, record] of records.entries()) {
		const entry = INDEX_OFFSET + id * stride;
		archive.writeUInt32LE(offset, entry);
		archive.writeUInt32LE(record.payload.length, entry + 4);
		record.payload.copy(archive, offset);
		offset += record.payload.length;
	}
	return archive;
}

/** A YOX container that hides zlib data behind the 0x10-byte packed header. */
function packedYox(data: Buffer): Buffer {
	const compressed = deflateSync(data);
	const header = Buffer.alloc(0x10);
	header.write("YOX\0", 0, "ascii");
	header.writeUInt32LE(2, 4);
	header.writeUInt32LE(data.length, 8);
	return Buffer.concat([header, compressed]);
}

describe("YOX DAT resource archive", () => {
	it("reads narrow records and unpacks zlib entries", async () => {
		const raw = Buffer.from("raw payload");
		const packed = Buffer.from("packed payload");
		await expectArchive({
			format: yoxDatFormat,
			archive: buildYox([{ payload: raw }, { payload: packedYox(packed) }], 8),
			sourcePath: "sample.dat",
			entries: [
				{ path: "00000", size: raw.length, content: raw },
				{
					path: "00001",
					size: packed.length,
					content: packed,
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("falls back to wide records", async () => {
		const data = Buffer.from("wide record payload");
		await expectArchive({
			format: yoxDatFormat,
			archive: buildYox([{ payload: data }], 0x10),
			sourcePath: "sample.dat",
			entries: [{ path: "00000", size: data.length, content: data }],
		});
	});

	it("leaves a YOX entry without the packed flag verbatim", async () => {
		const inner = Buffer.alloc(0x10);
		inner.write("YOX\0", 0, "ascii");
		inner.writeUInt32LE(0, 4);
		await expectArchive({
			format: yoxDatFormat,
			archive: buildYox([{ payload: inner }], 8),
			sourcePath: "sample.dat",
			entries: [{ path: "00000", size: inner.length, content: inner }],
		});
	});

	it("rejects a zero-sized record", async () => {
		const archive = buildYox([{ payload: Buffer.from("x") }], 8);
		archive.writeUInt32LE(0, INDEX_OFFSET + 4);
		await expectArchive({
			format: yoxDatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildYox([{ payload: Buffer.from("x") }], 8);
		archive.write("ZOX\0", 0, "ascii");
		await expectArchive({
			format: yoxDatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
