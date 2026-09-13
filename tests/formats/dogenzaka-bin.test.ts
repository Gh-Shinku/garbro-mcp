import { BufferByteSource } from "@garbro-mcp/core";
import {
	dogenzakaBinFormat,
	dogenzakaGameDatFormat,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { literalLzssStream } from "../helpers/lzss.js";

const BIN_INNER_HEADER = 12;

interface BinEntry {
	/** Signature words placed at the payload, used for type detection. */
	signature?: number;
	data: Buffer;
	/** Stored payload, defaults to `data`. */
	stored?: Buffer;
	packed?: boolean;
}

/**
 * Builds a Dogenzaka BIN archive: an outer offset/size table, an inner header per entry and the
 * payloads. Each inner header holds a positive word, the payload offset and the flagged size.
 */
function buildBin(entries: readonly BinEntry[]): Buffer {
	const indexEnd = 4 + entries.length * 8;
	const innerBase = indexEnd;
	const innerSize = entries.length * BIN_INNER_HEADER;
	let payloadOffset = innerBase + innerSize;
	const index = Buffer.alloc(entries.length * 8);
	const inners: Buffer[] = [];
	const payloads: Buffer[] = [];
	for (const [id, entry] of entries.entries()) {
		const stored = entry.stored ?? entry.data;
		const innerOffset = innerBase + id * BIN_INNER_HEADER;
		index.writeUInt32LE(innerOffset, id * 8);
		// The outer size only feeds the placement check; the real size lives in the inner header.
		index.writeUInt32LE(BIN_INNER_HEADER + stored.length, id * 8 + 4);
		const inner = Buffer.alloc(BIN_INNER_HEADER);
		inner.writeInt32LE(1, 0);
		inner.writeUInt32LE(payloadOffset - innerOffset, 4);
		const flag = entry.packed ? 1 : 2;
		inner.writeUInt32LE(((flag << 30) | stored.length) >>> 0, 8);
		inners.push(inner);
		payloads.push(stored);
		payloadOffset += stored.length;
	}
	const header = Buffer.alloc(4);
	header.writeInt32LE(entries.length, 0);
	return Buffer.concat([header, index, ...inners, ...payloads]);
}

/** Builds a game data archive: the count includes the leading zero word of the offset table. */
function buildGameDat(entries: readonly { data: Buffer }[]): Buffer {
	const count = entries.length + 1;
	const table = Buffer.alloc(count * 4);
	let offset = 0;
	for (const [id, entry] of entries.entries()) {
		offset += entry.data.length;
		table.writeUInt32LE(offset, (id + 1) * 4);
	}
	const header = Buffer.alloc(4);
	header.writeInt32LE(count, 0);
	return Buffer.concat([header, table, ...entries.map((e) => e.data)]);
}

const OGG_SIGNATURE = Buffer.from("OggS", "ascii");

describe("Dogenzaka BIN audio archives", () => {
	it("lists packed entries through the inner headers", async () => {
		const data = Buffer.from("unpacked audio bytes");
		const stored = literalLzssStream(data);
		const archive = buildBin([{ data, stored, packed: true }]);
		const source = new BufferByteSource(archive);
		expect(await dogenzakaBinFormat.detect(source, "BGM.bin")).toBe(true);
		const handle = await dogenzakaBinFormat.open(source, "BGM.bin");
		expect(handle.entries).toHaveLength(1);
		expect(handle.entries[0]).toMatchObject({
			id: "0",
			path: "BGM#00000",
			size: BigInt(stored.length),
			packedSize: BigInt(stored.length),
			compressed: true,
			sizeKnown: false,
			offset: BigInt(4 + 8 + BIN_INNER_HEADER + 0x0),
		});
	});

	it("hands out stored payloads unchanged", async () => {
		const data = Buffer.alloc(0x20, 0x41);
		const archive = buildBin([{ data }]);
		const source = new BufferByteSource(archive);
		const handle = await dogenzakaBinFormat.open(source, "BGM.bin");
		const entry = handle.entries[0];
		if (!entry) throw new Error("missing entry");
		expect(entry.compressed).toBe(false);
		// Stored entries leave the flag unset, which the toolkit reads as a known size.
		expect(entry.sizeKnown).toBeUndefined();
		const chunks: Buffer[] = [];
		for await (const chunk of await handle.openEntry(entry.id))
			chunks.push(Buffer.from(chunk as Uint8Array));
		expect(Buffer.concat(chunks)).toEqual(data);
	});

	it("retypes payloads whose signature is recognized", async () => {
		const data = Buffer.concat([OGG_SIGNATURE, Buffer.alloc(0x1c, 0x55)]);
		const archive = buildBin([{ data }]);
		const source = new BufferByteSource(archive);
		const handle = await dogenzakaBinFormat.open(source, "BGM.bin");
		expect(handle.entries[0]).toMatchObject({
			path: "BGM#00000.ogg",
			metadata: { type: "audio" },
		});
	});

	it("rejects an offset pointing into the index", async () => {
		const archive = buildBin([{ data: Buffer.alloc(0x20) }]);
		archive.writeUInt32LE(0x10, 4);
		const source = new BufferByteSource(archive);
		expect(await dogenzakaBinFormat.detect(source, "BGM.bin")).toBe(false);
	});

	it("rejects an inner header without a positive word", async () => {
		const archive = buildBin([{ data: Buffer.alloc(0x20) }]);
		archive.writeInt32LE(0, 12);
		const source = new BufferByteSource(archive);
		expect(await dogenzakaBinFormat.detect(source, "BGM.bin")).toBe(false);
	});

	it("lists game data entries from cumulative offsets", async () => {
		const first = Buffer.alloc(0x30, 0x61);
		const second = Buffer.alloc(0x20, 0x62);
		const archive = buildGameDat([{ data: first }, { data: second }]);
		const source = new BufferByteSource(archive);
		expect(await dogenzakaGameDatFormat.detect(source, "GAME.bin")).toBe(true);
		const handle = await dogenzakaGameDatFormat.open(source, "GAME.bin");
		expect(handle.entries).toEqual([
			{
				id: "0",
				path: "GAME#0000",
				size: BigInt(first.length),
				packedSize: BigInt(first.length),
				compressed: false,
				encrypted: false,
				offset: BigInt(4 + 3 * 4),
			},
			{
				id: "1",
				path: "GAME#0001",
				size: BigInt(second.length),
				packedSize: BigInt(second.length),
				compressed: false,
				encrypted: false,
				offset: BigInt(4 + 3 * 4 + first.length),
			},
		]);
	});

	it("retypes game data payloads whose signature is recognized", async () => {
		const data = Buffer.concat([
			Buffer.from("RIFF", "ascii"),
			Buffer.alloc(0x1c),
		]);
		const archive = buildGameDat([{ data }]);
		const source = new BufferByteSource(archive);
		const handle = await dogenzakaGameDatFormat.open(source, "GAME.bin");
		expect(handle.entries[0]).toMatchObject({
			path: "GAME#0000.wav",
			metadata: { type: "audio" },
		});
	});

	it("rejects a game data table that does not start at zero", async () => {
		const archive = buildGameDat([{ data: Buffer.alloc(0x20) }]);
		archive.writeUInt32LE(4, 4);
		const source = new BufferByteSource(archive);
		expect(await dogenzakaGameDatFormat.detect(source, "GAME.bin")).toBe(false);
	});

	it("rejects a zero-length game data entry", async () => {
		const archive = buildGameDat([{ data: Buffer.alloc(0x20) }]);
		archive.writeUInt32LE(0, 8);
		const source = new BufferByteSource(archive);
		expect(await dogenzakaGameDatFormat.detect(source, "GAME.bin")).toBe(false);
	});

	it("rejects a game data table that reaches past the archive", async () => {
		const archive = Buffer.alloc(0x10);
		archive.writeInt32LE(0x40000, 0);
		const source = new BufferByteSource(archive);
		expect(await dogenzakaGameDatFormat.detect(source, "GAME.bin")).toBe(false);
	});
});
