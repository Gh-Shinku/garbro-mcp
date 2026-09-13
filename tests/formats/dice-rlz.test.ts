import { encodeCp932 } from "@garbro-mcp/core";
import { diceRlzFormat } from "@garbro-mcp/formats";
import { describe, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x34;

interface Entry {
	name: string;
	payload: Buffer;
	packed?: boolean;
	unpackedSize?: number;
}

function buildRlz(entries: readonly Entry[]): Buffer {
	const indexSize = entries.length * RECORD_SIZE;
	const payloadOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		payloadOffset +
			entries.reduce((total, entry) => total + entry.payload.length, 0),
	);
	archive.write("RLZ2", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	let offset = 0;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.payload.length, record + 0x20);
		archive.writeUInt32LE(
			entry.unpackedSize ?? entry.payload.length,
			record + 0x24,
		);
		archive.writeInt32LE(entry.packed ? 1 : 0, record + 0x28);
		archive.writeUInt32LE(offset, record + 0x2c);
		entry.payload.copy(archive, payloadOffset + offset);
		offset += entry.payload.length;
	}
	return archive;
}

type Token = { literal: number } | { offset: number; count: number };

/** Encodes the Dice control scheme: low bits first, set bits mark literals, matches hold absolute
 * 12-bit frame positions. */
function diceLz(tokens: readonly Token[]): Buffer {
	const chunks: number[] = [];
	for (let group = 0; group < tokens.length; group += 8) {
		const slice = tokens.slice(group, group + 8);
		let control = 0;
		for (const [index, token] of slice.entries()) {
			if (!("offset" in token)) control |= 1 << index;
		}
		chunks.push(control);
		for (const token of slice) {
			if ("offset" in token) {
				const word =
					((token.offset >> 8) << 12) |
					((token.count - 2) << 8) |
					(token.offset & 0xff);
				chunks.push(word & 0xff, word >> 8);
			} else {
				chunks.push(token.literal);
			}
		}
	}
	return Buffer.from(chunks);
}

describe("DiceSystem RLZ resource archive", () => {
	it("extracts stored and packed entries", async () => {
		const stored = Buffer.from("stored payload");
		// Literals land at frame 0x7ef and up, so the match references that absolute position.
		const compressed = diceLz([
			{ literal: 0x41 },
			{ literal: 0x42 },
			{ literal: 0x43 },
			{ offset: 0x7ef, count: 6 },
		]);
		await expectArchive({
			format: diceRlzFormat,
			archive: buildRlz([
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
				{ path: "lz.bin", size: 9, content: Buffer.from("ABCABCABC") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("zero-fills a packed entry whose stream ends early", async () => {
		await expectArchive({
			format: diceRlzFormat,
			archive: buildRlz([
				{
					name: "short.bin",
					payload: diceLz([{ literal: 0x5a }]),
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
		const archive = buildRlz([{ name: "a.bin", payload: Buffer.from("x") }]);
		archive.writeUInt32LE(archive.length, INDEX_OFFSET + 0x2c);
		await expectArchive({
			format: diceRlzFormat,
			archive,
			detected: false,
			entries: [],
		});
	});
});
