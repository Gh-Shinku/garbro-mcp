import { plaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x14;

interface PlaEntry {
	id: number;
	sampleRate: number;
	channels: number;
	content: Buffer;
}

function buildPla(entries: readonly PlaEntry[]): Buffer {
	const count = entries.length;
	const parameterSize = count * 16;
	const offsetSize = count * 4;
	const sampleSize =
		entries.reduce((sum, entry) => sum + entry.channels * 2, 0) * 4;
	const dataOffset =
		INDEX_OFFSET + count * 4 + parameterSize + offsetSize + sampleSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	const arcSize = archive.length;
	archive.writeUInt32LE(0x2e616c50, 0);
	archive.writeUInt32LE(arcSize, 4);
	archive.writeUInt32LE(
		(((arcSize & 0xd5555555) << 1) | (arcSize & 0xaaaaaaaa)) >>> 0,
		8,
	);
	archive.writeUInt16LE(count, 0x0e);
	archive.writeUInt32LE(2, 0x10);
	let position = INDEX_OFFSET;
	for (const entry of entries) {
		archive.writeInt32LE(entry.id, position);
		position += 4;
	}
	for (const entry of entries) {
		archive.writeInt32LE(1, position);
		archive.writeUInt32LE(entry.sampleRate, position + 4);
		archive.writeInt32LE(entry.channels, position + 8);
		position += 16;
	}
	let offset = dataOffset;
	for (const entry of entries) {
		archive.writeUInt32LE(offset, position);
		position += 4;
		offset += entry.content.length;
	}
	position += sampleSize;
	offset = dataOffset;
	for (const entry of entries) {
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Squadra D PLA audio archive", () => {
	it("reads the parallel index tables and derives sizes", async () => {
		const first = Buffer.from("first samples");
		const second = Buffer.from("second");
		await expectArchive({
			format: plaFormat,
			archive: buildPla([
				{ id: 3, sampleRate: 22050, channels: 2, content: first },
				{ id: 17, sampleRate: 44100, channels: 1, content: second },
			]),
			sourcePath: "sample.pla",
			entries: [
				{ path: "00003", size: first.length, content: first },
				{ path: "00017", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a wrong check word", async () => {
		const archive = buildPla([
			{ id: 1, sampleRate: 22050, channels: 2, content: Buffer.from("x") },
		]);
		archive.writeUInt32LE(0x12345678, 8);
		await expectArchive({
			format: plaFormat,
			archive,
			sourcePath: "sample.pla",
			detected: false,
			entries: [],
		});
	});

	it("rejects a size that does not match the file", async () => {
		const archive = buildPla([
			{ id: 1, sampleRate: 22050, channels: 2, content: Buffer.from("x") },
		]);
		archive.writeUInt32LE(archive.length + 4, 4);
		await expectArchive({
			format: plaFormat,
			archive,
			sourcePath: "sample.pla",
			detected: false,
			entries: [],
		});
	});
});
