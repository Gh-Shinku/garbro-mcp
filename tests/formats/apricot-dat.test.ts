import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { apricotDatFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

const INDEX_START = 0x20;
const RECORD_HEADER_SIZE = 528;
const SKIPPED_SIZE = 500;

interface IndexRecord {
	name: string;
	/** Offset relative to the payload area, unless `absolute` is set. */
	offset: number;
	size: number;
	unpackedSize?: number;
	deleted?: boolean;
	absolute?: boolean;
}

/** Builds an uncompressed index; `offsets` hold the values the reader adds the payload base to. */
function buildIndex(
	records: readonly IndexRecord[],
	offsets: readonly bigint[],
): Buffer {
	const parts: Buffer[] = [];
	records.forEach((record, id) => {
		const name = Buffer.from(record.name, "utf16le");
		const header = Buffer.alloc(RECORD_HEADER_SIZE);
		header.writeInt32LE(RECORD_HEADER_SIZE + name.length, 0);
		header.writeUInt32LE(record.deleted === true ? 1 : 0, 4);
		header.writeBigInt64LE(offsets[id] ?? 0n, 8);
		header.writeUInt32LE(0, 0x10);
		header.writeUInt32LE(record.size, 0x14);
		header.writeUInt32LE(record.unpackedSize ?? record.size, 0x18);
		// The 500 bytes the reader skips are scratch space in the reference.
		header.fill(0x41, 0x1c, 0x1c + SKIPPED_SIZE);
		parts.push(header, name);
	});
	return Buffer.concat(parts);
}

/** Wraps an already compressed index and a payload area in the archive container. */
function rawArchive(index: Buffer, payload: Buffer): Buffer {
	const dataOffset = INDEX_START + index.length;
	const archive = Buffer.alloc(dataOffset + payload.length);
	archive.write("MPF2", 0, "latin1");
	archive.writeUInt32LE(index.length, 8);
	archive.writeUInt32LE(dataOffset, 0x10);
	index.copy(archive, INDEX_START);
	payload.copy(archive, dataOffset);
	return archive;
}

/**
 * Builds an archive from records whose offsets are relative to the payload area. The stored offset values are
 * relative too, so the layout is compressed repeatedly until the payload base stops moving.
 */
function buildArchive(
	records: readonly IndexRecord[],
	payload: Buffer,
): Buffer {
	const offsetsFor = (dataOffset: number) =>
		records.map((record) =>
			BigInt(record.absolute ? record.offset - dataOffset : record.offset),
		);
	let dataOffset = INDEX_START;
	let index = deflateSync(buildIndex(records, offsetsFor(dataOffset)));
	for (let attempt = 0; attempt < 5; attempt += 1) {
		const next = INDEX_START + index.length;
		if (next === dataOffset) break;
		dataOffset = next;
		index = deflateSync(buildIndex(records, offsetsFor(dataOffset)));
	}
	return rawArchive(index, payload);
}

describe("Apricot resource archive", () => {
	it("lists stored and packed entries and skips deleted and unreachable ones", async () => {
		const stored = Buffer.from("stored payload");
		const unpacked = Buffer.from("packed apricot payload contents");
		const packedStream = deflateSync(unpacked);
		const records: IndexRecord[] = [
			{ name: "dir\\one.bin", offset: 0, size: stored.length },
			{
				name: "two.bin",
				offset: stored.length,
				size: packedStream.length,
				unpackedSize: unpacked.length,
			},
			{ name: "gone.bin", offset: 0, size: 4, deleted: true },
			{ name: "outside.bin", offset: 0x10000, size: 4, absolute: true },
		];
		const archive = buildArchive(
			records,
			Buffer.concat([stored, packedStream]),
		);
		await withCompanionFiles(
			"data.dat",
			{ "data.dat": archive },
			async (mainPath) => {
				await expectCompanionArchive({
					format: apricotDatFormat,
					mainPath,
					entries: [
						{ path: "dir/one.bin", size: stored.length, content: stored },
						{ path: "two.bin", size: unpacked.length, content: unpacked },
					],
					metadata: { entryCount: 2, partCount: 0 },
				});
			},
		);
	});

	it("reads payloads from a part and across its boundary", async () => {
		const mainPayload = Buffer.from("MAINPART");
		const partPayload = Buffer.from("BEGIN!");
		const records: IndexRecord[] = [
			{ name: "alpha.bin", offset: 0, size: 8 },
			{ name: "beta.bin", offset: 4, size: 10 },
			{ name: "gamma.bin", offset: 10, size: 4 },
		];
		const archive = buildArchive(records, mainPayload);
		await withCompanionFiles(
			"data.dat",
			{ "data.dat": archive, "data.a01": partPayload },
			async (mainPath) => {
				await expectCompanionArchive({
					format: apricotDatFormat,
					mainPath,
					entries: [
						{ path: "alpha.bin", size: 8, content: mainPayload },
						{
							path: "beta.bin",
							size: 10,
							content: Buffer.concat([
								mainPayload.subarray(4),
								partPayload.subarray(0, 6),
							]),
						},
						{
							path: "gamma.bin",
							size: 4,
							content: partPayload.subarray(2, 6),
						},
					],
					metadata: { entryCount: 3, partCount: 1 },
				});
			},
		);
	});

	it("rejects a record without a name", async () => {
		const record = Buffer.alloc(RECORD_HEADER_SIZE);
		record.writeInt32LE(RECORD_HEADER_SIZE, 0);
		await expectDeclined(rawArchive(deflateSync(record), Buffer.alloc(0)));
	});

	it("rejects an index length outside the file", async () => {
		const archive = buildArchive(
			[{ name: "a", offset: 0, size: 4 }],
			Buffer.alloc(4),
		);
		archive.writeUInt32LE(0x1000, 8);
		await expectDeclined(archive);
	});

	it("rejects an index that is not a zlib stream", async () => {
		await expectDeclined(rawArchive(Buffer.alloc(16, 0x41), Buffer.alloc(4)));
	});

	it("rejects a wrong signature", async () => {
		const archive = buildArchive(
			[{ name: "a", offset: 0, size: 4 }],
			Buffer.alloc(4),
		);
		archive.write("MPF3", 0, "latin1");
		await expectDeclined(archive);
	});

	it("accepts an empty index", async () => {
		const archive = buildArchive([], Buffer.alloc(4));
		await withCompanionFiles(
			"data.dat",
			{ "data.dat": archive },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await apricotDatFormat.detect(source, mainPath)).toBe(true);
				const handle = await apricotDatFormat.open(source, mainPath);
				expect(handle.entries).toHaveLength(0);
				await handle.close();
			},
		);
	});
});

async function expectDeclined(archive: Buffer): Promise<void> {
	const source = new BufferByteSource(archive);
	expect(await apricotDatFormat.detect(source, "sample.dat")).toBe(false);
}
