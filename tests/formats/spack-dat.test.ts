import { encodeCp932 } from "@garbro-mcp/core";
import { spackFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const BASE_OFFSET = 0x18;
const RECORD_SIZE = 0x38;
const NAME_SIZE = 0x20;

interface Entry {
	name: string;
	payload: Buffer;
	unpackedSize: number;
	method: number;
}

/** Names then a data offset relative to 0x18, both sizes, the method byte and a CRC word. */
function buildSpack(entries: readonly Entry[]): Buffer {
	const payloadSize = entries.reduce(
		(sum, entry) => sum + entry.payload.length,
		0,
	);
	const indexOffset = BASE_OFFSET + payloadSize;
	const archive = Buffer.alloc(indexOffset + RECORD_SIZE * entries.length);
	archive.write("SPac", 0, "ascii");
	archive.writeUInt8(0x6b, 4);
	archive.writeUInt16LE(1, 6);
	archive.writeUInt32LE(payloadSize, 8);
	archive.writeInt32LE(entries.length, 0x10);
	let data = BASE_OFFSET;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(data - BASE_OFFSET, record + 0x20);
		archive.writeUInt32LE(entry.unpackedSize, record + 0x24);
		archive.writeUInt32LE(entry.payload.length, record + 0x28);
		archive.writeUInt8(entry.method, record + 0x2c);
		archive.writeUInt16LE(0, record + 0x2e);
		entry.payload.copy(archive, data);
		data += entry.payload.length;
	}
	return archive;
}

describe("SPack resource archive", () => {
	it("reads stored, inverted and packed payloads", async () => {
		const plain = Buffer.from("plain body");
		const inverted = Buffer.from("inverted body");
		const stored = Buffer.from(inverted);
		for (let index = 0; index < stored.length; index += 1)
			stored[index] = ~(stored[index] ?? 0) & 0xff;
		// A control word whose top bit is clear (literal) and next bit set (match): the literal 'A',
		// then a one-byte copy from distance one. The declared output length of two ends the loop.
		const packed = Buffer.from([0x00, 0x00, 0x00, 0x40, 0x41, 0x00]);
		await expectArchive({
			format: spackFormat,
			archive: buildSpack([
				{
					name: "one.dat",
					payload: plain,
					unpackedSize: plain.length,
					method: 0,
				},
				{
					name: "two.dat",
					payload: stored,
					unpackedSize: inverted.length,
					method: 1,
				},
				{ name: "three.dat", payload: packed, unpackedSize: 2, method: 2 },
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "one.dat", size: plain.length, content: plain },
				{ path: "two.dat", size: inverted.length, content: inverted },
				{ path: "three.dat", size: 2, content: Buffer.from("AA") },
			],
			metadata: { entryCount: 3 },
		});
	});

	it("rejects a version other than one", async () => {
		const archive = buildSpack([
			{ name: "a.dat", payload: Buffer.from("x"), unpackedSize: 1, method: 0 },
		]);
		archive.writeUInt16LE(2, 6);
		await expectArchive({
			format: spackFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a missing marker byte", async () => {
		const archive = buildSpack([
			{ name: "a.dat", payload: Buffer.from("x"), unpackedSize: 1, method: 0 },
		]);
		archive.writeUInt8(0x6c, 4);
		await expectArchive({
			format: spackFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a payload outside the file", async () => {
		const archive = buildSpack([
			{ name: "a.dat", payload: Buffer.from("x"), unpackedSize: 1, method: 0 },
		]);
		const indexOffset = BASE_OFFSET + 1;
		archive.writeUInt32LE(0x1000, indexOffset + 0x20);
		await expectArchive({
			format: spackFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
