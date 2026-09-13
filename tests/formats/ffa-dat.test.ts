import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { ffaDatFormat, ffaJdatFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { literalLzssStream } from "../helpers/lzss.js";

const LST_RECORD_SIZE = 0x16;
const PACKED_HEADER_SIZE = 8;
const V2_RECORD_SIZE = 0x34;

interface DatRecord {
	name: string;
	payload: Buffer;
}

/** Builds the `.lst` companion of a version-one archive. */
function buildLst(
	records: readonly { name: string; offset: number; size: number }[],
): Buffer {
	const list = Buffer.alloc(records.length * LST_RECORD_SIZE);
	for (const [id, record] of records.entries()) {
		const record0 = id * LST_RECORD_SIZE;
		list.write(record.name, record0, "latin1");
		list.writeUInt32LE(record.offset, record0 + 14);
		list.writeUInt32LE(record.size, record0 + 18);
	}
	return list;
}

/** Builds an archive with its `.lst` companion, whose records point at the payloads behind the header. */
function buildDat(records: readonly DatRecord[]): {
	archive: Buffer;
	list: Buffer;
} {
	const header = Buffer.alloc(4);
	const payloads: Buffer[] = [];
	const listRecords: { name: string; offset: number; size: number }[] = [];
	let offset = 4;
	for (const record of records) {
		listRecords.push({
			name: record.name,
			offset,
			size: record.payload.length,
		});
		payloads.push(record.payload);
		offset += record.payload.length;
	}
	return {
		archive: Buffer.concat([header, ...payloads]),
		list: buildLst(listRecords),
	};
}

/** Wraps content in the two-length header the packed entries carry. */
function packHeader(content: Buffer): Buffer {
	const head = Buffer.alloc(PACKED_HEADER_SIZE);
	const stream = literalLzssStream(content);
	head.writeInt32LE(stream.length, 0);
	head.writeInt32LE(content.length, 4);
	return Buffer.concat([head, stream]);
}

interface V2Record {
	name: string;
	payload: Buffer;
}

/** Builds a version-two archive with its index behind the payloads. */
function buildJdat(records: readonly V2Record[]): Buffer {
	// Payload offsets are stored four bytes low, so the payloads start behind that gap.
	const firstPayload = 4;
	const indexOffset =
		firstPayload + records.reduce((sum, r) => sum + r.payload.length, 0);
	const index = Buffer.alloc(records.length * V2_RECORD_SIZE);
	let offset = firstPayload;
	const payloads: Buffer[] = [];
	for (const [id, record] of records.entries()) {
		const record0 = id * V2_RECORD_SIZE;
		index.write(record.name, record0, "latin1");
		// Payload offsets are recorded four bytes low.
		index.writeUInt32LE(offset - 4, record0 + 0x20);
		index.writeUInt32LE(record.payload.length, record0 + 0x24);
		payloads.push(record.payload);
		offset += record.payload.length;
	}
	const head = Buffer.alloc(firstPayload);
	head.writeUInt32LE(indexOffset, 0);
	return Buffer.concat([head, ...payloads, index]);
}

describe("FFA System DAT resource archive", () => {
	it("reads a lst-indexed archive and unpacks so4 entries", async () => {
		const content = Buffer.from("packed so4 payload");
		const raw = Buffer.from("stored payload bytes");
		const { archive, list } = buildDat([
			{ name: "TEXT.SO4", payload: packHeader(content) },
			{ name: "DATA.BIN", payload: raw },
		]);
		await withCompanionFiles(
			"DATA.DAT",
			{ "DATA.DAT": archive, "DATA.lst": list },
			async (mainPath) => {
				await expectCompanionArchive({
					format: ffaDatFormat,
					mainPath,
					entries: [
						{ path: "TEXT.SO4", size: content.length, content },
						{ path: "DATA.BIN", size: raw.length, content: raw },
					],
				});
			},
		);
	});

	it("keeps an so4 entry stored when its header is inconsistent", async () => {
		const payload = Buffer.concat([
			Buffer.from([0x00, 0x10, 0x00, 0x00, 0x00, 0x08, 0x00, 0x00]),
			Buffer.from("trailing bytes"),
		]);
		const { archive, list } = buildDat([{ name: "BAD.SO4", payload }]);
		await withCompanionFiles(
			"DATA.DAT",
			{ "DATA.DAT": archive, "DATA.lst": list },
			async (mainPath) => {
				await expectCompanionArchive({
					format: ffaDatFormat,
					mainPath,
					entries: [
						{ path: "BAD.SO4", size: payload.length, content: payload },
					],
				});
			},
		);
	});

	it("rejects an archive without a companion index", async () => {
		const { archive } = buildDat([
			{ name: "DATA.BIN", payload: Buffer.alloc(8, 0x41) },
		]);
		await withCompanionFiles(
			"DATA.DAT",
			{ "DATA.DAT": archive },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await ffaDatFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});

	it("rejects an index whose length does not divide into records", async () => {
		const { archive, list } = buildDat([
			{ name: "DATA.BIN", payload: Buffer.alloc(8, 0x41) },
		]);
		const padded = Buffer.concat([list, Buffer.alloc(3)]);
		await withCompanionFiles(
			"DATA.DAT",
			{ "DATA.DAT": archive, "DATA.lst": padded },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await ffaDatFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});
});

describe("FFA System JDAT resource archive", () => {
	it("reads a trailing index and unpacks so5 entries", async () => {
		const content = Buffer.from("packed so5 payload");
		const raw = Buffer.from("stored payload");
		const archive = buildJdat([
			{ name: "IMAGE.SO5", payload: packHeader(content) },
			{ name: "DATA.BIN", payload: raw },
		]);
		await expectArchive({
			format: ffaJdatFormat,
			archive,
			sourcePath: "/games/DATA.DAT",
			entries: [
				{ path: "IMAGE.SO5", size: content.length, content },
				{ path: "DATA.BIN", size: raw.length, content: raw },
			],
		});
	});

	it("rejects an index offset outside the archive", async () => {
		const archive = buildJdat([
			{ name: "DATA.BIN", payload: Buffer.alloc(8, 0x41) },
		]);
		archive.writeUInt32LE(archive.length + 0x100, 0);
		const source = new BufferByteSource(archive);
		expect(await ffaJdatFormat.detect(source, "/games/DATA.DAT")).toBe(false);
	});

	it("rejects an index whose length does not divide into records", async () => {
		const archive = buildJdat([
			{ name: "DATA.BIN", payload: Buffer.alloc(8, 0x41) },
		]);
		const indexOffset = archive.readUInt32LE(0);
		archive.writeUInt32LE(indexOffset + 2, 0);
		const source = new BufferByteSource(archive);
		expect(await ffaJdatFormat.detect(source, "/games/DATA.DAT")).toBe(false);
	});

	it("rejects a payload that falls outside the archive", async () => {
		const archive = buildJdat([
			{ name: "DATA.BIN", payload: Buffer.alloc(8, 0x41) },
		]);
		const indexOffset = archive.readUInt32LE(0);
		archive.writeUInt32LE(0x1000, indexOffset + 0x24);
		const source = new BufferByteSource(archive);
		expect(await ffaJdatFormat.detect(source, "/games/DATA.DAT")).toBe(false);
	});
});
