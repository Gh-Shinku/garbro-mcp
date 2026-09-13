import { encodeCp932 } from "@garbro-mcp/core";
import { aosFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x10;
const PAYLOAD_OFFSET = 0x200;

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

function huffmanStream(bits: readonly number[]): Buffer {
	return packBits([1, ...leaf(0x41), ...leaf(0x42), ...bits]);
}

interface Record {
	name?: string;
	payload?: number;
	linkSkip?: number;
}

/**
 * Builds an AOS index. The word at 0x10 is the first record's data offset, and GARbro requires the
 * field it points at to look like a link or an end marker, so the first payload starts with a zero.
 */
function buildAos(
	records: readonly Record[],
	payloads: readonly Buffer[],
): Buffer {
	const offsets: number[] = [];
	let running = PAYLOAD_OFFSET;
	for (const payload of payloads) {
		offsets.push(running);
		running += payload.length;
	}
	const archive = Buffer.alloc(running);
	archive[0] = 0x41;
	for (const [id, record] of records.entries()) {
		const position = id * RECORD_SIZE;
		if (record.linkSkip !== undefined) {
			archive.fill(0xff, position, position + NAME_SIZE);
			archive.writeUInt32LE(record.linkSkip, position + 0x10);
			continue;
		}
		encodeCp932(record.name ?? "").copy(archive, position);
		archive.writeUInt32LE(offsets[record.payload ?? 0] ?? 0, position + 0x10);
		archive.writeUInt32LE(
			payloads[record.payload ?? 0]?.length ?? 0,
			position + 0x14,
		);
	}
	archive.writeUInt32LE(offsets[0] ?? 0, 0x10);
	let position = PAYLOAD_OFFSET;
	for (const payload of payloads) {
		payload.copy(archive, position);
		position += payload.length;
	}
	return archive;
}

describe("LiLiM AOS archive", () => {
	it("walks link records and reads plain entries", async () => {
		// The first payload starts with zero so the pointer at 0x10 satisfies GARbro's field check,
		// which also reads a whole 0x10-byte field there.
		const first = Buffer.concat([
			Buffer.from([0]),
			Buffer.from("first body here"),
		]);
		const second = Buffer.from("second body");
		await expectArchive({
			format: aosFormat,
			archive: buildAos(
				[
					{ name: "first.dat", payload: 0 },
					{ linkSkip: RECORD_SIZE },
					{ name: "skipped.dat", payload: 1 },
					{ name: "second.dat", payload: 1 },
				],
				[first, second],
			),
			sourcePath: "sample.bin",
			// The link skips one record, so the entry at 0x40 never reaches the directory.
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
		});
	});

	it("decodes scr entries as Huffman streams", async () => {
		const header = Buffer.alloc(4);
		header.writeUInt32LE(2, 0);
		const stored = Buffer.concat([header, huffmanStream([0, 1])]);
		const plain = Buffer.concat([
			Buffer.from([0]),
			Buffer.from("plain body here"),
		]);
		await expectArchive({
			format: aosFormat,
			archive: buildAos(
				[
					{ name: "plain.dat", payload: 0 },
					{ name: "script.scr", payload: 1 },
				],
				[plain, stored],
			),
			sourcePath: "sample.bin",
			entries: [
				{ path: "plain.dat", size: plain.length, content: plain },
				{ path: "script.scr", size: 2, content: Buffer.from("AB") },
			],
		});
	});

	it("rejects consecutive duplicate names", async () => {
		const payload = Buffer.concat([
			Buffer.from([0]),
			Buffer.from("duplicate body"),
		]);
		await expectArchive({
			format: aosFormat,
			archive: buildAos(
				[
					{ name: "dup.dat", payload: 0 },
					{ name: "dup.dat", payload: 0 },
				],
				[payload],
			),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a zero first byte", async () => {
		const payload = Buffer.concat([Buffer.from([0]), Buffer.from("body here")]);
		const archive = buildAos([{ name: "a.dat", payload: 0 }], [payload]);
		archive[0] = 0;
		await expectArchive({
			format: aosFormat,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
