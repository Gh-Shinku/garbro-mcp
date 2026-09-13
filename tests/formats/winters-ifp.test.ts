import { ifpFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x10;

interface IfpEntry {
	type: number;
	maskType?: number;
	content: Buffer;
	mask?: Buffer;
}

function buildIfp(entries: readonly IfpEntry[]): Buffer {
	const count = entries.length + 1;
	const indexSize = count * RECORD_SIZE;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset +
			entries.reduce(
				(sum, entry) => sum + entry.content.length + (entry.mask?.length ?? 0),
				0,
			),
	);
	archive.writeUInt32LE(0x53474149, 0);
	archive.write("_IFP_01     ", 4, "ascii");
	archive.writeInt32LE(1, 0x10);
	archive.writeInt32LE(indexSize, 0x18);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt16LE(entry.type, record);
		archive.writeUInt16LE(entry.maskType ?? 0, record + 2);
		archive.writeUInt32LE(offset, record + 4);
		archive.writeUInt32LE(entry.content.length, record + 8);
		archive.writeUInt32LE(entry.mask?.length ?? 0, record + 12);
		entry.content.copy(archive, position);
		position += entry.content.length;
		if (entry.mask) {
			entry.mask.copy(archive, position);
			position += entry.mask.length;
		}
		offset = position;
	}
	return archive;
}

describe("Winters IFP archive", () => {
	it("maps payload types to extensions and reads mask layers", async () => {
		const bitmap = Buffer.from("BM payload");
		const mask = Buffer.from("BM mask");
		const script = Buffer.from("script body");
		await expectArchive({
			format: ifpFormat,
			archive: buildIfp([
				{ type: 0x0b, maskType: 0x0b, content: bitmap, mask },
				{ type: 0x15, content: script },
			]),
			sourcePath: "sample.ifp",
			entries: [
				{ path: "sample#00000.bmp", size: bitmap.length, content: bitmap },
				{ path: "sample#00000M.bmp", size: mask.length, content: mask },
				{ path: "sample#00001", size: script.length, content: script },
			],
			metadata: { entryCount: 3 },
		});
	});

	it("skips zero-type records", async () => {
		const payload = Buffer.from("png data");
		await expectArchive({
			format: ifpFormat,
			archive: buildIfp([
				{ type: 0, content: Buffer.from("ignored") },
				{ type: 0x0c, content: payload },
			]),
			sourcePath: "sample.ifp",
			entries: [
				{ path: "sample#00001.png", size: payload.length, content: payload },
			],
		});
	});

	it("rejects a wrong version marker", async () => {
		const archive = buildIfp([{ type: 0x0b, content: Buffer.from("x") }]);
		archive.writeInt32LE(2, 0x10);
		await expectArchive({
			format: ifpFormat,
			archive,
			sourcePath: "sample.ifp",
			detected: false,
			entries: [],
		});
	});
});
