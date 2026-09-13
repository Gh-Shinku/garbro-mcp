import { BufferByteSource } from "@garbro-mcp/core";
import { shapeShifterBndFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const INDEX_START = 4;
const RECORD_SIZE = 12;

interface Record {
	content: Buffer;
	/** Store the payload as an LZSS stream and declare its unpacked size. */
	packed?: boolean;
}

/** Builds an archive whose index points at the payloads behind it. */
function buildBnd(records: readonly Record[]): Buffer {
	const firstOffset = INDEX_START + records.length * RECORD_SIZE;
	const index = Buffer.alloc(firstOffset);
	index.writeInt32LE(records.length, 0);
	index.writeUInt32LE(firstOffset, 4);
	let offset = firstOffset;
	const payloads: Buffer[] = [];
	for (const [id, record] of records.entries()) {
		const record0 = INDEX_START + id * RECORD_SIZE;
		const payload = record.packed
			? literalLzssStream(record.content)
			: record.content;
		index.writeUInt32LE(offset, record0);
		index.writeUInt32LE(record.content.length, record0 + 4);
		index.writeUInt32LE(payload.length, record0 + 8);
		payloads.push(payload);
		offset += payload.length;
	}
	return Buffer.concat([index, ...payloads]);
}

describe("ShapeShifter BND resource archive", () => {
	it("types entries from the archive name", async () => {
		const content = Buffer.from("script payload");
		await expectArchive({
			format: shapeShifterBndFormat,
			archive: buildBnd([{ content }]),
			sourcePath: "/games/SCR.BND",
			entries: [{ path: "SCR#0000", size: content.length, content }],
		});
	});

	it("retypes an unpacked bitmap payload", async () => {
		const content = Buffer.concat([
			Buffer.from([0x07]),
			Buffer.from("BM bitmap payload"),
		]);
		await expectArchive({
			format: shapeShifterBndFormat,
			archive: buildBnd([{ content }]),
			sourcePath: "/games/DATA.BND",
			entries: [{ path: "DATA#0000.bmp", size: content.length, content }],
		});
	});

	it("decodes a packed entry without a bitmap marker", async () => {
		const content = Buffer.from("packed payload bytes");
		await expectArchive({
			format: shapeShifterBndFormat,
			archive: buildBnd([{ content, packed: true }]),
			sourcePath: "/games/DATA.BND",
			entries: [{ path: "DATA#0000", size: content.length, content }],
		});
	});

	it("keeps the archive-name type for audio archives", async () => {
		const content = Buffer.from("voice payload");
		await expectArchive({
			format: shapeShifterBndFormat,
			archive: buildBnd([{ content }]),
			sourcePath: "/games/VOICE.BND",
			entries: [{ path: "VOICE#0000", size: content.length, content }],
		});
	});

	it("rejects an index that does not end where the first payload starts", async () => {
		const archive = buildBnd([{ content: Buffer.alloc(8, 0x41) }]);
		archive.writeUInt32LE(0x40, 4);
		const source = new BufferByteSource(archive);
		expect(await shapeShifterBndFormat.detect(source, "/games/DATA.BND")).toBe(
			false,
		);
	});

	it("rejects a payload that falls outside the archive", async () => {
		const archive = buildBnd([{ content: Buffer.alloc(8, 0x41) }]);
		archive.writeUInt32LE(0x1000, INDEX_START + 8);
		const source = new BufferByteSource(archive);
		expect(await shapeShifterBndFormat.detect(source, "/games/DATA.BND")).toBe(
			false,
		);
	});
});
