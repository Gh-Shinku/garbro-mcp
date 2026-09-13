import { encodeCp932 } from "@garbro-mcp/core";
import { mbfFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x20;

/** Builds a `BC` record: a two-byte marker, the record size at +2, and the payload. */
function bcRecord(payload: Buffer): Buffer {
	const record = Buffer.concat([
		Buffer.from("BC", "ascii"),
		Buffer.alloc(4),
		payload,
	]);
	record.writeUInt32LE(record.length, 2);
	return record;
}

/** Builds a `$SEQ` record: a four-byte marker, the record size at +4, and the payload. */
function seqRecord(payload: Buffer): Buffer {
	const record = Buffer.concat([
		Buffer.from("$SEQ", "ascii"),
		Buffer.alloc(4),
		payload,
	]);
	record.writeUInt32LE(record.length, 4);
	return record;
}

function nameRecord(name: string): Buffer {
	const encoded = encodeCp932(name);
	const record = Buffer.alloc(2 + encoded.length);
	record.writeUInt16LE(encoded.length + 2, 0);
	encoded.copy(record, 2);
	return record;
}

function buildMbf(
	entries: readonly { name: string; record: Buffer }[],
	options: { signature?: string; skipRecordSize?: number } = {},
): Buffer {
	const names = Buffer.concat([
		options.skipRecordSize === undefined
			? Buffer.alloc(0)
			: Buffer.alloc(options.skipRecordSize),
		...entries.map((entry) => nameRecord(entry.name)),
	]);
	const dataOffset = INDEX_OFFSET + names.length;
	const archive = Buffer.concat([
		Buffer.alloc(dataOffset),
		...entries.map((entry) => entry.record),
	]);
	archive.write(options.signature ?? "MBF0", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(dataOffset, 8);
	names.copy(archive, INDEX_OFFSET);
	return archive;
}

describe("Tanaka MBF image archive", () => {
	it("reads names from the index and sizes from BC payload headers", async () => {
		const first = bcRecord(Buffer.from("first image"));
		const second = bcRecord(Buffer.from("second"));
		await expectArchive({
			format: mbfFormat,
			archive: buildMbf([
				{ name: "title.bc", record: first },
				{ name: "cg/face.bc", record: second },
			]),
			sourcePath: "sample.mbf",
			entries: [
				{ path: "title.bc", size: first.length, content: first },
				{ path: "cg/face.bc", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads $SEQ payload headers", async () => {
		const record = seqRecord(Buffer.from("sequence"));
		await expectArchive({
			format: mbfFormat,
			archive: buildMbf([{ name: "anim.seq", record }], {
				signature: "MBF1",
			}),
			sourcePath: "sample.mbf",
			entries: [{ path: "anim.seq", size: record.length, content: record }],
		});
	});

	it("skips the extra index record when the flag is set", async () => {
		const record = bcRecord(Buffer.from("payload"));
		const archive = buildMbf([{ name: "a.bc", record }], {
			signature: "MBF1",
			skipRecordSize: 0x10,
		});
		// The flag marks a leading record whose own length is skipped, and it consumes one count.
		archive.writeUInt8(1, 0x0c);
		archive.writeInt32LE(2, 4);
		archive.writeUInt16LE(0x10, INDEX_OFFSET);
		await expectArchive({
			format: mbfFormat,
			archive,
			sourcePath: "sample.mbf",
			entries: [{ path: "a.bc", size: record.length, content: record }],
			metadata: { entryCount: 1 },
		});
	});

	it("rejects unknown payload headers", async () => {
		const record = bcRecord(Buffer.from("x"));
		const archive = buildMbf([{ name: "a.bc", record }]);
		const dataOffset = archive.readUInt32LE(8);
		archive.write("ZZ", dataOffset, "ascii");
		await expectArchive({
			format: mbfFormat,
			archive,
			sourcePath: "sample.mbf",
			detected: false,
			entries: [],
		});
	});
});
