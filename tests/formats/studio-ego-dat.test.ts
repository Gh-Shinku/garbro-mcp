import { encodeCp932 } from "@garbro-mcp/core";
import { egoDatFormat, egoOldDatFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 4;

interface Entry {
	name: string;
	content: Buffer;
}

/**
 * Records are variable in length and start with that length, then the data offset and size, then the name
 * filling the rest of the record. The header size decides where each field sits.
 */
function buildEgo(entries: readonly Entry[], headerSize: number): Buffer {
	const records = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		return 4 + headerSize - 4 + name.length;
	});
	const indexSize = records.reduce((sum, size) => sum + size, 0);
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeUInt32LE(indexSize, 0);
	let position = INDEX_OFFSET;
	let data = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const total = records[id] ?? 0;
		archive.writeUInt32LE(total, position);
		archive.writeUInt32LE(data, position + headerSize - 8);
		archive.writeUInt32LE(entry.content.length, position + headerSize - 4);
		encodeCp932(entry.name).copy(archive, position + headerSize);
		entry.content.copy(archive, data);
		position += total;
		data += entry.content.length;
	}
	return archive;
}

const ENTRIES: Entry[] = [
	{ name: "one.dat", content: Buffer.from("first body") },
	{ name: "two.dat", content: Buffer.from("second body") },
];

describe("Studio e.go! DAT resource archives", () => {
	it("uses the DAT extension to guard its signatureless layouts", () => {
		expect(egoDatFormat.descriptor.extensions).toEqual(["dat"]);
		expect(egoDatFormat.detection?.extensionOnly).toBe(true);
		expect(egoOldDatFormat.detection?.extensionOnly).toBe(true);
	});

	it("reads the newer layout with its 0x10-byte record header", async () => {
		const archive = buildEgo(ENTRIES, 0x10);
		await expectArchive({
			format: egoDatFormat,
			archive,
			sourcePath: "sample.dat",
			entries: [
				{
					path: "one.dat",
					size: 10,
					content: ENTRIES[0]?.content ?? Buffer.alloc(0),
				},
				{
					path: "two.dat",
					size: 11,
					content: ENTRIES[1]?.content ?? Buffer.alloc(0),
				},
			],
		});
	});

	it("reads the older layout with its 0xC-byte record header", async () => {
		const archive = buildEgo(ENTRIES, 0x0c);
		await expectArchive({
			format: egoOldDatFormat,
			archive,
			sourcePath: "sample.dat",
			entries: [
				{
					path: "one.dat",
					size: 10,
					content: ENTRIES[0]?.content ?? Buffer.alloc(0),
				},
				{
					path: "two.dat",
					size: 11,
					content: ENTRIES[1]?.content ?? Buffer.alloc(0),
				},
			],
		});
	});

	it("keeps the two layouts apart", async () => {
		const newer = buildEgo(ENTRIES, 0x10);
		const older = buildEgo(ENTRIES, 0x0c);
		await expectArchive({
			format: egoOldDatFormat,
			archive: newer,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
		await expectArchive({
			format: egoDatFormat,
			archive: older,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a record that is no longer than its header", async () => {
		const archive = buildEgo(ENTRIES, 0x10);
		archive.writeUInt32LE(0x10, INDEX_OFFSET);
		await expectArchive({
			format: egoDatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a payload start inside the header region", async () => {
		const archive = buildEgo(ENTRIES, 0x10);
		archive.writeUInt32LE(4, 0);
		await expectArchive({
			format: egoDatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
