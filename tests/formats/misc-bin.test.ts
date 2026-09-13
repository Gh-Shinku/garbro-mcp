import { BufferByteSource } from "@garbro-mcp/core";
import { miscBinFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const INDEX_START = 4;
const INDEX_RECORD_SIZE = 8;

interface EntrySpec {
	/** Bytes stored at the index offset. */
	payload: Buffer;
	/** Index size field; defaults to the payload length. */
	declaredSize?: number;
}

/** Builds an archive whose index records point at the payloads directly behind the index. */
function buildBin(specs: readonly EntrySpec[]): Buffer {
	const firstOffset = INDEX_START + specs.length * INDEX_RECORD_SIZE;
	const index = Buffer.alloc(firstOffset);
	index.writeInt32LE(specs.length, 0);
	index.writeUInt32LE(firstOffset, 4);
	let offset = firstOffset;
	for (const [id, spec] of specs.entries()) {
		index.writeUInt32LE(offset, INDEX_START + id * INDEX_RECORD_SIZE);
		index.writeUInt32LE(
			spec.declaredSize ?? spec.payload.length,
			INDEX_START + id * INDEX_RECORD_SIZE + 4,
		);
		offset += spec.payload.length;
	}
	return Buffer.concat([index, ...specs.map((spec) => spec.payload)]);
}

function messagePayload(content: Buffer): Buffer {
	const stream = literalLzssStream(content);
	const header = Buffer.alloc(4);
	header.writeUInt32LE(stream.length, 0);
	return Buffer.concat([header, stream]);
}

describe("Misc uncategorized BIN archive", () => {
	it("reads a message archive whose index holds unpacked sizes", async () => {
		const content = Buffer.from("message payload bytes");
		await expectArchive({
			format: miscBinFormat,
			archive: buildBin([
				// A message index holds the unpacked size, not the payload length.
				{ payload: messagePayload(content), declaredSize: content.length },
			]),
			sourcePath: "/games/msg.bin",
			entries: [{ path: "msg#00000", size: content.length, content }],
		});
	});

	it("reads a packed entry and types it from its prefix signature", async () => {
		const content = Buffer.from("OggS compressed payload");
		const stream = literalLzssStream(content);
		const position = 12;
		const payload = Buffer.alloc(position + 4);
		payload.writeUInt32LE(position, 4);
		payload.writeUInt32LE(content.length, 8);
		payload.writeUInt32LE(stream.length, position);
		const entry = Buffer.concat([payload, stream]);
		await expectArchive({
			format: miscBinFormat,
			archive: buildBin([{ payload: entry }]),
			sourcePath: "/games/data.bin",
			entries: [{ path: "data#00000.ogg", size: content.length, content }],
		});
	});

	it("reads a stored entry and types it from its payload", async () => {
		const content = Buffer.from("RIFF stored payload");
		const payload = Buffer.alloc(12);
		payload.writeUInt32LE(12, 4);
		payload.writeUInt32LE((1 << 30) | content.length, 8);
		const entry = Buffer.concat([payload, content]);
		await expectArchive({
			format: miscBinFormat,
			archive: buildBin([{ payload: entry }]),
			sourcePath: "/games/data.bin",
			entries: [{ path: "data#00000.wav", size: content.length, content }],
		});
	});

	it("leaves an entry alone when its position points past the index size", async () => {
		const payload = Buffer.alloc(16, 0x41);
		payload.writeUInt32LE(0x1000, 4);
		await expectArchive({
			format: miscBinFormat,
			archive: buildBin([{ payload, declaredSize: 8 }]),
			sourcePath: "/games/data.bin",
			entries: [
				{
					path: "data#00000",
					size: 8,
					content: payload.subarray(0, 8),
				},
			],
		});
	});

	it("rejects an index that does not end where the first payload starts", async () => {
		const archive = buildBin([
			{ payload: Buffer.alloc(16, 0x41), declaredSize: 8 },
		]);
		archive.writeUInt32LE(0x40, 4);
		const source = new BufferByteSource(archive);
		expect(await miscBinFormat.detect(source, "/games/data.bin")).toBe(false);
	});

	it("rejects an entry without a source name", async () => {
		const archive = buildBin([{ payload: Buffer.alloc(16, 0x41) }]);
		const source = new BufferByteSource(archive);
		expect(await miscBinFormat.detect(source, "")).toBe(false);
	});
});
