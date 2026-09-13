import { BufferByteSource } from "@garbro-mcp/core";
import { malieLibuFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x10;
const NAME_SIZE = 0x44;
const RECORD_SIZE = NAME_SIZE + 12;

function blockHeader(count: number): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("LIBU", 0, "ascii");
	header.writeInt32LE(count, 8);
	return header;
}

/** A record whose offset is relative to the block it belongs to. */
function record(name: string, size: number, relativeOffset: number): Buffer {
	const entry = Buffer.alloc(RECORD_SIZE);
	entry.write(name, 0, "utf16le");
	entry.writeUInt32LE(size, NAME_SIZE);
	entry.writeBigInt64LE(BigInt(relativeOffset), NAME_SIZE + 4);
	return entry;
}

describe("Malie LIBU resource archive", () => {
	it("reads entries with raw payloads", async () => {
		const content = Buffer.from("stored payload");
		const archive = Buffer.concat([
			blockHeader(1),
			record("FILE.BIN", content.length, HEADER_SIZE + RECORD_SIZE),
			content,
		]);
		await expectArchive({
			format: malieLibuFormat,
			archive,
			entries: [{ path: "FILE.BIN", size: content.length, content }],
		});
	});

	it("descends into a nested block and prefixes its paths", async () => {
		const content = Buffer.from("nested payload");
		const nestedOffset = HEADER_SIZE + RECORD_SIZE;
		const payloadOffset = nestedOffset + HEADER_SIZE + RECORD_SIZE;
		const archive = Buffer.concat([
			blockHeader(1),
			record("SUBDIR", 0, nestedOffset),
			blockHeader(1),
			record("INNER.DAT", content.length, payloadOffset - nestedOffset),
			content,
		]);
		await expectArchive({
			format: malieLibuFormat,
			archive,
			entries: [
				{
					path: "SUBDIR/INNER.DAT",
					size: content.length,
					content,
				},
			],
		});
	});

	it("lists a name without a dot when its target is not a block", async () => {
		const content = Buffer.from("plain payload");
		const archive = Buffer.concat([
			blockHeader(1),
			record("NOEXT", content.length, HEADER_SIZE + RECORD_SIZE),
			content,
		]);
		await expectArchive({
			format: malieLibuFormat,
			archive,
			entries: [{ path: "NOEXT", size: content.length, content }],
		});
	});

	it("lists a dotted name even when its target is a block", async () => {
		const archive = Buffer.concat([
			blockHeader(1),
			record("DIR.BIN", 0, HEADER_SIZE + RECORD_SIZE),
			blockHeader(1),
			record("INNER.DAT", 0, 0),
		]);
		await expectArchive({
			format: malieLibuFormat,
			archive,
			entries: [{ path: "DIR.BIN", size: 0, content: Buffer.alloc(0) }],
		});
	});

	it("rejects a foreign signature", async () => {
		const archive = Buffer.alloc(HEADER_SIZE + RECORD_SIZE);
		archive.write("XXXX", 0, "ascii");
		archive.writeInt32LE(1, 8);
		const source = new BufferByteSource(archive);
		expect(await malieLibuFormat.detect(source)).toBe(false);
	});

	it("rejects an empty root block", async () => {
		const source = new BufferByteSource(blockHeader(0));
		expect(await malieLibuFormat.detect(source)).toBe(false);
	});

	it("rejects a payload that falls outside the archive", async () => {
		const archive = Buffer.concat([
			blockHeader(1),
			record("FILE.BIN", 0x40, 0x1000),
		]);
		const source = new BufferByteSource(archive);
		expect(await malieLibuFormat.detect(source)).toBe(false);
	});
});
