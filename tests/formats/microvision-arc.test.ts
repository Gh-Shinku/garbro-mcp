import { encodeCp932 } from "@garbro-mcp/core";
import { microVisionArcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const HEADER_STEP = 0x0c;
const INDEX_STEP = 7;
const RECORD_SIZE = 0x20;
const NAMES_ALIGNMENT = 0x80;

/** Writes a word the way GARbro's `ArcReader` reads it: four bytes across a fixed stride. */
function writeStrided(
	buffer: Buffer,
	offset: number,
	step: number,
	value: number,
): void {
	for (let index = 0; index < 4; index += 1)
		buffer[offset + step * index] = (value >>> (8 * index)) & 0xff;
}

interface Entry {
	name: string;
	stored: Buffer;
	unpackedSize?: number;
}

function buildArc(entries: readonly Entry[]): Buffer {
	const count = entries.length;
	const indexOffset = 0x40;
	const indexEnd = indexOffset + count * RECORD_SIZE;
	const namesOffset = (indexEnd + NAMES_ALIGNMENT - 1) & ~(NAMES_ALIGNMENT - 1);
	const names = Buffer.concat(
		entries.map((entry) =>
			Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
		),
	);
	// Payloads start behind the aligned index area, which GARbro requires to stay inside the file.
	const dataOffset =
		(namesOffset + names.length + NAMES_ALIGNMENT - 1) & ~(NAMES_ALIGNMENT - 1);
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.stored.length, 0),
	);
	archive.write("ARC1", 0, "ascii");
	writeStrided(archive, 4, HEADER_STEP, indexOffset);
	writeStrided(archive, 8, HEADER_STEP, namesOffset);
	writeStrided(archive, 9, HEADER_STEP, names.length);
	writeStrided(archive, 0x0d, HEADER_STEP, count);
	names.copy(archive, namesOffset);
	let namePosition = 0;
	let dataPosition = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * RECORD_SIZE;
		writeStrided(archive, record + 2, INDEX_STEP, namesOffset + namePosition);
		writeStrided(
			archive,
			record + 3,
			INDEX_STEP,
			encodeCp932(entry.name).length + 1,
		);
		writeStrided(archive, record + 4, INDEX_STEP, dataPosition);
		writeStrided(archive, record + 5, INDEX_STEP, entry.stored.length);
		writeStrided(
			archive,
			record + 6,
			INDEX_STEP,
			entry.unpackedSize ?? entry.stored.length,
		);
		entry.stored.copy(archive, dataPosition);
		namePosition += encodeCp932(entry.name).length + 1;
		dataPosition += entry.stored.length;
	}
	return archive;
}

describe("MicroVision resource archive", () => {
	it("reads strided header and index words", async () => {
		const raw = Buffer.from("plain payload");
		await expectArchive({
			format: microVisionArcFormat,
			archive: buildArc([
				{ name: "data/one.bin", stored: raw },
				{ name: "two.bin", stored: Buffer.from("second!") },
			]),
			sourcePath: "sample.arc",
			entries: [
				{ path: "data/one.bin", size: raw.length, content: raw },
				{ path: "two.bin", size: 7, content: Buffer.from("second!") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("expands packed entries with the engine LZ variant", async () => {
		// A literal, then a match at frame position 1 with length five: only the top control bit is
		// set, so the second item is the match.
		const packed = Buffer.from([0x80, 0x41, 0x00, 0x13]);
		const expected = Buffer.from("AAAAAA");
		await expectArchive({
			format: microVisionArcFormat,
			archive: buildArc([
				{
					name: "packed.bin",
					stored: packed,
					unpackedSize: expected.length,
				},
			]),
			sourcePath: "sample.arc",
			entries: [
				{ path: "packed.bin", size: expected.length, content: expected },
			],
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildArc([{ name: "a.bin", stored: Buffer.from("x") }]);
		archive.write("ARC2", 0, "ascii");
		await expectArchive({
			format: microVisionArcFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("rejects a payload outside the file", async () => {
		const archive = buildArc([{ name: "a.bin", stored: Buffer.from("x") }]);
		writeStrided(archive, 0x40 + 5, INDEX_STEP, 0x100000);
		await expectArchive({
			format: microVisionArcFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});
});
