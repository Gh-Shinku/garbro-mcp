import { BufferByteSource } from "@garbro-mcp/core";
import { ankhDatFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const INDEX_START = 4;
const RECORD_SIZE = 0x14;

interface Record {
	name: string;
	payload: Buffer;
}

/** Builds an archive whose index points at the payloads behind it. */
function buildDat(records: readonly Record[]): Buffer {
	const firstOffset = INDEX_START + records.length * RECORD_SIZE;
	const index = Buffer.alloc(firstOffset);
	index.writeInt32LE(records.length, 0);
	index.writeUInt32LE(firstOffset, 0x14);
	let offset = firstOffset;
	const payloads: Buffer[] = [];
	for (const [id, record] of records.entries()) {
		const record0 = INDEX_START + id * RECORD_SIZE;
		index.write(record.name, record0, "latin1");
		index.writeUInt32LE(record.payload.length, record0 + 0xc);
		index.writeUInt32LE(offset, record0 + 0x10);
		payloads.push(record.payload);
		offset += record.payload.length;
	}
	return Buffer.concat([index, ...payloads]);
}

describe("Ankh DAT resource archive", () => {
	it("reads named entries from the index", async () => {
		const first = Buffer.from("plain payload bytes");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: ankhDatFormat,
			archive: buildDat([
				{ name: "FIRST.SCN", payload: first },
				{ name: "SECOND.BIN", payload: second },
			]),
			sourcePath: "/games/DATA.DAT",
			entries: [
				{ path: "FIRST.SCN", size: first.length, content: first },
				{ path: "SECOND.BIN", size: second.length, content: second },
			],
		});
	});

	it("reuses the inherited detection for a folded TPW payload", async () => {
		const content = Buffer.from("BM0000000000000000");
		const head = Buffer.alloc(11);
		Buffer.from("TPW\x01", "binary").copy(head, 0);
		head.writeUInt32LE(content.length, 4);
		head.writeUInt16LE(1, 8);
		head.writeUInt8(content.length, 10);
		await expectArchive({
			format: ankhDatFormat,
			archive: buildDat([
				{ name: "IMAGE.BIN", payload: Buffer.concat([head, content]) },
			]),
			sourcePath: "/games/DATA.DAT",
			entries: [{ path: "IMAGE.bmp", size: content.length, content }],
		});
	});

	it("reuses the inherited opener for an inline LZSS payload", async () => {
		const content = Buffer.from("RIFF lzss payload");
		const payload = Buffer.concat([
			littleWord(content.length),
			literalLzssStream(content),
		]);
		await expectArchive({
			format: ankhDatFormat,
			archive: buildDat([{ name: "SOUND.BIN", payload }]),
			sourcePath: "/games/DATA.DAT",
			entries: [{ path: "SOUND.wav", size: content.length, content }],
		});
	});

	it("rejects a file without the dat extension", async () => {
		const payload = Buffer.from("payload");
		const archive = buildDat([{ name: "A.BIN", payload }]);
		const source = new BufferByteSource(archive);
		expect(await ankhDatFormat.detect(source, "/games/DATA.BIN")).toBe(false);
	});

	it("rejects an index that does not end where the first payload starts", async () => {
		const payload = Buffer.from("payload");
		const archive = buildDat([{ name: "A.BIN", payload }]);
		archive.writeUInt32LE(0x40, 0x14);
		const source = new BufferByteSource(archive);
		expect(await ankhDatFormat.detect(source, "/games/DATA.DAT")).toBe(false);
	});

	it("rejects an empty entry name", async () => {
		const payload = Buffer.from("payload");
		const archive = buildDat([{ name: "\0\0\0", payload }]);
		const source = new BufferByteSource(archive);
		expect(await ankhDatFormat.detect(source, "/games/DATA.DAT")).toBe(false);
	});

	it("rejects a payload that falls outside the archive", async () => {
		const payload = Buffer.from("payload");
		const archive = buildDat([{ name: "A.BIN", payload }]);
		archive.writeUInt32LE(0x1000, INDEX_START + 0x10);
		const source = new BufferByteSource(archive);
		expect(await ankhDatFormat.detect(source, "/games/DATA.DAT")).toBe(false);
	});
});

function littleWord(value: number): Buffer {
	const buffer = Buffer.alloc(4);
	buffer.writeUInt32LE(value, 0);
	return buffer;
}
