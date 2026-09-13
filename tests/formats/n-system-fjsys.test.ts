import { BufferByteSource } from "@garbro-mcp/core";
import { fjsysFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x54;
const RECORD_SIZE = 0x10;

interface EntrySpec {
	name: string;
	payload: Buffer;
}

/** Lays out the header, the name blob, the record table and the payloads. */
function buildFjsys(entries: readonly EntrySpec[], offsetWidth = 8): Buffer {
	const names: number[] = [];
	const records = Buffer.alloc(entries.length * RECORD_SIZE);
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("FJSYS", 0, "latin1");
	let cursor = HEADER_SIZE + records.length + 0;
	// The name blob sits directly behind the table; its size is known before the blob is built.
	const nameOffsets: number[] = [];
	for (const entry of entries) {
		nameOffsets.push(names.length);
		for (const byte of Buffer.from(entry.name, "latin1")) names.push(byte);
		names.push(0);
	}
	const namesSize = names.length;
	cursor += namesSize;
	const payloads: Buffer[] = [];
	for (const [id, entry] of entries.entries()) {
		const record = id * RECORD_SIZE;
		records.writeInt32LE(nameOffsets[id] ?? 0, record);
		records.writeUInt32LE(entry.payload.length, record + 4);
		if (offsetWidth === 8) records.writeBigInt64LE(BigInt(cursor), record + 8);
		else records.writeUInt32LE(cursor, record + 8);
		payloads.push(entry.payload);
		cursor += entry.payload.length;
	}
	header.writeUInt32LE(namesSize, 0xc);
	header.writeInt32LE(entries.length, 0x10);
	return Buffer.concat([header, records, Buffer.from(names), ...payloads]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	expect(
		await fjsysFormat.detect(new BufferByteSource(file), "sample.bin"),
	).toBe(false);
}

describe("NSystem engine resource archive", () => {
	it("lists entries with offsets from the name blob", async () => {
		const first = Buffer.from("first payload bytes");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: fjsysFormat,
			sourcePath: "sample.bin",
			archive: buildFjsys([
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

	it("marks scripts with the script type", async () => {
		const file = buildFjsys([
			{ name: "scene.msd", payload: Buffer.from("script bytes") },
			{ name: "image.dat", payload: Buffer.from("payload") },
		]);
		const archive = await fjsysFormat.open(
			new BufferByteSource(file),
			"sample.bin",
		);
		expect(archive.entries.map((entry) => entry.metadata?.type)).toEqual([
			"script",
			"data",
		]);
	});

	it("normalizes a name with a backslash", async () => {
		const payload = Buffer.from("nested payload");
		await expectArchive({
			format: fjsysFormat,
			sourcePath: "sample.bin",
			archive: buildFjsys([{ name: "dir\\nested.dat", payload }]),
			entries: [
				{ path: "dir/nested.dat", size: payload.length, content: payload },
			],
		});
	});

	it("rejects a file without the version byte", async () => {
		const file = buildFjsys([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.write("FJZYS", 0, "latin1");
		await expectDeclined(file);
	});

	it("rejects an archive without a usable count", async () => {
		const file = buildFjsys([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeInt32LE(0, 0x10);
		await expectDeclined(file);
	});

	it("rejects an index that leaves the file", async () => {
		const file = buildFjsys([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeInt32LE(0x400, 0x10);
		await expectDeclined(file);
	});

	it("rejects a name blob that leaves the file", async () => {
		const file = buildFjsys([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeUInt32LE(0x1000, 0xc);
		await expectDeclined(file);
	});

	it("rejects a name offset behind the blob", async () => {
		const file = buildFjsys([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeInt32LE(0x1000, HEADER_SIZE);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildFjsys([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeUInt32LE(file.length, HEADER_SIZE + 4);
		await expectDeclined(file);
	});
});
