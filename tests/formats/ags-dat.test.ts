import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { animeGameSystemDatFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_START = 6;
const RECORD_SIZE = 0x18;

interface DatEntry {
	name: string;
	content: Buffer;
}

/** Lays out an archive whose payloads follow the index. */
function buildArchive(entries: readonly DatEntry[]): Buffer {
	const indexSize = entries.length * RECORD_SIZE;
	let running = INDEX_START + indexSize;
	const records: Buffer[] = [];
	for (const entry of entries) {
		const name = encodeCp932(entry.name);
		const record = Buffer.alloc(RECORD_SIZE);
		name.copy(record, 0, 0, 0x10);
		record.writeUInt32LE(running, 0x10);
		record.writeUInt32LE(entry.content.length, 0x14);
		records.push(record);
		running += entry.content.length;
	}
	const header = Buffer.alloc(INDEX_START);
	header.write("pack", 0, "latin1");
	header.writeInt16LE(entries.length, 4);
	return Buffer.concat([
		header,
		...records,
		...entries.map((entry) => entry.content),
	]);
}

describe("AnimeGameSystem DAT resource archive", () => {
	it("lists entries and returns their stored payloads", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload, longer");
		await expectArchive({
			format: animeGameSystemDatFormat,
			archive: buildArchive([
				{ name: "FIRST.BIN", content: first },
				{ name: "SECOND.BIN", content: second },
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "SECOND.BIN", size: second.length, content: second },
			],
		});
	});

	it("normalizes backslash paths", async () => {
		const content = Buffer.from("payload");
		await expectArchive({
			format: animeGameSystemDatFormat,
			archive: buildArchive([{ name: "DIR\\FILE.BIN", content }]),
			sourcePath: "sample.dat",
			entries: [{ path: "DIR/FILE.BIN", size: content.length, content }],
		});
	});

	it("stops names at the first null byte of their field", async () => {
		const content = Buffer.from("payload");
		const archive = buildArchive([{ name: "NAME.BIN", content }]);
		// Treat the field as padded: the reference reads only up to the null byte at offset eight.
		archive.write("ZZZZZZZ", INDEX_START + 9, "latin1");
		await expectArchive({
			format: animeGameSystemDatFormat,
			archive,
			sourcePath: "sample.dat",
			entries: [{ path: "NAME.BIN", size: content.length, content }],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildArchive([
			{ name: "A.BIN", content: Buffer.from("payload") },
		]);
		archive.write("pacx", 0, "latin1");
		expect(
			await animeGameSystemDatFormat.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});

	it("rejects an insane entry count", async () => {
		const archive = buildArchive([
			{ name: "A.BIN", content: Buffer.from("payload") },
		]);
		archive.writeInt16LE(0, 4);
		expect(
			await animeGameSystemDatFormat.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});

	it("rejects an index that reaches past the archive", async () => {
		const archive = buildArchive([
			{ name: "A.BIN", content: Buffer.from("payload") },
		]);
		archive.writeInt16LE(0x100, 4);
		expect(
			await animeGameSystemDatFormat.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const archive = buildArchive([
			{ name: "A.BIN", content: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x1000, INDEX_START + 0x10);
		expect(
			await animeGameSystemDatFormat.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});

	it("rejects an entry whose size runs past the archive", async () => {
		const archive = buildArchive([
			{ name: "A.BIN", content: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x1000, INDEX_START + 0x14);
		expect(
			await animeGameSystemDatFormat.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});

	it("rejects a file that is too small for its header", async () => {
		const archive = Buffer.from([1, 2, 3]);
		expect(
			await animeGameSystemDatFormat.detect(
				new BufferByteSource(archive),
				"sample.dat",
			),
		).toBe(false);
	});
});
