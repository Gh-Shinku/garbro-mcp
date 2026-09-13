import { rainBinFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;
const RECORD_SIZE = 12;

interface Entry {
	number: number;
	content: Buffer;
}

/** The count sits at 0 and twelve-byte records follow it, with payloads behind the index. */
function buildRain(entries: readonly Entry[]): Buffer {
	const indexSize = RECORD_SIZE * entries.length;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeUInt32LE(entries.length, 0);
	let data = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt32LE(entry.number, record);
		archive.writeUInt32LE(data, record + 4);
		archive.writeUInt32LE(entry.content.length, record + 8);
		entry.content.copy(archive, data);
		data += entry.content.length;
	}
	return archive;
}

/** An SZDD header, four padding bytes, the unpacked size, then the LZSS stream. */
function szdd(unpackedSize: number, stream: Buffer): Buffer {
	const header = Buffer.alloc(12);
	header.write("SZDD", 0, "ascii");
	header.writeUInt32LE(unpackedSize, 8);
	return Buffer.concat([header, stream]);
}

describe("Rain Software BIN resource archive", () => {
	it("reads plain payloads and decodes SZDD payloads", async () => {
		const plain = Buffer.from("plain body");
		// One control byte drives the whole stream: its low bit emits the literal 'A' at ring position
		// 0xFF0, and the next two clear bits start matches. The first match reads ring offset 0xF00
		// three times, which only yields spaces when the ring fill is 0x20; the second reads ring
		// offset 0xFF0 three times, which yields the literal followed by two fills, proving that the
		// ring starts at 0xFF0. The stream ends there, so the control byte's remaining clear bits are
		// never reached.
		const stream = Buffer.from([0x01, 0x41, 0x00, 0xf0, 0xf0, 0xf0]);
		await expectArchive({
			format: rainBinFormat,
			archive: buildRain([
				{ number: 1, content: plain },
				{ number: 2, content: szdd(7, stream) },
			]),
			sourcePath: "packcgd.bin",
			entries: [
				{ path: "00001.cgd", size: plain.length, content: plain },
				{ path: "00002.cgd", size: 7, content: Buffer.from("A   A  ") },
			],
		});
	});

	it("requires the pack name pattern", async () => {
		const archive = buildRain([{ number: 1, content: Buffer.from("x") }]);
		await expectArchive({
			format: rainBinFormat,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a duplicate entry number", async () => {
		const archive = buildRain([
			{ number: 1, content: Buffer.from("x") },
			{ number: 1, content: Buffer.from("y") },
		]);
		await expectArchive({
			format: rainBinFormat,
			archive,
			sourcePath: "packcgd.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects an offset inside the index", async () => {
		const archive = buildRain([{ number: 1, content: Buffer.from("x") }]);
		archive.writeUInt32LE(0, INDEX_OFFSET + 4);
		await expectArchive({
			format: rainBinFormat,
			archive,
			sourcePath: "packcgd.bin",
			detected: false,
			entries: [],
		});
	});
});
