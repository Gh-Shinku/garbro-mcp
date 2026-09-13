import { deflateRawSync } from "node:zlib";
import { BufferByteSource } from "@garbro-mcp/core";
import { debonosuPakFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0x10;
const INFO_SIZE = 0x14;
const DIRECTORY_FLAG = 0x10;

interface IndexEntry {
	kind: "file";
	name: string;
	content: Buffer;
}
interface IndexDirectory {
	kind: "dir";
	name: string;
	children: IndexNode[];
}
type IndexNode = IndexEntry | IndexDirectory;

/** Lays out one index record: three sizes, flags, three timestamps and a null terminated name. */
function record(
	name: string,
	offset: number,
	unpackedLength: number,
	storedLength: number,
	flags: number,
): Buffer {
	const head = Buffer.alloc(8 + 8 + 8 + 4 + 8 * 3);
	head.writeBigInt64LE(BigInt(offset), 0);
	head.writeBigInt64LE(BigInt(unpackedLength), 8);
	head.writeBigInt64LE(BigInt(storedLength), 16);
	head.writeUInt32LE(flags, 24);
	return Buffer.concat([head, Buffer.from(`${name}\0`, "latin1")]);
}

/** Builds the unpacked index and collects the payloads in record order. */
function buildIndex(nodes: readonly IndexNode[]): {
	index: Buffer;
	payloads: Buffer[];
} {
	const chunks: Buffer[] = [];
	const payloads: Buffer[] = [];
	let running = 0;
	const walk = (items: readonly IndexNode[]): void => {
		for (const item of items) {
			if (item.kind === "dir") {
				chunks.push(
					record(item.name, 0, item.children.length, 0, DIRECTORY_FLAG),
				);
				walk(item.children);
				continue;
			}
			const stored = deflateRawSync(item.content);
			chunks.push(
				record(item.name, running, item.content.length, stored.length, 0),
			);
			payloads.push(stored);
			running += stored.length;
		}
	};
	walk(nodes);
	return { index: Buffer.concat(chunks), payloads };
}

/**
 * Builds a PAK/Debonosu archive. The packed index follows the info block at the index offset, and
 * payload offsets are relative to the end of the packed index.
 */
function buildArchive(nodes: readonly IndexNode[]): Buffer {
	const { index, payloads } = buildIndex(nodes);
	return buildFromIndex(index, payloads, nodes.length);
}

/** Builds an archive around an already packed-and-patched unpacked index. */
function buildFromIndex(
	index: Buffer,
	payloads: readonly Buffer[],
	rootCount = 1,
): Buffer {
	const packed = deflateRawSync(index);
	const indexHeader = Buffer.alloc(INFO_SIZE);
	indexHeader.writeUInt32LE(INFO_SIZE, 0);
	indexHeader.writeInt32LE(rootCount, 8);
	indexHeader.writeUInt32LE(index.length, 0x0c);
	indexHeader.writeUInt32LE(packed.length, 0x10);

	const header = Buffer.alloc(INDEX_OFFSET);
	header.write("PAK\0", 0, "latin1");
	header.writeUInt16LE(INDEX_OFFSET, 4);
	return Buffer.concat([header, indexHeader, packed, ...payloads]);
}

describe("Debonosu PAK resource archive", () => {
	it("lists entries from a flat index and inflates their payloads", async () => {
		const first = Buffer.from("first payload, repeated payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: debonosuPakFormat,
			archive: buildArchive([
				{ kind: "file", name: "FIRST.BIN", content: first },
				{ kind: "file", name: "SECOND.BIN", content: second },
			]),
			sourcePath: "sample.pak",
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "SECOND.BIN", size: second.length, content: second },
			],
		});
	});

	it("prefixes the paths of nested directories", async () => {
		const nested = Buffer.from("nested payload");
		const deep = Buffer.from("deep payload");
		await expectArchive({
			format: debonosuPakFormat,
			archive: buildArchive([
				{
					kind: "dir",
					name: "DATA",
					children: [
						{ kind: "file", name: "OUTER.BIN", content: nested },
						{
							kind: "dir",
							name: "INNER",
							children: [{ kind: "file", name: "DEEP.BIN", content: deep }],
						},
					],
				},
			]),
			sourcePath: "sample.pak",
			entries: [
				{ path: "DATA/OUTER.BIN", size: nested.length, content: nested },
				{ path: "DATA/INNER/DEEP.BIN", size: deep.length, content: deep },
			],
		});
	});

	it("reports the unpacked size apart from the stored size", async () => {
		const content = Buffer.from("a".repeat(200));
		const archive = buildArchive([{ kind: "file", name: "LONG.BIN", content }]);
		const source = new BufferByteSource(archive);
		const handle = await debonosuPakFormat.open(source, "sample.pak");
		const entry = handle.entries[0];
		if (!entry) throw new Error("Missing entry");
		expect(entry.compressed).toBe(true);
		expect(entry.size).toBe(BigInt(content.length));
		expect(entry.packedSize).toBeLessThan(entry.size);
	});

	it("rejects a foreign signature", async () => {
		const archive = buildArchive([
			{ kind: "file", name: "A.BIN", content: Buffer.from("payload") },
		]);
		archive.write("PAX\0", 0, "latin1");
		expect(
			await debonosuPakFormat.detect(
				new BufferByteSource(archive),
				"sample.pak",
			),
		).toBe(false);
	});

	it("rejects a file whose second header word is set", async () => {
		const archive = buildArchive([
			{ kind: "file", name: "A.BIN", content: Buffer.from("payload") },
		]);
		archive.writeUInt16LE(1, 10);
		expect(
			await debonosuPakFormat.detect(
				new BufferByteSource(archive),
				"sample.pak",
			),
		).toBe(false);
	});

	it("rejects an empty root directory", async () => {
		const archive = buildArchive([
			{ kind: "file", name: "A.BIN", content: Buffer.from("payload") },
		]);
		archive.writeInt32LE(0, INDEX_OFFSET + 8);
		expect(
			await debonosuPakFormat.detect(
				new BufferByteSource(archive),
				"sample.pak",
			),
		).toBe(false);
	});

	it("rejects a packed index that reaches past the archive", async () => {
		const archive = buildArchive([
			{ kind: "file", name: "A.BIN", content: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x10000, INDEX_OFFSET + 0x10);
		expect(
			await debonosuPakFormat.detect(
				new BufferByteSource(archive),
				"sample.pak",
			),
		).toBe(false);
	});

	it("rejects an index that is not a deflate stream", async () => {
		const archive = buildArchive([
			{ kind: "file", name: "A.BIN", content: Buffer.from("payload") },
		]);
		const packedOffset = INDEX_OFFSET + INFO_SIZE;
		for (let index = 0; index < 8; index += 1)
			archive.writeUInt8(0xff, packedOffset + index);
		expect(
			await debonosuPakFormat.detect(
				new BufferByteSource(archive),
				"sample.pak",
			),
		).toBe(false);
	});

	it("rejects a directory whose child count overruns the index", async () => {
		const { index, payloads } = buildIndex([
			{
				kind: "dir",
				name: "DATA",
				children: [{ kind: "file", name: "A.BIN", content: Buffer.from("x") }],
			},
		]);
		// The directory record is the first one, so its child count sits at the index start.
		index.writeBigInt64LE(5n, 8);
		expect(
			await debonosuPakFormat.detect(
				new BufferByteSource(buildFromIndex(index, payloads)),
				"sample.pak",
			),
		).toBe(false);
	});

	it("rejects an entry whose payload falls outside the archive", async () => {
		const { index, payloads } = buildIndex([
			{ kind: "file", name: "A.BIN", content: Buffer.from("payload") },
		]);
		index.writeBigInt64LE(0x1000n, 0);
		expect(
			await debonosuPakFormat.detect(
				new BufferByteSource(buildFromIndex(index, payloads)),
				"sample.pak",
			),
		).toBe(false);
	});

	it("rejects a directory tree deeper than the port allows", async () => {
		let node: IndexNode = {
			kind: "file",
			name: "LEAF.BIN",
			content: Buffer.from("leaf"),
		};
		for (let depth = 0; depth < 70; depth += 1)
			node = { kind: "dir", name: `D${depth}`, children: [node] };
		const archive = buildArchive([node]);
		expect(
			await debonosuPakFormat.detect(
				new BufferByteSource(archive),
				"sample.pak",
			),
		).toBe(false);
	});
});
