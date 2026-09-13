import { encodeCp932 } from "@garbro-mcp/core";
import { sognaDatFormat } from "@garbro-mcp/formats";
import { describe, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x20;

interface Entry {
	name: string;
	payload: Buffer;
	packed?: boolean;
	unpackedSize?: number;
}

function buildSgs(entries: readonly Entry[]): Buffer {
	const payloadOffset = INDEX_OFFSET + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		payloadOffset +
			entries.reduce((total, entry) => total + entry.payload.length, 0),
	);
	archive.write("SGS.DAT 1.00", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x0c);
	let offset = payloadOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive[record + 0x13] = entry.packed ? 1 : 0;
		archive.writeUInt32LE(entry.payload.length, record + 0x14);
		archive.writeUInt32LE(
			entry.unpackedSize ?? entry.payload.length,
			record + 0x18,
		);
		archive.writeUInt32LE(offset, record + 0x1c);
		entry.payload.copy(archive, offset);
		offset += entry.payload.length;
	}
	return archive;
}

type Token = { literal: number } | { distance: number; count: number };

/** Encodes the Sogna LZ scheme: one control byte per eight flags, matches as 12-bit distances. */
function sognaLz(tokens: readonly Token[]): Buffer {
	const chunks: number[] = [];
	for (let group = 0; group < tokens.length; group += 8) {
		const slice = tokens.slice(group, group + 8);
		let flags = 0;
		for (const [index, token] of slice.entries()) {
			if ("distance" in token) flags |= 0x80 >> index;
		}
		chunks.push(flags);
		for (const token of slice) {
			if ("distance" in token) {
				const word = ((token.count - 1) << 12) | token.distance;
				chunks.push(word & 0xff, word >> 8);
			} else {
				chunks.push(token.literal);
			}
		}
	}
	return Buffer.from(chunks);
}

describe("Sogna DAT resource archive", () => {
	it("extracts stored and packed entries", async () => {
		const stored = Buffer.from("stored payload");
		const compressed = sognaLz([
			{ literal: 0x41 },
			{ literal: 0x42 },
			{ literal: 0x43 },
			{ distance: 3, count: 6 },
		]);
		await expectArchive({
			format: sognaDatFormat,
			archive: buildSgs([
				{ name: "raw.bin", payload: stored },
				{
					name: "lz.bin",
					payload: compressed,
					packed: true,
					unpackedSize: 9,
				},
			]),
			entries: [
				{ path: "raw.bin", size: stored.length, content: stored },
				{
					path: "lz.bin",
					size: 9,
					content: Buffer.from("ABCABCABC"),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("zero-fills a packed entry whose stream ends early", async () => {
		const compressed = sognaLz([{ literal: 0x5a }]);
		await expectArchive({
			format: sognaDatFormat,
			archive: buildSgs([
				{
					name: "short.bin",
					payload: compressed,
					packed: true,
					unpackedSize: 4,
				},
			]),
			entries: [
				{ path: "short.bin", size: 4, content: Buffer.from([0x5a, 0, 0, 0]) },
			],
		});
	});

	it("rejects a payload outside the file", async () => {
		const archive = buildSgs([{ name: "a.bin", payload: Buffer.from("x") }]);
		archive.writeUInt32LE(archive.length, INDEX_OFFSET + 0x1c);
		await expectArchive({
			format: sognaDatFormat,
			archive,
			detected: false,
			entries: [],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = buildSgs([{ name: "a.bin", payload: Buffer.from("x") }]);
		archive.write("XXX.DAT 1.00", 0, "ascii");
		await expectArchive({
			format: sognaDatFormat,
			archive,
			detected: false,
			entries: [],
		});
	});
});
