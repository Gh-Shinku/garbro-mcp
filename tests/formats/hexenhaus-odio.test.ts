import { odioFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const FIRST_OFFSET_OFFSET = 0x12;
const RECORD_SIZE = 6;
const ONCE_HEADER_SIZE = 0x2c;

function rotateNibbles(data: Buffer): Buffer {
	const rotated = Buffer.from(data);
	for (const [index, value] of data.entries())
		rotated[index] = ((value >> 4) | (value << 4)) & 0xff;
	return rotated;
}

function buildOdio(entries: readonly Buffer[]): Buffer {
	const dataOffset = FIRST_OFFSET_OFFSET + entries.length * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.length, 0),
	);
	archive.write("ODIO", 0, "ascii");
	archive.writeUInt32LE(0xccae01ff, 0x0a);
	archive.writeUInt32LE(dataOffset, FIRST_OFFSET_OFFSET);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		// Record `id` starts with the data offset of entry `id`; the remaining two bytes are unused.
		archive.writeUInt32LE(offset, FIRST_OFFSET_OFFSET + RECORD_SIZE * id);
		entry.copy(archive, offset);
		offset += entry.length;
	}
	return archive;
}

describe("Hexenhaus ODIO archive", () => {
	it("reads 6-byte records and extracts generated .ogg names", async () => {
		const first = Buffer.from("first audio");
		const second = Buffer.from("second");
		await expectArchive({
			format: odioFormat,
			archive: buildOdio([first, second]),
			sourcePath: "voice.bin",
			entries: [
				{ path: "voice#0000.ogg", size: first.length, content: first },
				{ path: "voice#0001.ogg", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("unwraps ONCE containers with a nibble rotation", async () => {
		const payload = Buffer.from("ONCE payload body");
		const stored = Buffer.concat([
			Buffer.from("ONCE", "ascii"),
			Buffer.alloc(ONCE_HEADER_SIZE - 4),
			rotateNibbles(payload),
		]);
		await expectArchive({
			format: odioFormat,
			archive: buildOdio([stored]),
			sourcePath: "voice.bin",
			entries: [
				{ path: "voice#0000.ogg", size: payload.length, content: payload },
			],
		});
	});

	it("rejects a missing marker", async () => {
		const archive = buildOdio([Buffer.from("x")]);
		archive.writeUInt32LE(0x11223344, 0x0a);
		await expectArchive({
			format: odioFormat,
			archive,
			sourcePath: "voice.bin",
			detected: false,
			entries: [],
		});
	});
});
