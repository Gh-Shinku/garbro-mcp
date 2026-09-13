import { deflateSync } from "node:zlib";
import { BufferByteSource } from "@garbro-mcp/core";
import { nitroplusPakFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0x118;

interface FileItem {
	kind: "file";
	name: string;
	unpacked: Buffer;
	packed?: Buffer;
}

interface DirectoryItem {
	kind: "dir";
	name: string;
}

type Item = FileItem | DirectoryItem;

interface BuiltPak {
	archive: Buffer;
	/** The uncompressed index, so tests can patch records and repack. */
	index: Buffer;
	payloads: Buffer;
}

/** Encodes one index and returns it together with the payload region it addresses. */
function encodeIndex(
	version: number,
	items: readonly Item[],
	offsets: readonly number[],
): Buffer {
	const chunks: Buffer[] = [];
	let fileIndex = 0;
	for (const item of items) {
		const nameField = Buffer.from(`${item.name}\0`, "latin1");
		const header = Buffer.alloc(4);
		header.writeInt32LE(nameField.length, 0);
		chunks.push(header, nameField);
		if (item.kind === "dir") {
			const flag = Buffer.alloc(4);
			flag.writeInt32LE(1, 0);
			// Directory records carry three extra words the reference skips.
			chunks.push(flag, Buffer.alloc(20));
			continue;
		}
		if (version > 3) {
			const flag = Buffer.alloc(4);
			flag.writeInt32LE(0, 0);
			chunks.push(flag);
		}
		const record = Buffer.alloc(20);
		record.writeUInt32LE(offsets[fileIndex] ?? 0, 0);
		record.writeUInt32LE(item.unpacked.length, 4);
		record.writeUInt32LE(0, 8);
		const compressed = item.packed !== undefined;
		record.writeUInt32LE(compressed ? 1 : 0, 12);
		record.writeUInt32LE(compressed ? (item.packed?.length ?? 0) : 0, 16);
		chunks.push(record);
		fileIndex += 1;
	}
	return Buffer.concat(chunks);
}

/** Builds an archive whose index is a zlib stream at 0x118 and whose payloads follow it. */
function buildPak(version: number, items: readonly Item[]): BuiltPak {
	const files = items.filter((item): item is FileItem => item.kind === "file");
	const offsets: number[] = [];
	let cursor = 0;
	for (const file of files) {
		offsets.push(cursor);
		cursor += (file.packed ?? file.unpacked).length;
	}
	const payloads = Buffer.concat(
		files.map((file) => file.packed ?? file.unpacked),
	);
	const index = encodeIndex(version, items, offsets);
	return repack(version, items.length, index, payloads);
}

/** Rebuilds an archive around a (possibly patched) index. Offsets stay index-relative. */
function repack(
	version: number,
	count: number,
	index: Buffer,
	payloads: Buffer,
): BuiltPak {
	const compressedIndex = deflateSync(index);
	const header = Buffer.alloc(INDEX_OFFSET);
	header.writeInt32LE(version, 0);
	header.writeInt32LE(count, 4);
	header.writeUInt32LE(compressedIndex.length, 0xc);
	return {
		archive: Buffer.concat([header, compressedIndex, payloads]),
		index,
		payloads,
	};
}

describe("MAGI PAK resource archive", () => {
	it("reads a zlib index with packed and verbatim entries", async () => {
		const raw = Buffer.from("verbatim payload");
		const unpacked = Buffer.from("packed payload contents");
		const { archive } = buildPak(3, [
			{ kind: "file", name: "raw.bin", unpacked: raw },
			{
				kind: "file",
				name: "packed.bin",
				unpacked,
				packed: deflateSync(unpacked),
			},
		]);
		await expectArchive({
			format: nitroplusPakFormat,
			archive,
			metadata: { entryCount: 2, version: 3 },
			entries: [
				{ path: "raw.bin", size: raw.length, content: raw },
				{ path: "packed.bin", size: unpacked.length, content: unpacked },
			],
		});
	});

	it("applies version 4 directory records to the entries that follow", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const { archive } = buildPak(4, [
			{ kind: "dir", name: "data" },
			{ kind: "file", name: "one.bin", unpacked: first },
			{
				kind: "file",
				name: "two.bin",
				unpacked: second,
				packed: deflateSync(second),
			},
		]);
		await expectArchive({
			format: nitroplusPakFormat,
			archive,
			metadata: { entryCount: 2, version: 4 },
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "data/two.bin", size: second.length, content: second },
			],
		});
	});

	it("rejects an unsupported version", async () => {
		const { archive } = buildPak(2, [
			{ kind: "file", name: "raw.bin", unpacked: Buffer.from("x") },
		]);
		const source = new BufferByteSource(archive);
		expect(await nitroplusPakFormat.detect(source)).toBe(false);
	});

	it("rejects an index that is not a zlib stream", async () => {
		const { archive } = buildPak(3, [
			{ kind: "file", name: "raw.bin", unpacked: Buffer.from("x") },
		]);
		archive.fill(0, INDEX_OFFSET, INDEX_OFFSET + 8);
		const source = new BufferByteSource(archive);
		expect(await nitroplusPakFormat.detect(source)).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const built = buildPak(3, [
			{ kind: "file", name: "raw.bin", unpacked: Buffer.from("payload") },
		]);
		// The first record starts after the four-byte name length and the name itself.
		built.index.writeUInt32LE(0x1000, 4 + "raw.bin\0".length + 4);
		const { archive } = repack(3, 1, built.index, built.payloads);
		const source = new BufferByteSource(archive);
		expect(await nitroplusPakFormat.detect(source)).toBe(false);
	});
});
