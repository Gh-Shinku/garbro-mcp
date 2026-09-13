import { BufferByteSource } from "@garbro-mcp/core";
import { xuseArcFormat, xuseKotoriFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const MIKO_INDEX_OFFSET = 0x24;
const MIKO_INDEX_MARKER_SIZE = 6;
const MIKO_RECORD_SIZE = 8;
const MIKO_NAME_FIELD = 0xa;
const MIKO_NAME_KEY = 0x56;
const MIKO_CADR_RECORD_SIZE = 12;
const MIKO_DATA_OFFSET = 0x1e;
const KOTORI_INDEX_OFFSET = 0x18;
const KOTORI_RECORD_SIZE = 6;
const KOTORI_HEADER_SIZE = 0x32;
const KOTORI_KEY_SIZE = 0x10;

interface MikoSpec {
	name: string;
	payload: Buffer;
}

/** Lays out a MIKO archive: header, index, name records, CADR table, then the DATA payloads. */
function buildMiko(specs: readonly MikoSpec[], signature = "MIKO"): Buffer {
	const indexStart = MIKO_INDEX_OFFSET + MIKO_INDEX_MARKER_SIZE;
	const namesStart = indexStart + MIKO_RECORD_SIZE * specs.length;
	const nameRecords = specs.map((spec) => {
		const encoded = Buffer.from(spec.name, "latin1");
		for (let index = 0; index < encoded.length; index += 1)
			encoded[index] = (encoded[index] ?? 0) ^ MIKO_NAME_KEY;
		const record = Buffer.alloc(MIKO_NAME_FIELD + encoded.length);
		record.writeUInt16LE(0x1001, 0);
		record.writeUInt16LE(encoded.length, 6);
		encoded.copy(record, MIKO_NAME_FIELD);
		return record;
	});
	const nameOffsets: number[] = [namesStart + 4];
	for (const record of nameRecords.slice(0, -1))
		nameOffsets.push(
			(nameOffsets[nameOffsets.length - 1] ?? 0) + record.length,
		);
	const cadrOffset =
		namesStart + 4 + nameRecords.reduce((total, r) => total + r.length, 0);
	const cadrSize = 4 + MIKO_CADR_RECORD_SIZE * specs.length;
	const payloadOffsets: number[] = [cadrOffset + cadrSize];
	for (const spec of specs.slice(0, -1))
		payloadOffsets.push(
			(payloadOffsets[payloadOffsets.length - 1] ?? 0) +
				MIKO_DATA_OFFSET +
				spec.payload.length,
		);
	const header = Buffer.alloc(MIKO_INDEX_OFFSET + MIKO_INDEX_MARKER_SIZE, 0);
	header.write(signature, 0, "latin1");
	header.writeUInt16LE(0x1001, 0xa);
	header.writeInt32LE(0, 0xc);
	header.writeInt32LE(specs.length, 0x10);
	header.write("DFNM", 0x16, "latin1");
	header.writeBigInt64LE(BigInt(cadrOffset), 0x1a);
	header.write("NDIX", MIKO_INDEX_OFFSET, "latin1");
	const index = Buffer.alloc(MIKO_RECORD_SIZE * specs.length);
	for (const [id, nameOffset] of nameOffsets.entries())
		index.writeUInt32LE(nameOffset, id * MIKO_RECORD_SIZE);
	const cadr = Buffer.alloc(cadrSize);
	cadr.write("CADR", 0, "latin1");
	for (const [id, offset] of payloadOffsets.entries())
		cadr.writeBigInt64LE(BigInt(offset), 4 + id * MIKO_CADR_RECORD_SIZE);
	const payloads = specs.map((spec) => {
		const record = Buffer.alloc(MIKO_DATA_OFFSET + spec.payload.length);
		record.write("DATA", 0, "latin1");
		record.writeUInt32LE(spec.payload.length, 0x18);
		spec.payload.copy(record, MIKO_DATA_OFFSET);
		return record;
	});
	return Buffer.concat([
		header,
		index,
		Buffer.from("CTIF", "latin1"),
		...nameRecords,
		cadr,
		...payloads,
	]);
}

interface KotoriSpec {
	payload: Buffer;
	keyed: boolean;
}

function buildKotori(specs: readonly KotoriSpec[]): Buffer {
	const tableSize = KOTORI_RECORD_SIZE * specs.length;
	const records = specs.map((spec) => {
		if (!spec.keyed) return spec.payload;
		const key = Buffer.alloc(KOTORI_KEY_SIZE);
		for (let index = 0; index < KOTORI_KEY_SIZE; index += 1)
			key[index] = (index * 7 + 3) & 0xff;
		const record = Buffer.alloc(KOTORI_HEADER_SIZE + spec.payload.length);
		record.write("KOTORi", 0, "latin1");
		record.writeInt32LE(0x001a1a00, 6);
		record.writeInt32LE(0x0100a618, 0x10);
		key.copy(record, 0x20);
		for (const [index, byte] of spec.payload.entries())
			record[KOTORI_HEADER_SIZE + index] =
				byte ^ (key[index % KOTORI_KEY_SIZE] ?? 0);
		return record;
	});
	const header = Buffer.alloc(KOTORI_INDEX_OFFSET, 0);
	header.write("KOTORI", 0, "latin1");
	header.writeInt32LE(0x1a1a00, 6);
	header.writeInt32LE(0x0100a618, 0x10);
	header.writeUInt16LE(specs.length, 0x14);
	const table = Buffer.alloc(tableSize);
	let offset = KOTORI_INDEX_OFFSET + tableSize;
	for (const [id, record] of records.entries()) {
		table.writeUInt32LE(offset, id * KOTORI_RECORD_SIZE);
		offset += record.length;
	}
	return Buffer.concat([header, table, ...records]);
}

describe("Xuse resource archive", () => {
	it("reads miko index records", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		await expectArchive({
			format: xuseArcFormat,
			sourcePath: "data.arc",
			archive: buildMiko([
				{ name: "first.dat", payload: first },
				{ name: "second.dat", payload: second },
			]),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("accepts the xarc marker", async () => {
		const payload = Buffer.from("xarc payload");
		await expectArchive({
			format: xuseArcFormat,
			sourcePath: "data.arc",
			archive: buildMiko([{ name: "only.dat", payload }], "XARC"),
			entries: [{ path: "only.dat", size: payload.length, content: payload }],
		});
	});

	it("rejects a miko archive with a foreign data marker", async () => {
		const file = buildMiko([
			{ name: "only.dat", payload: Buffer.from("payload") },
		]);
		file.write("DATE", file.indexOf("DATA", 0, "latin1"), "latin1");
		expect(
			await xuseArcFormat.detect(new BufferByteSource(file), "a.arc"),
		).toBe(false);
	});

	it("rejects a miko archive without the ctif marker", async () => {
		const file = buildMiko([
			{ name: "only.dat", payload: Buffer.from("payload") },
		]);
		file.write("CTIG", file.indexOf("CTIF", 0, "latin1"), "latin1");
		expect(
			await xuseArcFormat.detect(new BufferByteSource(file), "a.arc"),
		).toBe(false);
	});

	it("rejects a miko archive with an unsupported mode", async () => {
		const file = buildMiko([
			{ name: "only.dat", payload: Buffer.from("payload") },
		]);
		file.writeInt32LE(1, 0xc);
		expect(
			await xuseArcFormat.detect(new BufferByteSource(file), "a.arc"),
		).toBe(false);
	});
});

describe("Xuse audio archive", () => {
	it("keys records that carry the audio marker", async () => {
		const first = Buffer.alloc(0x40, 0x41);
		const second = Buffer.alloc(0x50, 0x42);
		await expectArchive({
			format: xuseKotoriFormat,
			sourcePath: "sound.bin",
			archive: buildKotori([
				{ payload: first, keyed: true },
				{ payload: second, keyed: true },
			]),
			entries: [
				{ path: "sound#0000.ogg", size: first.length, content: first },
				{ path: "sound#0001.ogg", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("passes through records without the marker", async () => {
		// The record is longer than the audio header, so the reference still subtracts it from the size.
		const payload = Buffer.alloc(0x40, 0x43);
		await expectArchive({
			format: xuseKotoriFormat,
			sourcePath: "sound.bin",
			archive: buildKotori([{ payload, keyed: false }]),
			entries: [
				{ path: "sound#0000.ogg", size: 0x40 - 0x32, content: payload },
			],
		});
	});

	it("sizes the last record to the end of the file", async () => {
		const first = Buffer.alloc(0x40, 0x44);
		const second = Buffer.alloc(0x40, 0x45);
		const archive = await xuseKotoriFormat.open(
			new BufferByteSource(
				buildKotori([
					{ payload: first, keyed: true },
					{ payload: second, keyed: true },
				]),
			),
			"sound.bin",
		);
		expect(archive.entries.map((entry) => entry.size)).toEqual([
			BigInt(first.length),
			BigInt(second.length),
		]);
	});

	it("rejects a wrong archive marker", async () => {
		const file = buildKotori([{ payload: Buffer.from("audio"), keyed: true }]);
		file.writeInt32LE(0x1a1a01, 6);
		expect(
			await xuseKotoriFormat.detect(new BufferByteSource(file), "a.bin"),
		).toBe(false);
	});

	it("rejects a wrong header code", async () => {
		const file = buildKotori([{ payload: Buffer.from("audio"), keyed: true }]);
		file.writeInt32LE(0x0100a619, 0x10);
		expect(
			await xuseKotoriFormat.detect(new BufferByteSource(file), "a.bin"),
		).toBe(false);
	});

	it("rejects a record that leaves the file", async () => {
		const file = buildKotori([{ payload: Buffer.from("audio"), keyed: true }]);
		file.writeUInt32LE(0x1000, KOTORI_INDEX_OFFSET);
		expect(
			await xuseKotoriFormat.detect(new BufferByteSource(file), "a.bin"),
		).toBe(false);
	});
});
