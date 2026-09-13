import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { maikaMk2Format } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

/** The header carries fields up to the entry count at 0x12. */
const HEADER_SIZE = 0x16;
/** Payloads follow the header, word aligned for clarity. */
const PAYLOAD_START = 0x20;

interface Entry {
	name: string;
	payload: Buffer;
}

interface BuildOptions {
	baseOffset?: number;
	id?: string;
	emptyGroups?: number;
	indexSize?: number;
	mutateRecords?: (records: Buffer) => void;
	/** Relative pointer of the terminator group; pointing it at the records keeps the walk going. */
	terminator?: number;
}

/** A payload behind the packed header: a signature, the inner size and the LZSS stream. */
function packedEntry(
	signature: "C1" | "E1",
	content: Buffer,
	scheme: "default" | "ar" = "default",
): Buffer {
	const packed = Buffer.from(literalLzssStream(content));
	if (signature === "E1") {
		// The stored prefix is scrambled, so the opener has to undo the same swaps.
		const pairs: readonly (readonly [number, number])[] =
			scheme === "ar"
				? [
						[7, 13],
						[9, 14],
					]
				: [
						[7, 11],
						[9, 12],
					];
		for (const [left, right] of pairs) {
			const value = packed[left] ?? 0;
			packed[left] = packed[right] ?? 0;
			packed[right] = value;
		}
	}
	const payload = Buffer.alloc(10 + packed.length);
	payload.write(signature, 0, "ascii");
	payload.writeUInt32LE(packed.length, 2);
	packed.copy(payload, 10);
	return payload;
}

/**
 * Builds an MK2 archive: the header, the payloads, then an index of group headers whose records carry
 * payload offsets relative to the header's base offset, stored sizes and one byte name lengths. The
 * group table ends with a pointer word that reads minus one.
 */
function buildMk2(
	entries: readonly Entry[],
	options: BuildOptions = {},
): Buffer {
	const id = options.id ?? "MK2.0";
	const baseOffset = options.baseOffset ?? 0;
	const payloadStart = PAYLOAD_START + baseOffset;
	const payloadSize = entries.reduce(
		(total, entry) => total + entry.payload.length,
		0,
	);
	const indexOffset = payloadStart + payloadSize;

	const records = Buffer.concat(
		entries.map((entry) => {
			const name = encodeCp932(entry.name);
			const record = Buffer.alloc(9 + name.length);
			name.copy(record, 9);
			record.writeUInt8(name.length, 8);
			return record;
		}),
	);
	// Payload offsets are stored relative to the base offset.
	let running = payloadStart;
	let recordOffset = 0;
	for (const entry of entries) {
		records.writeUInt32LE((running - baseOffset) >>> 0, recordOffset);
		records.writeUInt32LE(entry.payload.length, recordOffset + 4);
		running += entry.payload.length;
		recordOffset += 9 + encodeCp932(entry.name).length;
	}
	options.mutateRecords?.(records);

	const emptyGroups = options.emptyGroups ?? 1;
	const recordBase = 6 * (2 + emptyGroups);
	// The terminator group is an empty group whose resolved pointer holds a minus one word, so the
	// table ends with that word after the records.
	const terminatorWord = recordBase + records.length;
	const groupTable = Buffer.alloc(terminatorWord + 4);
	groupTable.writeUInt32LE(recordBase, 0);
	groupTable.writeUInt16LE(entries.length, 4);
	// Empty groups are skipped: their pointer word is only read when their record count is zero.
	for (let index = 0; index < emptyGroups; index += 1) {
		const at = 6 * (1 + index);
		groupTable.writeUInt32LE(recordBase, at);
		groupTable.writeUInt16LE(0, at + 4);
	}
	groupTable.writeUInt32LE(
		options.terminator ?? terminatorWord,
		6 * (1 + emptyGroups),
	);
	groupTable.writeInt32LE(-1, terminatorWord);
	records.copy(groupTable, recordBase);

	options.mutateRecords?.(records);

	const archive = Buffer.alloc(indexOffset + groupTable.length);
	const header = Buffer.alloc(HEADER_SIZE);
	header.write(`${id}\0`, 0, "latin1");
	header.writeUInt16LE(baseOffset, 8);
	header.writeUInt32LE(options.indexSize ?? groupTable.length, 0x0a);
	header.writeUInt32LE(indexOffset, 0x0e);
	header.writeInt32LE(entries.length, 0x12);
	header.copy(archive, 0);
	let payloadOffset = payloadStart;
	for (const entry of entries) {
		entry.payload.copy(archive, payloadOffset);
		payloadOffset += entry.payload.length;
	}
	groupTable.copy(archive, indexOffset);
	return archive;
}

describe("MAIKA MK2 resource archive", () => {
	it("lists entries from the group index and extracts stored payloads", async () => {
		const first = Buffer.from("stored payload");
		const second = Buffer.from("second stored payload");
		await expectArchive({
			format: maikaMk2Format,
			archive: buildMk2([
				{ name: "FIRST.BIN", payload: first },
				{ name: "DIR\\SECOND.BIN", payload: second },
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "DIR/SECOND.BIN", size: second.length, content: second },
			],
		});
	});

	it("decodes LZSS and E1 scrambled payloads", async () => {
		const plain = Buffer.from("plain payload");
		const lzssOutput = Buffer.from("ordinary compressed payload");
		const e1Output = Buffer.from("scrambled E1 payload");
		await expectArchive({
			format: maikaMk2Format,
			archive: buildMk2([
				{ name: "PLAIN.BIN", payload: plain },
				{ name: "LZSS.BIN", payload: packedEntry("C1", lzssOutput) },
				{ name: "E1.BIN", payload: packedEntry("E1", e1Output) },
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "PLAIN.BIN", size: plain.length, content: plain },
				{
					// A compressed entry's output size is only known once it has been decoded, so the
					// listing reports the stored size.
					path: "LZSS.BIN",
					size: packedEntry("C1", lzssOutput).length,
					content: lzssOutput,
				},
				{
					path: "E1.BIN",
					size: packedEntry("E1", e1Output).length,
					content: e1Output,
				},
			],
		});
	});

	it("applies the larger scheme to the AR2.0 archive id", async () => {
		const content = Buffer.from("payload scrambled with the larger scheme");
		// An AR2.0 archive scrambles its stored prefix with the larger pair set.
		const payload = packedEntry("E1", content, "ar");
		await expectArchive({
			format: maikaMk2Format,
			archive: buildMk2([{ name: "E1.BIN", payload }], { id: "AR2.0" }),
			sourcePath: "ar20.dat",
			entries: [{ path: "E1.BIN", size: payload.length, content }],
		});
	});

	it("moves payloads by the base offset", async () => {
		const content = Buffer.from("payload behind a base offset");
		await expectArchive({
			format: maikaMk2Format,
			archive: buildMk2([{ name: "BASE.BIN", payload: content }], {
				baseOffset: 0x20,
			}),
			sourcePath: "sample.dat",
			entries: [{ path: "BASE.BIN", size: content.length, content }],
		});
	});

	it("stops the walk at the group cap when no terminator follows", async () => {
		const content = Buffer.from("payload after many empty groups");
		// The terminator group points at the records instead of the minus one word, so the walk never
		// ends and only the 512 group cap stops it.
		const archive = buildMk2([{ name: "CAP.BIN", payload: content }], {
			emptyGroups: 511,
			terminator: 6 * 513,
		});
		await expectArchive({
			format: maikaMk2Format,
			archive,
			sourcePath: "sample.dat",
			entries: [{ path: "CAP.BIN", size: content.length, content }],
		});
	});

	it("rejects an unknown archive id", async () => {
		const archive = buildMk2(
			[{ name: "A.BIN", payload: Buffer.from("payload") }],
			{ id: "XX2.0" },
		);
		expect(
			await maikaMk2Format.detect(new BufferByteSource(archive), "sample.dat"),
		).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildMk2([
			{ name: "A.BIN", payload: Buffer.from("payload") },
		]);
		archive.writeInt32LE(0, 0x12);
		expect(
			await maikaMk2Format.detect(new BufferByteSource(archive), "sample.dat"),
		).toBe(false);
	});

	it("rejects an index that reaches past the archive", async () => {
		const archive = buildMk2([
			{ name: "A.BIN", payload: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x10000, 0x0a);
		expect(
			await maikaMk2Format.detect(new BufferByteSource(archive), "sample.dat"),
		).toBe(false);
	});

	it("rejects an index offset past the archive", async () => {
		const archive = buildMk2([
			{ name: "A.BIN", payload: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x10000, 0x0e);
		expect(
			await maikaMk2Format.detect(new BufferByteSource(archive), "sample.dat"),
		).toBe(false);
	});

	it("rejects a record without a name", async () => {
		const archive = buildMk2(
			[{ name: "A.BIN", payload: Buffer.from("payload") }],
			{ mutateRecords: (records) => records.writeUInt8(0, 8) },
		);
		expect(
			await maikaMk2Format.detect(new BufferByteSource(archive), "sample.dat"),
		).toBe(false);
	});

	it("rejects a payload that crosses the index", async () => {
		const archive = buildMk2(
			[{ name: "A.BIN", payload: Buffer.from("payload") }],
			{ mutateRecords: (records) => records.writeUInt32LE(0x1000, 4) },
		);
		expect(
			await maikaMk2Format.detect(new BufferByteSource(archive), "sample.dat"),
		).toBe(false);
	});

	it("rejects a file too small for its header", async () => {
		expect(
			await maikaMk2Format.detect(
				new BufferByteSource(Buffer.alloc(8)),
				"sample.dat",
			),
		).toBe(false);
	});
});
