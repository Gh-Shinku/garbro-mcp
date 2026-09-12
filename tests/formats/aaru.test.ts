import { encodeCp932 } from "@garbro-mcp/core";
import { fl2Format, fl3Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

interface AaruEntry {
	name: string;
	payload: Buffer;
}

function buildIndex(entries: AaruEntry[]): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const name = encodeCp932(entry.name);
		const record = Buffer.alloc(5 + name.length + 1);
		record.writeUInt32LE(entry.payload.length, 0);
		record.writeUInt8(name.length + 1, 4);
		name.copy(record, 5);
		parts.push(record);
	}
	parts.push(Buffer.from([0xff, 0xff, 0xff, 0xff]));
	return Buffer.concat(parts);
}

function buildAaru(kind: "fl2" | "fl3", entries: AaruEntry[]): Buffer {
	const index = buildIndex(entries);
	const dataOffset = 0x40;
	const indexOffset =
		dataOffset + entries.reduce((sum, e) => sum + e.payload.length, 0);
	const total = indexOffset + index.length;
	const archive = Buffer.alloc(total);
	if (kind === "fl2") {
		archive.write("FL2.0", 0, "ascii");
		archive.writeUInt16LE(dataOffset, 6);
		archive.writeInt16LE(entries.length, 8);
		archive.writeUInt32LE(index.length, 0x0c);
		archive.writeUInt32LE(indexOffset, 0x10);
	} else {
		archive.write("FL3.0", 0, "ascii");
		archive.writeUInt16LE(dataOffset, 8);
		archive.writeUInt32LE(index.length, 0x0a);
		archive.writeUInt32LE(indexOffset, 0x0e);
		archive.writeInt32LE(entries.length, 0x12);
	}
	let offset = dataOffset;
	for (const entry of entries) {
		entry.payload.copy(archive, offset);
		offset += entry.payload.length;
	}
	index.copy(archive, indexOffset);
	return archive;
}

function pd2aPayload(content: Buffer): Buffer {
	const header = Buffer.alloc(16);
	header.write("PD2A", 0, "ascii");
	header.writeUInt32LE(content.length, 12);
	return Buffer.concat([header, literalLzssStream(content)]);
}

function rlePayload(content: Buffer): Buffer {
	const header = Buffer.alloc(14);
	header.write("RD1.0", 0, "ascii");
	header.writeUInt16LE(14, 6);
	header.writeInt32LE(1, 0x0a);
	// One chunk: control 3 followed by a 16-bit count and one repeated byte.
	const rle = Buffer.from([
		3,
		content.length & 0xff,
		content.length >> 8,
		content[0] ?? 0,
	]);
	return Buffer.concat([header, rle]);
}

describe("Aaru FL2/FL3 archive", () => {
	it("decompresses PD2A and RD1.0 entries and passes raw data through", async () => {
		const script = Buffer.from("AAAA");
		await expectArchive({
			format: fl2Format,
			archive: buildAaru("fl2", [
				{ name: "raw.bin", payload: Buffer.from("aa") },
				{
					name: "script.pd2",
					payload: pd2aPayload(Buffer.from("script body")),
				},
				{ name: "rle.bin", payload: rlePayload(script) },
			]),
			entries: [
				{ path: "raw.bin", size: 2, content: Buffer.from("aa") },
				{
					path: "script.pd2",
					size: pd2aPayload(Buffer.from("script body")).length,
					content: Buffer.from("script body"),
				},
				{ path: "rle.bin", size: rlePayload(script).length, content: script },
			],
			metadata: { entryCount: 3 },
		});
	});

	it("reads the FL3 layout with a 32-bit count", async () => {
		await expectArchive({
			format: fl3Format,
			archive: buildAaru("fl3", [
				{ name: "a.bin", payload: Buffer.from("aa") },
			]),
			entries: [{ path: "a.bin", size: 2, content: Buffer.from("aa") }],
			metadata: { entryCount: 1 },
		});
	});
});
