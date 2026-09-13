import { deflateSync } from "node:zlib";
import { meltyPakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const STORED_SENTINEL = 0xffffffff;

interface Entry {
	name: string;
	payload: Buffer;
	unpackedSize?: number;
}

/**
 * Builds an archive whose payloads come first and whose index trails the file, closed by the record count and
 * the index size. A record holds the offset, the packed size, the unpacked size and a character count.
 */
function buildMelty(entries: readonly Entry[]): Buffer {
	const records = entries.map((entry) => {
		const name = Buffer.from(entry.name, "utf16le");
		const header = Buffer.alloc(16);
		header.writeUInt32LE(entry.payload.length, 4);
		header.writeUInt32LE(entry.unpackedSize ?? STORED_SENTINEL, 8);
		header.writeInt32LE(entry.name.length, 12);
		return { name, header };
	});
	const indexSize = records.reduce(
		(sum, record) => sum + 16 + record.name.length,
		0,
	);
	const payloadSize = entries.reduce(
		(sum, entry) => sum + entry.payload.length,
		0,
	);
	const archive = Buffer.alloc(payloadSize + indexSize + 8);
	let data = 0;
	for (const entry of entries) {
		entry.payload.copy(archive, data);
		data += entry.payload.length;
	}
	let position = payloadSize;
	for (const [id, record] of records.entries()) {
		// Each record's offset addresses the payload file itself.
		record.header.writeUInt32LE(
			entries
				.slice(0, id)
				.reduce((sum, entry) => sum + entry.payload.length, 0),
			0,
		);
		record.header.copy(archive, position);
		position += 16;
		record.name.copy(archive, position);
		position += record.name.length;
	}
	archive.writeInt32LE(entries.length, payloadSize + indexSize);
	archive.writeUInt32LE(indexSize, payloadSize + indexSize + 4);
	return archive;
}

describe("BlackRainbow/Melty PAK archive", () => {
	it("reads a stored and a deflated entry from the trailing index", async () => {
		const stored = Buffer.from("stored body");
		const expanded = Buffer.from("deflated body");
		const packed = deflateSync(expanded);
		await expectArchive({
			format: meltyPakFormat,
			archive: buildMelty([
				{ name: "one.dat", payload: stored },
				{ name: "two.dat", payload: packed, unpackedSize: expanded.length },
			]),
			sourcePath: "sample.pak",
			entries: [
				{ path: "one.dat", size: stored.length, content: stored },
				{ path: "two.dat", size: expanded.length, content: expanded },
			],
		});
	});

	it("reads a non-ascii name through its UTF-16 field", async () => {
		const content = Buffer.from("name body");
		await expectArchive({
			format: meltyPakFormat,
			archive: buildMelty([{ name: "名前.dat", payload: content }]),
			sourcePath: "sample.pak",
			entries: [{ path: "名前.dat", size: content.length, content }],
		});
	});

	it("rejects a record whose name length is zero", async () => {
		const content = Buffer.from("body");
		const archive = buildMelty([{ name: "one.dat", payload: content }]);
		archive.writeInt32LE(0, content.length + 12);
		await expectArchive({
			format: meltyPakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty record count", async () => {
		const content = Buffer.from("body");
		const archive = buildMelty([{ name: "one.dat", payload: content }]);
		archive.writeInt32LE(0, archive.length - 8);
		await expectArchive({
			format: meltyPakFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});

	it("requires the pak extension", async () => {
		const content = Buffer.from("body");
		await expectArchive({
			format: meltyPakFormat,
			archive: buildMelty([{ name: "one.dat", payload: content }]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
