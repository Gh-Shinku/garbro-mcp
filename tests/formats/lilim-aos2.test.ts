import { encodeCp932 } from "@garbro-mcp/core";
import { aos2Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x111;
const RECORD_SIZE = 0x28;

/** Packs bits most-significant-first, matching GARbro's `MsbBitStream`. */
function packBits(bits: readonly number[]): Buffer {
	const output = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		if (bit === 0) continue;
		const byte = Math.floor(index / 8);
		output[byte] = (output[byte] ?? 0) | (1 << (7 - (index % 8)));
	}
	return output;
}

function leaf(value: number): number[] {
	return [0, ...value.toString(2).padStart(8, "0").split("").map(Number)];
}

/** A Huffman stream whose root selects 'A' on a zero bit and 'B' on a one bit. */
function huffmanStream(bits: readonly number[]): Buffer {
	return packBits([1, ...leaf(0x41), ...leaf(0x42), ...bits]);
}

interface Entry {
	name: string;
	content: Buffer;
}

/** Builds an AOS version 2 archive: the index runs from 0x111 and payloads follow it. */
function buildAos2(entries: readonly Entry[]): Buffer {
	const indexSize = RECORD_SIZE * entries.length;
	const baseOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		baseOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt32LE(0, 0);
	archive.writeUInt32LE(baseOffset, 4);
	archive.writeInt32LE(indexSize, 8);
	let position = baseOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(position - baseOffset, record + 0x20);
		archive.writeUInt32LE(entry.content.length, record + 0x24);
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

describe("LiLiM AOS version 2 archive", () => {
	it("reads plain entries and renames compressed images", async () => {
		const plain = Buffer.from("plain payload");
		const packed = Buffer.alloc(4);
		packed.writeUInt32LE(2, 0);
		const stored = Buffer.concat([packed, huffmanStream([0, 1])]);
		await expectArchive({
			format: aos2Format,
			archive: buildAos2([
				{ name: "data.dat", content: plain },
				{ name: "image.cmp", content: stored },
			]),
			sourcePath: "sample.aos",
			entries: [
				{ path: "data.dat", size: plain.length, content: plain },
				{ path: "image.abm", size: 2, content: Buffer.from("AB") },
			],
		});
	});

	it("decodes scr entries as Huffman streams", async () => {
		const packed = Buffer.alloc(4);
		packed.writeUInt32LE(1, 0);
		const stored = Buffer.concat([packed, huffmanStream([1])]);
		await expectArchive({
			format: aos2Format,
			archive: buildAos2([{ name: "script.scr", content: stored }]),
			sourcePath: "sample.aos",
			entries: [{ path: "script.scr", size: 1, content: Buffer.from("B") }],
		});
	});

	it("requires the aos extension", async () => {
		const archive = buildAos2([{ name: "a.dat", content: Buffer.from("x") }]);
		await expectArchive({
			format: aos2Format,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});

	it("rejects an index that overlaps the payloads", async () => {
		const archive = buildAos2([{ name: "a.dat", content: Buffer.from("x") }]);
		archive.writeUInt32LE(INDEX_OFFSET, 4);
		await expectArchive({
			format: aos2Format,
			archive,
			sourcePath: "sample.aos",
			detected: false,
			entries: [],
		});
	});
});
