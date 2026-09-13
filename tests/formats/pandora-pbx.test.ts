import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { pandoraPbxFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const PACKED_MAGIC = 0x6344764d; // 'MvDc'
const PACKED_HEADER_SIZE = 0x10;
const RECORD_SIZE = 0x10;
const NAME_SIZE = 0xc;
const INDEX_START = 0x10;
const PACKED_SIGNATURE = "Pandora.box\0";

interface Fixture {
	name: string;
	/** Payload as it is stored in the archive. */
	stored: Buffer;
	/** Declared unpacked size, which marks the payload as packed. */
	unpacked?: number;
}

/** Encodes a payload that stores its first byte literally and the rest in literal runs. */
function encodePandora(content: Buffer): Buffer {
	if (content.length === 0) return Buffer.alloc(0);
	const parts: number[] = [content[0] ?? 0];
	let cursor = 1;
	while (cursor < content.length) {
		const count = Math.min(0x40, content.length - cursor);
		parts.push(count - 1);
		for (const byte of content.subarray(cursor, cursor + count))
			parts.push(byte);
		cursor += count;
	}
	return Buffer.from(parts);
}

/** Wraps a Pandora stream in the header a packed payload carries. */
function packedPayload(stream: Buffer, unpackedSize: number): Buffer {
	const header = Buffer.alloc(PACKED_HEADER_SIZE);
	header.writeUInt32LE(PACKED_MAGIC, 0);
	header.writeInt32LE(unpackedSize, 8);
	return Buffer.concat([header, stream]);
}

/** Builds an archive whose offsets chain from one payload to the next. */
function buildArchive(fixtures: readonly Fixture[]): Buffer {
	const payloadStart = INDEX_START + fixtures.length * RECORD_SIZE;
	let next = payloadStart;
	const records: Buffer[] = [];
	for (const fixture of fixtures) {
		const record = Buffer.alloc(RECORD_SIZE);
		const name = encodeCp932(fixture.name);
		name.copy(record, 0, 0, Math.min(name.length, NAME_SIZE - 1));
		next += fixture.stored.length;
		record.writeUInt32LE(next, NAME_SIZE);
		records.push(record);
	}
	const header = Buffer.alloc(INDEX_START);
	Buffer.from(PACKED_SIGNATURE, "latin1").copy(header, 0);
	header.writeUInt32LE(payloadStart, 0xc);
	return Buffer.concat([
		header,
		...records,
		...fixtures.map((fixture) => fixture.stored),
	]);
}

async function expectDeclined(archive: Buffer): Promise<void> {
	const source = new BufferByteSource(archive);
	expect(await pandoraPbxFormat.detect(source, "Pandora.box")).toBe(false);
}

describe("Pandora.box resource archive", () => {
	it("lists a stored payload and unpacks a packed one", async () => {
		const raw = Buffer.from("stored payload");
		const unpacked = Buffer.from(
			"packed payload that is longer than a literal run of sixty four bytes so that it spans two runs",
		);
		const archive = buildArchive([
			{ name: "raw.bin", stored: raw },
			{
				name: "image.cg",
				stored: packedPayload(encodePandora(unpacked), unpacked.length),
				unpacked: unpacked.length,
			},
		]);
		await expectArchive({
			format: pandoraPbxFormat,
			archive,
			entries: [
				{ path: "raw.bin", size: raw.length, content: raw },
				{ path: "image.cg", size: unpacked.length, content: unpacked },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("decodes a stream that copies from earlier output", async () => {
		const unpacked = Buffer.from("abcabcabc");
		// A literal byte, two literal bytes, then a three byte copy at distance 3, twice.
		const stream = Buffer.from([0x61, 1, 0x62, 0x63, 0x80, 2, 0x80, 2]);
		const archive = buildArchive([
			{
				name: "tile.cg",
				stored: packedPayload(stream, unpacked.length),
				unpacked: unpacked.length,
			},
		]);
		await expectArchive({
			format: pandoraPbxFormat,
			archive,
			entries: [{ path: "tile.cg", size: unpacked.length, content: unpacked }],
		});
	});

	it("falls back to the stored bytes when a packed payload does not decode", async () => {
		const stored = packedPayload(Buffer.from([0x61, 0x80, 0xff]), 0x20);
		const archive = buildArchive([
			{ name: "broken.cg", stored, unpacked: 0x20 },
		]);
		await expectArchive({
			format: pandoraPbxFormat,
			archive,
			entries: [{ path: "broken.cg", size: 0x20, content: stored }],
		});
	});

	it("keeps names of a shifted code page", async () => {
		const raw = Buffer.from("payload");
		const archive = buildArchive([{ name: "背景.cg", stored: raw }]);
		await expectArchive({
			format: pandoraPbxFormat,
			archive,
			entries: [{ path: "背景.cg", size: raw.length, content: raw }],
		});
	});

	it("rejects a file without the format signature", async () => {
		const archive = buildArchive([
			{ name: "raw.bin", stored: Buffer.from("payload") },
		]);
		archive.writeUInt8(0x51, 0);
		await expectDeclined(archive);
	});

	it("rejects an index that leaves the file", async () => {
		const archive = buildArchive([
			{ name: "raw.bin", stored: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x4000, 0xc);
		await expectDeclined(archive);
	});

	it("rejects an index that starts before the first record", async () => {
		const archive = buildArchive([
			{ name: "raw.bin", stored: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(8, 0xc);
		await expectDeclined(archive);
	});

	it("rejects a payload chain that walks backwards", async () => {
		const archive = buildArchive([
			{ name: "one.bin", stored: Buffer.from("first payload") },
			{ name: "two.bin", stored: Buffer.from("second payload") },
		]);
		archive.writeUInt32LE(INDEX_START, INDEX_START + NAME_SIZE);
		await expectDeclined(archive);
	});

	it("rejects a file that is too small for an index", async () => {
		await expectDeclined(Buffer.from("Pandora.box\0"));
	});
});
