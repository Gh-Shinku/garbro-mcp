import { crc32 } from "@garbro-mcp/codecs";
import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { paletteChrFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { buffer as consumeBuffer } from "node:stream/consumers";

const PNG_SIGNATURE = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const PNG_FOOTER = Buffer.from([
	0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82,
]);
const INDEX_OFFSET_FIELD = 4;
const FIRST_PAYLOAD_OFFSET = 8;
const CHAR_HEADER_SIZE = 8;

interface Frame {
	name: string;
	payload: Buffer;
	offsetX?: number;
	offsetY?: number;
}

/** A PNG body: an IHDR chunk followed by opaque trailing bytes. */
function pngBody(tail: Buffer): Buffer {
	const chunk = Buffer.alloc(4 + 13 + 4);
	chunk.writeUInt32BE(13, 0);
	chunk.write("IHDR", 4, "latin1");
	chunk.writeUInt32BE(1, 8);
	chunk.writeUInt32BE(1, 12);
	chunk.writeUInt8(8, 16);
	chunk.writeUInt8(6, 17);
	return Buffer.concat([chunk, tail]);
}

/** Lays out a Palette CHR archive. */
function buildChr(base: Buffer, frames: readonly Frame[]): Buffer {
	const records: Buffer[] = [];
	for (const frame of frames) {
		const record = Buffer.alloc(1 + frame.name.length + 4);
		record.writeUInt8(frame.name.length, 0);
		record.write(frame.name, 1, "latin1");
		const size = CHAR_HEADER_SIZE + frame.payload.length;
		record.writeUInt32LE(size, 1 + frame.name.length);
		const header = Buffer.alloc(CHAR_HEADER_SIZE);
		header.writeInt16LE(frame.offsetX ?? 0, 0);
		header.writeInt16LE(frame.offsetY ?? 0, 2);
		records.push(record, header, frame.payload);
	}
	const indexOffset = FIRST_PAYLOAD_OFFSET + base.length;
	const count = Buffer.alloc(4);
	count.writeInt32LE(frames.length, 0);
	const header = Buffer.alloc(FIRST_PAYLOAD_OFFSET);
	header.write("char", 0, "latin1");
	header.writeUInt32LE(indexOffset, INDEX_OFFSET_FIELD);
	return Buffer.concat([header, base, count, ...records]);
}

describe("Palette CHR archive", () => {
	it("reads a single frame archive", async () => {
		const body = pngBody(Buffer.from("base sprite"));
		await expectArchive({
			format: paletteChrFormat,
			sourcePath: "chara.chr",
			archive: buildChr(body, []),
			entries: [
				{
					path: "chara#0.png",
					size: body.length,
					content: Buffer.concat([PNG_SIGNATURE, body, PNG_FOOTER]),
				},
			],
			metadata: { entryCount: 1 },
		});
	});

	it("lists a blended stand-in for every frame", async () => {
		const body = pngBody(Buffer.from("base"));
		const frame = pngBody(Buffer.from("frame"));
		await expectArchive({
			format: paletteChrFormat,
			sourcePath: "chara.chr",
			archive: buildChr(body, [{ name: "a", payload: frame }]),
			entries: [
				{
					path: "chara#0.png",
					size: body.length,
					content: Buffer.concat([PNG_SIGNATURE, body, PNG_FOOTER]),
				},
				{
					path: "chara#a.png",
					size: frame.length,
					content: Buffer.concat([PNG_SIGNATURE, frame, PNG_FOOTER]),
				},
				{ path: "chara#blend#a.png", size: 0, content: Buffer.alloc(0) },
			],
			metadata: { entryCount: 3 },
		});
	});

	it("injects a frame offset chunk", async () => {
		const body = pngBody(Buffer.from("base"));
		const frame = pngBody(Buffer.from("frame"));
		const file = buildChr(body, [
			{ name: "a", payload: frame, offsetX: 0x12, offsetY: -4 },
		]);
		const archive = await paletteChrFormat.open(
			new BufferByteSource(file),
			"chara.chr",
		);
		try {
			const entry = archive.entries[1];
			expect(entry).toBeDefined();
			const data = await consumeBuffer(
				await archive.openEntry(entry?.id ?? ""),
			);
			expect(data.subarray(0, 8)).toEqual(PNG_SIGNATURE);
			// The oFFs chunk follows the copied IHDR chunk.
			const chunk = data.subarray(8 + 21, 8 + 21 + 21);
			expect(chunk.readUInt32BE(0)).toBe(9);
			expect(chunk.subarray(4, 8).toString("latin1")).toBe("oFFs");
			expect(chunk.readInt32BE(8)).toBe(0x12);
			expect(chunk.readInt32BE(12)).toBe(-4);
			expect(chunk.readUInt8(16)).toBe(0);
			expect(chunk.readUInt32BE(17)).toBe(crc32(chunk.subarray(4, 17)));
			expect(data.subarray(data.length - 12)).toEqual(PNG_FOOTER);
		} finally {
			await archive.close();
		}
	});

	it("omits the chunk for a zero offset", async () => {
		const body = pngBody(Buffer.from("base"));
		const frame = pngBody(Buffer.from("frame"));
		const file = buildChr(body, [{ name: "a", payload: frame }]);
		const archive = await paletteChrFormat.open(
			new BufferByteSource(file),
			"chara.chr",
		);
		try {
			const entry = archive.entries[1];
			const data = await consumeBuffer(
				await archive.openEntry(entry?.id ?? ""),
			);
			expect(data.indexOf("oFFs", 0, "latin1")).toBe(-1);
			expect(data).toEqual(Buffer.concat([PNG_SIGNATURE, frame, PNG_FOOTER]));
		} finally {
			await archive.close();
		}
	});

	it("skips records without a payload", async () => {
		const body = pngBody(Buffer.from("base"));
		const file = buildChr(body, [{ name: "a", payload: Buffer.alloc(0) }]);
		const archive = await paletteChrFormat.open(
			new BufferByteSource(file),
			"chara.chr",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"chara#0.png",
			]);
		} finally {
			await archive.close();
		}
	});

	it("reads cp932 frame names", async () => {
		const body = pngBody(Buffer.from("base"));
		const frame = pngBody(Buffer.from("frame"));
		const file = buildChr(body, [
			{ name: encodeCp932("あ").toString("latin1"), payload: frame },
		]);
		const archive = await paletteChrFormat.open(
			new BufferByteSource(file),
			"chara.chr",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"chara#0.png",
				"chara#あ.png",
				"chara#blend#あ.png",
			]);
		} finally {
			await archive.close();
		}
	});

	it("registers the char signature", () => {
		const signatures = paletteChrFormat.detection?.signatures ?? [];
		expect(Buffer.from(signatures[0]?.bytes ?? []).toString("latin1")).toBe(
			"char",
		);
	});

	it("rejects an index offset inside the header", async () => {
		const body = pngBody(Buffer.from("base"));
		const file = buildChr(body, []);
		file.writeUInt32LE(4, INDEX_OFFSET_FIELD);
		expect(
			await paletteChrFormat.detect(new BufferByteSource(file), "a.chr"),
		).toBe(false);
	});

	it("rejects an entry outside the file", async () => {
		const body = pngBody(Buffer.from("base"));
		const frame = pngBody(Buffer.from("frame"));
		const file = buildChr(body, [{ name: "a", payload: frame }]);
		const indexOffset = FIRST_PAYLOAD_OFFSET + body.length;
		file.writeUInt32LE(0x1000, indexOffset + 4 + 1 + 1);
		expect(
			await paletteChrFormat.detect(new BufferByteSource(file), "a.chr"),
		).toBe(false);
	});
});
