import { encodeCp932 } from "@garbro-mcp/core";
import { cgfFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;

interface Entry {
	name: string;
	content: Buffer;
	flags?: number;
}

/**
 * Builds a CGF archive: the count sits at 0, the records start at 4, and each record's trailing word
 * holds that entry's own start offset with optional flag bits in the top bits.
 */
function buildCgf(entries: readonly Entry[], entrySize: 0x14 | 0x20): Buffer {
	const count = entries.length;
	const indexSize = count * entrySize;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt32LE(count, 0);
	const offsets: number[] = [];
	let offset = dataOffset;
	for (const entry of entries) {
		offsets.push(offset);
		offset += entry.content.length;
	}
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * entrySize;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(
			((offsets[id] ?? 0) | ((entry.flags ?? 0) << 30)) >>> 0,
			record + entrySize - 4,
		);
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

/** Wrapped entries store the payload length, four header bytes, then the payload itself. */
function wrapped(
	body: Buffer,
	tail = Buffer.from("TAIL"),
): {
	stored: Buffer;
	expected: Buffer;
} {
	const sizeWord = Buffer.alloc(4);
	sizeWord.writeUInt32LE(body.length, 0);
	return {
		stored: Buffer.concat([sizeWord, tail, body]),
		expected: Buffer.concat([Buffer.alloc(8), tail, body]),
	};
}

describe("route2 engine CGF CG archive", () => {
	it("reads 0x14-byte records", async () => {
		const first = wrapped(Buffer.from("first frame"));
		const second = wrapped(Buffer.from("second!"));
		await expectArchive({
			format: cgfFormat,
			archive: buildCgf(
				[
					{ name: "one.cgf", content: first.stored },
					{ name: "two.cgf", content: second.stored },
				],
				0x14,
			),
			sourcePath: "sample.cgf",
			entries: [
				{
					path: "one.cgf",
					size: first.stored.length,
					content: first.expected,
				},
				{
					path: "two.cgf",
					size: second.stored.length,
					content: second.expected,
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads 0x20-byte records and keeps flag bits out of offsets", async () => {
		const skipped = Buffer.from("0123456789abcdef");
		const inner = wrapped(Buffer.from("flagged"), Buffer.from("MARK"));
		const content = Buffer.concat([skipped, inner.stored]);
		await expectArchive({
			format: cgfFormat,
			archive: buildCgf([{ name: "a.cgf", content, flags: 2 }], 0x20),
			sourcePath: "sample.cgf",
			entries: [
				{
					path: "a.cgf",
					size: content.length,
					// Flag `2` replaces the leading zeros of the header with the record's first bytes.
					content: Buffer.concat([
						skipped.subarray(0, 8),
						Buffer.from("MARK"),
						Buffer.from("flagged"),
					]),
				},
			],
		});
	});

	it("leaves iaf entries and single-bit flags raw", async () => {
		const first = Buffer.concat([
			Buffer.from("0123456789abcdef"),
			Buffer.from("tail"),
		]);
		const second = Buffer.from("raw payload");
		await expectArchive({
			format: cgfFormat,
			archive: buildCgf(
				[
					{ name: "a.iaf", content: first, flags: 2 },
					{ name: "b.cgf", content: second, flags: 1 },
				],
				0x14,
			),
			sourcePath: "sample.cgf",
			entries: [
				{ path: "a.iaf", size: first.length, content: first },
				{ path: "b.cgf", size: second.length, content: second },
			],
		});
	});

	it("rejects an index that matches neither record width", async () => {
		const archive = buildCgf(
			[{ name: "a.cgf", content: Buffer.from("x") }],
			0x14,
		);
		archive.writeUInt32LE(0, 0x14);
		await expectArchive({
			format: cgfFormat,
			archive,
			sourcePath: "sample.cgf",
			detected: false,
			entries: [],
		});
	});

	it("rejects a blank name", async () => {
		const archive = buildCgf(
			[{ name: "a.cgf", content: Buffer.from("x") }],
			0x14,
		);
		archive.fill(0, INDEX_OFFSET, INDEX_OFFSET + 0x10);
		await expectArchive({
			format: cgfFormat,
			archive,
			sourcePath: "sample.cgf",
			detected: false,
			entries: [],
		});
	});
});
