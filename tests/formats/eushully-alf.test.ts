import { FileByteSource } from "@garbro-mcp/core";
import { eushullyAlfFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { literalLzssStream } from "../helpers/lzss.js";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

const ARCHIVE_NAME_SIZE = 0x100;
const FILE_NAME_SIZE = 0x40;
const PLAIN_OFFSET = 0x12c;
const PACKED_OFFSET = 0x134;
const APPEND_OFFSET = 0x114;

interface FileRecord {
	name: string;
	archive: number;
	offset: number;
	size: number;
}

/** Builds the unpacked index body: the archive table and the file table. */
function buildSysIni(
	archiveNames: readonly string[],
	files: readonly FileRecord[],
): Buffer {
	const body = Buffer.alloc(
		4 +
			archiveNames.length * ARCHIVE_NAME_SIZE +
			4 +
			files.length * (FILE_NAME_SIZE + 16),
	);
	body.writeInt32LE(archiveNames.length, 0);
	let cursor = 4;
	for (const name of archiveNames) {
		body.write(name, cursor, "latin1");
		cursor += ARCHIVE_NAME_SIZE;
	}
	body.writeInt32LE(files.length, cursor);
	cursor += 4;
	for (const file of files) {
		body.write(file.name, cursor, "latin1");
		body.writeInt32LE(file.archive, cursor + FILE_NAME_SIZE);
		body.writeInt32LE(0, cursor + FILE_NAME_SIZE + 4);
		body.writeUInt32LE(file.offset, cursor + FILE_NAME_SIZE + 8);
		body.writeUInt32LE(file.size, cursor + FILE_NAME_SIZE + 12);
		cursor += FILE_NAME_SIZE + 16;
	}
	return body;
}

/** Wraps an index body in one of the three container layouts. */
function buildIndex(
	magic: "S3IN" | "S3IC" | "S4IC" | "S4AC",
	body: Buffer,
): Buffer {
	const offset =
		magic === "S3IN"
			? PLAIN_OFFSET
			: magic === "S4AC"
				? APPEND_OFFSET
				: PACKED_OFFSET;
	if (magic === "S3IN") {
		const ini = Buffer.alloc(offset + body.length);
		ini.write(magic, 0, "latin1");
		body.copy(ini, offset);
		return ini;
	}
	const packed = literalLzssStream(body);
	const ini = Buffer.alloc(offset + 4 + packed.length);
	ini.write(magic, 0, "latin1");
	ini.writeUInt32LE(packed.length, offset);
	packed.copy(ini, offset + 4);
	return ini;
}

describe("Eushully resource archive", () => {
	it("lists only this archive's entries behind a plain index", async () => {
		const first = Buffer.from("first eushully payload");
		const second = Buffer.from("second eushully payload, longer");
		const other = Buffer.from("payload of another archive");
		const archive = Buffer.concat([first, second]);
		const index = buildSysIni(
			["data.alf", "other.alf"],
			[
				{ name: "one.agf", archive: 0, offset: 0, size: first.length },
				{
					name: "two.agf",
					archive: 0,
					offset: first.length,
					size: second.length,
				},
				{ name: "elsewhere.agf", archive: 1, offset: 0, size: other.length },
				{ name: "@", archive: 0, offset: 0, size: 4 },
			],
		);
		await withCompanionFiles(
			"data.alf",
			{ "data.alf": archive, "sys3ini.bin": buildIndex("S3IN", index) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: eushullyAlfFormat,
					mainPath,
					entries: [
						{ path: "one.agf", size: first.length, content: first },
						{ path: "two.agf", size: second.length, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("reads the APPEND layout", async () => {
		const content = Buffer.from("append layout payload");
		const index = buildSysIni(
			["data.alf"],
			[{ name: "one.agf", archive: 0, offset: 0, size: content.length }],
		);
		await withCompanionFiles(
			"data.alf",
			{ "data.alf": content, "sys4ini.bin": buildIndex("S4AC", index) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: eushullyAlfFormat,
					mainPath,
					entries: [{ path: "one.agf", size: content.length, content }],
				});
			},
		);
	});

	it("reads an LZSS-packed index", async () => {
		const content = Buffer.from("packed index payload");
		const index = buildSysIni(
			["data.alf"],
			[{ name: "one.agf", archive: 0, offset: 0, size: content.length }],
		);
		await withCompanionFiles(
			"data.alf",
			{ "data.alf": content, "sys4ini.bin": buildIndex("S4IC", index) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: eushullyAlfFormat,
					mainPath,
					entries: [{ path: "one.agf", size: content.length, content }],
				});
			},
		);
	});

	it("falls back to the archive's own AAI index", async () => {
		const content = Buffer.from("aai index payload");
		const index = buildSysIni(
			["data.alf"],
			[{ name: "one.agf", archive: 0, offset: 0, size: content.length }],
		);
		await withCompanionFiles(
			"data.alf",
			{ "data.alf": content, "data.AAI": buildIndex("S3IC", index) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: eushullyAlfFormat,
					mainPath,
					entries: [{ path: "one.agf", size: content.length, content }],
				});
			},
		);
	});

	it("declines an archive its index does not list", async () => {
		const index = buildSysIni(
			["other.alf"],
			[{ name: "one.agf", archive: 0, offset: 0, size: 4 }],
		);
		await withCompanionFiles(
			"data.alf",
			{ "data.alf": Buffer.alloc(8), "sys3ini.bin": buildIndex("S3IN", index) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await eushullyAlfFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects an archive without an index", async () => {
		await withCompanionFiles(
			"data.alf",
			{ "data.alf": Buffer.alloc(16) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await eushullyAlfFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects an unknown index magic", async () => {
		const index = buildSysIni(["data.alf"], []);
		const ini = Buffer.alloc(PLAIN_OFFSET + index.length);
		ini.write("S9XX", 0, "latin1");
		index.copy(ini, PLAIN_OFFSET);
		await withCompanionFiles(
			"data.alf",
			{ "data.alf": Buffer.alloc(16), "sys3ini.bin": ini },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await eushullyAlfFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects an insane archive count", async () => {
		const index = buildSysIni(["data.alf"], []);
		index.writeInt32LE(0x40000, 0);
		await withCompanionFiles(
			"data.alf",
			{
				"data.alf": Buffer.alloc(16),
				"sys3ini.bin": buildIndex("S3IN", index),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await eushullyAlfFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects an archive id outside the table", async () => {
		const index = buildSysIni(
			["data.alf"],
			[{ name: "one.agf", archive: 5, offset: 0, size: 4 }],
		);
		await withCompanionFiles(
			"data.alf",
			{
				"data.alf": Buffer.alloc(16),
				"sys3ini.bin": buildIndex("S3IN", index),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await eushullyAlfFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects an entry outside the archive", async () => {
		// The reference does not validate placement; the port declines such an index instead.
		const index = buildSysIni(
			["data.alf"],
			[{ name: "one.agf", archive: 0, offset: 0x1000, size: 4 }],
		);
		await withCompanionFiles(
			"data.alf",
			{
				"data.alf": Buffer.alloc(16),
				"sys3ini.bin": buildIndex("S3IN", index),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await eushullyAlfFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});
});
