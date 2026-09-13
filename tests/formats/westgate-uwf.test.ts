import { encodeCp932 } from "@garbro-mcp/core";
import { uwfFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x14f0;
const RECORD_SIZE = 0x10;
const NAME_SIZE = 0xc;
const MIN_FILE_SIZE = 0x1500;

/** The index sits past the reserved head, and each record carries its own entry's start. */
function buildUwf(
	entries: readonly { name: string; content: Buffer }[],
): Buffer {
	const indexSize = RECORD_SIZE * entries.length;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		Math.max(MIN_FILE_SIZE + 1, dataOffset) +
			entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	let data = Math.max(MIN_FILE_SIZE + 1, dataOffset);
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(data, record + NAME_SIZE);
		entry.content.copy(archive, data);
		data += entry.content.length;
	}
	return archive;
}

/** A payload shaped like a raw format block, a PCM length word, and the PCM bytes. */
function payload(fmt: Buffer, pcm: Buffer): Buffer {
	const header = Buffer.alloc(2 + fmt.length + 4);
	header.writeUInt16LE(fmt.length, 0);
	fmt.copy(header, 2);
	header.writeUInt32LE(pcm.length, 2 + fmt.length);
	return Buffer.concat([header, pcm]);
}

describe("West Gate UWF audio archive", () => {
	it("synthesizes a RIFF header in front of the PCM bytes", async () => {
		const fmt = Buffer.from([1, 0, 2, 0, 0x44, 0xac, 0, 0]);
		const pcm = Buffer.from([1, 2, 3, 4, 5, 6]);
		const stored = payload(fmt, pcm);
		const expected = Buffer.concat([
			Buffer.from("RIFF", "ascii"),
			Buffer.from([0, 0, 0, 0]),
			Buffer.from("WAVE", "ascii"),
			Buffer.from("fmt ", "ascii"),
			Buffer.from([8, 0, 0, 0]),
			fmt,
			Buffer.from("data", "ascii"),
			Buffer.from([6, 0, 0, 0]),
			pcm,
		]);
		// The reference writes the format and PCM sizes on top of a fixed 0x1C, without subtracting.
		expected.writeUInt32LE(0x1c + fmt.length + pcm.length, 4);
		await expectArchive({
			format: uwfFormat,
			archive: buildUwf([{ name: "one.uwf", content: stored }]),
			sourcePath: "sample.uwf",
			entries: [{ path: "one.uwf", size: stored.length, content: expected }],
		});
	});

	it("extracts payloads that do not match the layout verbatim", async () => {
		const stored = Buffer.from("not a wav payload at all");
		await expectArchive({
			format: uwfFormat,
			archive: buildUwf([{ name: "one.uwf", content: stored }]),
			sourcePath: "sample.uwf",
			entries: [{ path: "one.uwf", size: stored.length, content: stored }],
		});
	});

	it("requires a uwf or arc extension", async () => {
		const stored = Buffer.from("payload body here");
		await expectArchive({
			format: uwfFormat,
			archive: buildUwf([{ name: "one.uwf", content: stored }]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a first offset inside the reserved head", async () => {
		const stored = Buffer.from("payload body here");
		const archive = buildUwf([{ name: "one.uwf", content: stored }]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET + NAME_SIZE);
		await expectArchive({
			format: uwfFormat,
			archive,
			sourcePath: "sample.uwf",
			detected: false,
			entries: [],
		});
	});
});
