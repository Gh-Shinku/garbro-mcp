import { FileByteSource } from "@garbro-mcp/core";
import { tamasoftEpkFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

const INDEX_START = 0x20;
const RECORD_SIZE = 0x28;

interface Record {
	name: string;
	/** Offset relative to the start of the payload area, which is the origin of the virtual offset space. */
	offset: number;
	size: number;
}

/**
 * Builds an EPK file: a 0x20-byte header, the records, the negated name blocks that live inside the index,
 * and then the payload area the virtual offsets point into.
 */
function buildEpk(records: readonly Record[], payload: Buffer): Buffer {
	const names = records.map((record) => {
		const masked = Buffer.from(record.name, "latin1");
		for (let i = 0; i < masked.length; i += 1)
			masked[i] = (masked[i] ?? 0) ^ 0xff;
		const block = Buffer.alloc(4 + masked.length);
		block.writeInt32LE(masked.length, 0);
		masked.copy(block, 4);
		return block;
	});
	const indexSize =
		records.length * RECORD_SIZE + names.reduce((sum, b) => sum + b.length, 0);
	const dataStart = INDEX_START + indexSize;
	const archive = Buffer.alloc(dataStart + payload.length);
	archive.write("EPK ", 0, "latin1");
	archive.writeUInt32LE(indexSize + INDEX_START, 4);
	archive.writeInt32LE(records.length, 0x18);
	let nameCursor = INDEX_START + records.length * RECORD_SIZE;
	const nameOffsets: number[] = [];
	for (const block of names) {
		nameOffsets.push(nameCursor);
		nameCursor += block.length;
	}
	let cursor = INDEX_START;
	for (const [id, record] of records.entries()) {
		archive.writeUInt32LE(nameOffsets[id] ?? 0, cursor + 8);
		archive.writeBigInt64LE(BigInt(dataStart + record.offset), cursor + 0x10);
		archive.writeUInt32LE(record.size, cursor + 0x18);
		cursor += RECORD_SIZE;
	}
	for (const [id, block] of names.entries())
		block.copy(archive, nameOffsets[id] ?? 0);
	payload.copy(archive, dataStart);
	return archive;
}

describe("TamaSoft ADV system resource archive", () => {
	it("lists payloads from the archive and its parts", async () => {
		const payload = Buffer.from("MAINPAYLOAD13");
		const part = Buffer.from("PARTA_XYZ");
		const records: Record[] = [
			{ name: "alpha.bin", offset: 0, size: 4 },
			{ name: "beta.bin", offset: 4, size: 6 },
			// Reaches past the archive and continues at the start of the first part.
			{ name: "gamma.bin", offset: 10, size: 8 },
			// Lies entirely inside the first part, six bytes in.
			{ name: "delta.bin", offset: payload.length + 6, size: 3 },
		];
		await withCompanionFiles(
			"data.epk",
			{ "data.epk": buildEpk(records, payload), "data.e01": part },
			async (mainPath) => {
				await expectCompanionArchive({
					format: tamasoftEpkFormat,
					mainPath,
					entries: [
						{ path: "alpha.bin", size: 4, content: Buffer.from("MAIN") },
						{ path: "beta.bin", size: 6, content: Buffer.from("PAYLOA") },
						{
							path: "gamma.bin",
							size: 8,
							content: Buffer.from("D13PARTA"),
						},
						{ path: "delta.bin", size: 3, content: Buffer.from("XYZ") },
					],
					metadata: { entryCount: 4, partCount: 1 },
				});
			},
		);
	});

	it("decodes and normalizes names", async () => {
		const payload = Buffer.from("data");
		const records: Record[] = [{ name: "dir\\one.bin", offset: 0, size: 4 }];
		await withCompanionFiles(
			"data.epk",
			{ "data.epk": buildEpk(records, payload) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: tamasoftEpkFormat,
					mainPath,
					entries: [{ path: "dir/one.bin", size: 4, content: payload }],
					metadata: { entryCount: 1, partCount: 0 },
				});
			},
		);
	});

	it("stops collecting parts at the first gap", async () => {
		const payload = Buffer.from("MAIN");
		const records: Record[] = [{ name: "one.bin", offset: 0, size: 4 }];
		// The second part exists but cannot be reached, because the first one is missing.
		await withCompanionFiles(
			"data.epk",
			{
				"data.epk": buildEpk(records, payload),
				"data.e02": Buffer.from("UNREACHABLE"),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: tamasoftEpkFormat,
					mainPath,
					entries: [{ path: "one.bin", size: 4, content: payload }],
					metadata: { partCount: 0 },
				});
			},
		);
	});

	it("rejects a payload beyond every part", async () => {
		const records: Record[] = [{ name: "one.bin", offset: 0x2000, size: 4 }];
		const archive = buildEpk(records, Buffer.from("MAIN"));
		await expectDeclined("data.epk", archive);
	});

	it("rejects a name length outside the index", async () => {
		const records: Record[] = [{ name: "one.bin", offset: 0, size: 4 }];
		const archive = buildEpk(records, Buffer.from("MAIN"));
		const nameOffset = archive.readUInt32LE(INDEX_START + 8);
		archive.writeInt32LE(0, nameOffset);
		await expectDeclined("data.epk", archive);
	});

	it("rejects an insane entry count", async () => {
		const records: Record[] = [{ name: "one.bin", offset: 0, size: 4 }];
		const archive = buildEpk(records, Buffer.from("MAIN"));
		archive.writeInt32LE(0x1000, 0x18);
		await expectDeclined("data.epk", archive);
	});

	it("rejects an index that does not fit the file", async () => {
		const records: Record[] = [{ name: "one.bin", offset: 0, size: 4 }];
		const archive = buildEpk(records, Buffer.from("MAIN"));
		archive.writeUInt32LE(0x1000, 4);
		await expectDeclined("data.epk", archive);
	});

	it("rejects a wrong signature", async () => {
		const records: Record[] = [{ name: "one.bin", offset: 0, size: 4 }];
		const archive = buildEpk(records, Buffer.from("MAIN"));
		archive.write("XPK ", 0, "latin1");
		await expectDeclined("data.epk", archive);
	});
});

async function expectDeclined(
	mainName: string,
	archive: Buffer,
): Promise<void> {
	await withCompanionFiles(
		mainName,
		{ [mainName]: archive },
		async (mainPath) => {
			const source = await FileByteSource.open(mainPath);
			expect(await tamasoftEpkFormat.detect(source, mainPath)).toBe(false);
			await source.close();
		},
	);
}
