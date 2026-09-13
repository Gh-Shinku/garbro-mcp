import { deflateSync } from "node:zlib";
import { FileByteSource } from "@garbro-mcp/core";
import { pspQpkFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

const INDEX_HEADER_SIZE = 0x1c;
const RECORD_SIZE = 8;
const PACKED_FLAG = 0x40000000;
const SKIP_FLAG = 0x80000000;

interface Record {
	/** Raw 32-bit index field: flags in the top bits, unpacked size in the low 30. */
	flags: number;
	payload: Buffer;
}

/** Packs payloads back to back and writes the sibling index with the reference's layout. */
function buildPair(entries: readonly Record[]): {
	archive: Buffer;
	index: Buffer;
} {
	const archive = Buffer.alloc(
		4 + entries.reduce((total, entry) => total + entry.payload.length, 0),
	);
	archive.write("QPK\0", 0, "ascii");
	const index = Buffer.alloc(INDEX_HEADER_SIZE + entries.length * RECORD_SIZE);
	index.write("QPI\0", 0, "ascii");
	index.writeInt32LE(entries.length, 4);
	let offset = 4;
	for (const [position, entry] of entries.entries()) {
		entry.payload.copy(archive, offset);
		const record = INDEX_HEADER_SIZE + position * RECORD_SIZE;
		index.writeUInt32LE(offset, record);
		index.writeUInt32LE(entry.flags >>> 0, record + 4);
		offset += entry.payload.length;
	}
	return { archive, index };
}

describe("PSP QPK resource archive", () => {
	it("reads a companion QPI index and decodes CZL entries", async () => {
		const raw = Buffer.from("verbatim payload");
		const unpacked = Buffer.from("deflate compressed payload");
		const compressed = deflateSync(unpacked);
		const payload = (() => {
			const container = Buffer.alloc(12 + compressed.length);
			container.write("CZL\0", 0, "ascii");
			container.writeUInt32LE(compressed.length, 4);
			compressed.copy(container, 12);
			return container;
		})();
		const { archive, index } = buildPair([
			{ flags: raw.length, payload: raw },
			{ flags: PACKED_FLAG | unpacked.length, payload },
		]);

		await withCompanionFiles(
			"sample.qpk",
			{ "sample.QPI": index, "sample.qpk": archive },
			async (mainPath) => {
				await expectCompanionArchive({
					format: pspQpkFormat,
					mainPath,
					metadata: { entryCount: 2 },
					entries: [
						{ path: "sample#00000", size: raw.length, content: raw },
						{ path: "sample#00001", size: unpacked.length, content: unpacked },
					],
				});
			},
		);
	});

	it("skips flagged and empty records and types TGA archives as images", async () => {
		const kept = Buffer.from("kept");
		const skipped = Buffer.from("skipped");
		const empty = Buffer.from("empty");
		const { archive, index } = buildPair([
			{ flags: SKIP_FLAG | skipped.length, payload: skipped },
			{ flags: 0, payload: empty },
			{ flags: kept.length, payload: kept },
		]);

		await withCompanionFiles(
			"TGA.qpk",
			{ "TGA.QPI": index, "TGA.qpk": archive },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				const listing = await pspQpkFormat.open(source, mainPath);
				try {
					expect(listing.entries.map((entry) => entry.path)).toEqual([
						"TGA#00002.tga",
					]);
					expect(listing.entries[0]?.metadata).toEqual({ type: "image" });
					expect(listing.metadata).toEqual({ entryCount: 1 });
				} finally {
					await listing.close();
				}
			},
		);
	});

	it("rejects an archive without a companion index", async () => {
		const { archive } = buildPair([{ flags: 1, payload: Buffer.from("x") }]);
		await withCompanionFiles(
			"missing.qpk",
			{ "missing.qpk": archive },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await pspQpkFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});

	it("rejects an index with a foreign signature", async () => {
		const { archive, index } = buildPair([
			{ flags: 1, payload: Buffer.from("x") },
		]);
		index.write("XXX\0", 0, "ascii");
		await withCompanionFiles(
			"other.qpk",
			{ "other.QPI": index, "other.qpk": archive },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await pspQpkFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});
});
