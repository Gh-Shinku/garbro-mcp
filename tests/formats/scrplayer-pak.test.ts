import { encodeCp932 } from "@garbro-mcp/core";
import { encryptScrPlayerIndex, scrPlayerPakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 8;

interface Entry {
	name: string;
	content: Buffer;
}

interface Options {
	encrypted?: boolean;
	align: 4 | 8;
	/**
	 * When set, each payload span is padded to a multiple of the alignment, which is what the reference's
	 * alignment test predicts; leaving it off makes the eight-byte reading fail on purpose.
	 */
	padToAlign: boolean;
}

/**
 * Builds an archive: the signature, the index size, the index itself and then the payloads. A record is the
 * data offset, the size and a name length byte followed by the name, and the next record starts at the name
 * length rounded down to the alignment plus eight.
 */
function buildPak(entries: readonly Entry[], options: Options): Buffer {
	const records: { name: Buffer; stride: number; entry: Entry }[] = [];
	for (const entry of entries) {
		const name = encodeCp932(entry.name);
		const stride = ((options.align + 1 + name.length) & -options.align) + 8;
		records.push({ name, stride, entry });
	}
	const indexSize = records.reduce((sum, record) => sum + record.stride, 0);
	const index = Buffer.alloc(indexSize);
	let position = INDEX_OFFSET + indexSize;
	const offsets: number[] = [];
	for (const record of records) {
		offsets.push(position);
		const pad = options.padToAlign
			? (options.align - (record.entry.content.length % options.align)) %
				options.align
			: 0;
		position += record.entry.content.length + pad;
	}
	let cursor = 0;
	for (const [id, record] of records.entries()) {
		index.writeUInt32LE(offsets[id] ?? 0, cursor);
		index.writeUInt32LE(record.entry.content.length, cursor + 4);
		index.writeUInt8(record.name.length, cursor + 8);
		record.name.copy(index, cursor + 9);
		cursor += record.stride;
	}
	const archive = Buffer.alloc(position);
	archive.write(options.encrypted ? "pac2" : "pack", 0, "ascii");
	archive.writeUInt32LE(indexSize, 4);
	(indexSize % 4 === 0 && options.encrypted
		? encryptScrPlayerIndex(index)
		: index
	).copy(archive, INDEX_OFFSET);
	for (const [id, record] of records.entries()) {
		record.entry.content.copy(archive, offsets[id] ?? 0);
	}
	return archive;
}

describe("ScrPlayer PAK resource archive", () => {
	it("reads an unencrypted archive with eight-byte records", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: scrPlayerPakFormat,
			archive: buildPak(
				[
					{ name: "one.dat", content: first },
					{ name: "two.dat", content: second },
				],
				{ align: 8, padToAlign: true },
			),
			sourcePath: "sample.pak",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("decrypts an encrypted index", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: scrPlayerPakFormat,
			archive: buildPak(
				[
					{ name: "one.dat", content: first },
					{ name: "two.dat", content: second },
				],
				{ align: 8, padToAlign: true, encrypted: true },
			),
			sourcePath: "sample.pak",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("falls back to four-byte records when the eight-byte reading fails", async () => {
		const first = Buffer.from("aaaaa");
		const second = Buffer.from("bbbbbbb");
		await expectArchive({
			format: scrPlayerPakFormat,
			archive: buildPak(
				[
					{ name: "a.b", content: first },
					{ name: "c.d", content: second },
				],
				{ align: 4, padToAlign: false },
			),
			sourcePath: "sample.pak",
			entries: [
				{ path: "a.b", size: first.length, content: first },
				{ path: "c.d", size: second.length, content: second },
			],
		});
	});

	it("rejects an index smaller than the header minimum", async () => {
		const content = Buffer.from("body");
		const archive = buildPak([{ name: "one.dat", content }], {
			align: 8,
			padToAlign: true,
		});
		archive.writeUInt32LE(8, 4);
		await expectArchive({
			format: scrPlayerPakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});

	it("rejects a foreign signature", async () => {
		const content = Buffer.from("body");
		const archive = buildPak([{ name: "one.dat", content }], {
			align: 8,
			padToAlign: true,
		});
		archive.write("pack1", 0, "ascii");
		await expectArchive({
			format: scrPlayerPakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});
});
