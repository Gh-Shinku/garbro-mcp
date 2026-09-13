import { unknownDatFormat } from "@garbro-mcp/formats";
import { describe, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 12;
const RECORD_SIZE = 12;

interface Entry {
	id: number;
	payload: Buffer;
}

function rotateNibbles(data: Buffer): Buffer {
	const output = Buffer.alloc(data.length);
	for (let index = 0; index < data.length; index += 1) {
		const value = data[index] ?? 0;
		output[index] = ((value >> 4) | (value << 4)) & 0xff;
	}
	return output;
}

function buildDat(entries: readonly Entry[]): Buffer {
	const dataOffset = HEADER_SIZE + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset +
			entries.reduce((total, entry) => total + entry.payload.length, 0),
	);
	archive.writeInt32LE(entries.length, 0);
	archive.writeInt32LE(RECORD_SIZE, 4);
	archive.writeInt32LE(dataOffset, 8);
	let offset = dataOffset;
	const index = Buffer.alloc(entries.length * RECORD_SIZE);
	for (const [position, entry] of entries.entries()) {
		const record = position * RECORD_SIZE;
		index.writeInt32LE(entry.id, record);
		index.writeUInt32LE(entry.payload.length, record + 4);
		index.writeUInt32LE(offset, record + 8);
		rotateNibbles(entry.payload).copy(archive, offset);
		offset += entry.payload.length;
	}
	rotateNibbles(index).copy(archive, HEADER_SIZE);
	return archive;
}

describe("'Unknown' DAT resource archive", () => {
	it("decrypts the index and payloads", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: unknownDatFormat,
			archive: buildDat([
				{ id: 7, payload: first },
				{ id: 42, payload: second },
			]),
			sourcePath: "no_reality.dat",
			entries: [
				{ path: "no_reality#0007", size: first.length, content: first },
				{ path: "no_reality#0042", size: second.length, content: second },
			],
			metadata: { entryCount: 2, encryption: "nibble-rotation" },
		});
	});

	it("rejects an index that does not end at the payload offset", async () => {
		const archive = buildDat([{ id: 0, payload: Buffer.from("x") }]);
		archive.writeInt32LE(archive.length, 8);
		await expectArchive({
			format: unknownDatFormat,
			archive,
			sourcePath: "no_reality.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects an offset in front of the payload area", async () => {
		const archive = buildDat([{ id: 0, payload: Buffer.from("x") }]);
		// The index is nibble-swapped, so write the swapped form of offset zero.
		const record = HEADER_SIZE;
		archive[record + 8] = 0;
		archive[record + 9] = 0;
		archive[record + 10] = 0;
		archive[record + 11] = 0;
		await expectArchive({
			format: unknownDatFormat,
			archive,
			sourcePath: "no_reality.dat",
			detected: false,
			entries: [],
		});
	});

	it("rejects a record stride above 0x10", async () => {
		const archive = buildDat([{ id: 0, payload: Buffer.from("x") }]);
		archive.writeInt32LE(0x11, 4);
		await expectArchive({
			format: unknownDatFormat,
			archive,
			sourcePath: "no_reality.dat",
			detected: false,
			entries: [],
		});
	});
});
