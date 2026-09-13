import { BufferByteSource } from "@garbro-mcp/core";
import { cromwellOpkFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const TABLE_OFFSET = 0x14;
const OFFSET_SIZE = 4;
const NAME_SIZE = 8;

interface Entry {
	name: string;
	content: Buffer;
}

function buildOpk(entries: readonly Entry[]): Buffer {
	const tableLength = (entries.length + 1) * OFFSET_SIZE;
	const dataOffset = TABLE_OFFSET + tableLength;
	const nameLength = entries.length * NAME_SIZE;
	const archive = Buffer.alloc(
		dataOffset +
			entries.reduce((sum, entry) => sum + entry.content.length, 0) +
			nameLength,
	);
	archive.write("VoiceOggPackFile", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x10);
	let payloadOffset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		archive.writeUInt32LE(payloadOffset, TABLE_OFFSET + id * OFFSET_SIZE);
		entry.content.copy(archive, payloadOffset);
		payloadOffset += entry.content.length;
	}
	// The final table word is both the end of the last payload and the start of the name table.
	archive.writeUInt32LE(
		payloadOffset,
		TABLE_OFFSET + entries.length * OFFSET_SIZE,
	);
	for (const [id, entry] of entries.entries()) {
		Buffer.from(entry.name, "latin1").copy(
			archive,
			payloadOffset + id * NAME_SIZE,
			0,
			NAME_SIZE - 1,
		);
	}
	return archive;
}

describe("cromwell OPK audio archive", () => {
	it("reads entries and appends the ogg extension", async () => {
		const first = Buffer.from("first ogg stream");
		const second = Buffer.from("second ogg stream");
		const archive = buildOpk([
			{ name: "track01", content: first },
			{ name: "track02", content: second },
		]);
		await expectArchive({
			format: cromwellOpkFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "track01.ogg", size: first.length, content: first },
				{ path: "track02.ogg", size: second.length, content: second },
			],
		});
	});

	it("types entries as audio", async () => {
		const payload = Buffer.from("ogg stream");
		const archive = buildOpk([{ name: "track01", content: payload }]);
		const listing = await cromwellOpkFormat.open(
			new BufferByteSource(archive),
			"sample.opk",
		);
		try {
			expect(listing.entries.map((entry) => entry.metadata)).toEqual([
				{ type: "audio" },
			]);
		} finally {
			await listing.close();
		}
	});

	it("rejects a foreign signature", async () => {
		const archive = buildOpk([
			{ name: "track01", content: Buffer.from("ogg") },
		]);
		archive.write("XXXXX", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await cromwellOpkFormat.detect(source)).toBe(false);
	});

	it("rejects descending offsets", async () => {
		const archive = buildOpk([
			{ name: "track01", content: Buffer.from("ogg stream") },
			{ name: "track02", content: Buffer.from("ogg stream") },
		]);
		// Swap the two payload offsets so the first extent would have to wrap around.
		const first = archive.readUInt32LE(TABLE_OFFSET);
		archive.writeUInt32LE(
			archive.readUInt32LE(TABLE_OFFSET + OFFSET_SIZE),
			TABLE_OFFSET,
		);
		archive.writeUInt32LE(first, TABLE_OFFSET + OFFSET_SIZE);
		const source = new BufferByteSource(archive);
		expect(await cromwellOpkFormat.detect(source)).toBe(false);
	});

	it("rejects a truncated name table", async () => {
		const archive = buildOpk([
			{ name: "track01", content: Buffer.from("ogg stream") },
		]);
		archive.writeUInt32LE(archive.length - 2, TABLE_OFFSET + OFFSET_SIZE);
		const source = new BufferByteSource(archive);
		expect(await cromwellOpkFormat.detect(source)).toBe(false);
	});
});
