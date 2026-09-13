import { encodeCp932 } from "@garbro-mcp/core";
import { aldFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const TRAILER_SIZE = 0x10;
const INDEX_START = 3;
const INDEX_RECORD_SIZE = 3;
const NAME_OFFSET = 0x10;

interface AldEntry {
	name: string;
	content: Buffer;
}

/**
 * Builds an ALD archive: a 24-bit index table whose entries are shifted left by eight, per-entry
 * headers carrying the name, and a trailer with the version and record count. offsets are stored
 * shifted right by eight, so every record starts on a 256-byte boundary.
 */
function buildAld(entries: readonly AldEntry[], version = 0x014c4e): Buffer {
	const indexLength = INDEX_START + entries.length * INDEX_RECORD_SIZE;
	const headers = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		const headerSize = NAME_OFFSET + name.length + 1;
		const header = Buffer.alloc(headerSize);
		header.writeUInt32LE(headerSize, 0);
		header.writeUInt32LE(entry.content.length, 4);
		name.copy(header, NAME_OFFSET);
		return header;
	});
	const placements: number[] = [];
	let position = 256;
	for (const [id, entry] of entries.entries()) {
		const header = headers[id];
		if (!header) continue;
		placements.push(position);
		position += header.length + entry.content.length;
		position = Math.ceil(position / 256) * 256;
	}
	const total = position + TRAILER_SIZE;
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(indexLength >>> 8, 0);
	for (const [id, entry] of entries.entries()) {
		const header = headers[id];
		const record = placements[id];
		if (!header || record === undefined) continue;
		// The table holds 24-bit offsets shifted right by eight.
		archive.writeUInt32LE(
			(record >>> 8) & 0xffffff,
			INDEX_START + id * INDEX_RECORD_SIZE,
		);
		header.copy(archive, record);
		entry.content.copy(archive, record + header.length);
	}
	const trailer = total - TRAILER_SIZE;
	archive.writeUInt32LE(version, trailer);
	archive.writeUInt32LE(0x10, trailer + 4);
	archive.writeUInt16LE(entries.length, trailer + 9);
	return archive;
}

describe("AliceSoft System ALD archive", () => {
	it("reads a 24-bit index and per-entry headers", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second");
		const archive = buildAld([
			{ name: "data/one.bin", content: first },
			{ name: "two.bin", content: second },
		]);
		await expectArchive({
			format: aldFormat,
			archive,
			sourcePath: "sample.ald",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("accepts the second known version", async () => {
		const content = Buffer.from("payload");
		const archive = buildAld([{ name: "a.bin", content }], 0x012020);
		await expectArchive({
			format: aldFormat,
			archive,
			sourcePath: "sample.ald",
			entries: [{ path: "a.bin", size: content.length, content }],
		});
	});

	it("rejects an unknown version", async () => {
		const archive = buildAld([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x014c4f, archive.length - TRAILER_SIZE);
		await expectArchive({
			format: aldFormat,
			archive,
			sourcePath: "sample.ald",
			detected: false,
			entries: [],
		});
	});
});
