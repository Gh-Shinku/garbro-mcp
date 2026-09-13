import { BufferByteSource } from "@garbro-mcp/core";
import { decompressSeen, seenFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x20;
const PACK_DATA_OFFSET = 0x10;

interface Entry {
	name: string;
	stored: Buffer;
	unpackedSize: number;
	packed: number;
}

/** Encodes bytes as a literal-only SEEN stream: one full control byte per group of eight. */
function seenLiteralStream(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let position = 0; position < data.length; position += 8) {
		chunks.push(Buffer.from([0xff]), data.subarray(position, position + 8));
	}
	return Buffer.concat(chunks);
}

function packContainer(data: Buffer): Buffer {
	const container = Buffer.alloc(PACK_DATA_OFFSET);
	container.write("PACK", 0, "ascii");
	container.writeInt32LE(data.length, 8);
	return Buffer.concat([container, seenLiteralStream(data)]);
}

function buildSeen(entries: readonly Entry[]): Buffer {
	const indexEnd = INDEX_OFFSET + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		indexEnd + entries.reduce((sum, entry) => sum + entry.stored.length, 0),
	);
	archive.write("PACL", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x10);
	let offset = indexEnd;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		Buffer.from(entry.name, "latin1").copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x10);
		archive.writeUInt32LE(entry.stored.length, record + 0x14);
		archive.writeUInt32LE(entry.unpackedSize, record + 0x18);
		archive.writeUInt32LE(entry.packed, record + 0x1c);
		entry.stored.copy(archive, offset);
		offset += entry.stored.length;
	}
	return archive;
}

describe("RealLive SEEN scripts archive", () => {
	it("decodes literal runs and overlapping matches", () => {
		const stream = Buffer.from([0xe0, 0x41, 0x42, 0x43, 0x21, 0x00]);
		expect(decompressSeen(stream, 6).toString("latin1")).toBe("ABCABC");
	});

	it("reads records and unpacks PACK containers", async () => {
		const plain = Buffer.from("plain script");
		const packed = Buffer.from("packed script body");
		const archive = buildSeen([
			{
				name: "plain.seen",
				stored: plain,
				unpackedSize: plain.length,
				packed: 0,
			},
			{
				name: "packed.seen",
				stored: packContainer(packed),
				unpackedSize: packed.length,
				packed: 1,
			},
		]);
		await expectArchive({
			format: seenFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "plain.seen", size: plain.length, content: plain },
				{ path: "packed.seen", size: packed.length, content: packed },
			],
		});
	});

	it("emits flagged entries without a PACK container verbatim", async () => {
		const stored = Buffer.from("not a pack container");
		const archive = buildSeen([
			{
				name: "raw.seen",
				stored,
				unpackedSize: 0x100,
				packed: 1,
			},
		]);
		await expectArchive({
			format: seenFormat,
			archive,
			entries: [{ path: "raw.seen", size: 0x100, content: stored }],
		});
	});

	it("skips records with a zero stored size", async () => {
		const kept = Buffer.from("kept");
		const archive = buildSeen([
			{
				name: "empty.seen",
				stored: Buffer.alloc(0),
				unpackedSize: 0,
				packed: 0,
			},
			{
				name: "kept.seen",
				stored: kept,
				unpackedSize: kept.length,
				packed: 0,
			},
		]);
		const source = new BufferByteSource(archive);
		const listing = await seenFormat.open(source, "sample");
		try {
			expect(listing.entries.map((entry) => entry.path)).toEqual(["kept.seen"]);
			expect(listing.metadata).toEqual({ entryCount: 1 });
		} finally {
			await listing.close();
		}
	});

	it("rejects a foreign signature", async () => {
		const archive = buildSeen([
			{
				name: "plain.seen",
				stored: Buffer.from("payload"),
				unpackedSize: 7,
				packed: 0,
			},
		]);
		archive.write("XXXX", 0, "ascii");
		const source = new BufferByteSource(archive);
		expect(await seenFormat.detect(source)).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const archive = buildSeen([
			{
				name: "plain.seen",
				stored: Buffer.from("payload"),
				unpackedSize: 7,
				packed: 0,
			},
		]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + 0x10);
		const source = new BufferByteSource(archive);
		expect(await seenFormat.detect(source)).toBe(false);
	});

	it("fails when a PACK match overruns the output", async () => {
		const container = Buffer.alloc(PACK_DATA_OFFSET);
		container.write("PACK", 0, "ascii");
		container.writeInt32LE(4, 8);
		// A single match with count three cannot produce four bytes from the start of the output.
		const stream = Buffer.from([0x00, 0x20, 0x00]);
		const archive = buildSeen([
			{
				name: "broken.seen",
				stored: Buffer.concat([container, stream]),
				unpackedSize: 4,
				packed: 1,
			},
		]);
		const source = new BufferByteSource(archive);
		const listing = await seenFormat.open(source, "sample");
		try {
			const entry = listing.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(listing.openEntry(entry.id)).rejects.toThrow(
				/Invalid SEEN match/,
			);
		} finally {
			await listing.close();
		}
	});
});
