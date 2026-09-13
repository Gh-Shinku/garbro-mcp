import { BufferByteSource } from "@garbro-mcp/core";
import { archangelDatFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const SOURCE_PATH = "/games/ARCHPAC.DAT";
const SIZE_FIELD_SIZE = 4;
const SECTION_ENTRY_SIZE = 6;

/** Wraps content in the ArchAngel stream the script decoder expects. */
function lzStream(content: Buffer): Buffer {
	const prefix = Buffer.alloc(4);
	prefix.writeInt32LE(content.length, 0);
	return Buffer.concat([prefix, Buffer.from([content.length - 1]), content]);
}

/** A script payload whose declared size cannot be satisfied, which forces the raw fallback. */
function brokenLzStream(length: number): Buffer {
	const prefix = Buffer.alloc(4);
	prefix.writeInt32LE(0x400, 0);
	return Buffer.concat([
		prefix,
		Buffer.alloc(length - 5, 0xff),
		Buffer.from([0xff]),
	]);
}

interface Spec {
	/** Stored size for every file index; zero skips the file without adding an entry. */
	sizes: readonly number[];
	/** Payload for every file index that has a positive size. */
	payloads: readonly Buffer[];
	/** File indices that start a new section, in ascending order. */
	sectionKeys: readonly number[];
}

/**
 * Builds an ARCHPAC.DAT archive: a 16-bit file count, the size table, the section table and finally
 * the payloads, which the sections claim contiguously in ascending key order.
 */
function buildDat(spec: Spec): Buffer {
	const { sizes, payloads, sectionKeys } = spec;
	const fileCount = sizes.length;
	const sizesLength = fileCount * SIZE_FIELD_SIZE;
	const sectionsLength = sectionKeys.length * SECTION_ENTRY_SIZE;
	const payloadStart = 2 + sizesLength + sectionsLength;

	// Walk the sections the way the reference does to learn each base offset and payload order.
	const sectionBases: number[] = [];
	const layout: { index: number; offset: number; size: number }[] = [];
	let cursor = payloadStart;
	for (const key of [...sectionKeys].sort((left, right) => left - right)) {
		sectionBases.push(cursor);
		let fileIndex = key;
		do {
			const size = sizes[fileIndex] ?? 0;
			if (size > 0) {
				layout.push({ index: fileIndex, offset: cursor, size });
				cursor += size;
			}
			fileIndex += 1;
		} while (fileIndex < fileCount && !sectionKeys.includes(fileIndex));
	}

	const archive = Buffer.alloc(cursor);
	archive.writeInt16LE(fileCount, 0);
	for (const [index, size] of sizes.entries())
		archive.writeUInt32LE(size, 2 + index * SIZE_FIELD_SIZE);
	for (const [position, key] of [...sectionKeys]
		.sort((left, right) => left - right)
		.entries()) {
		const record = 2 + sizesLength + position * SECTION_ENTRY_SIZE;
		archive.writeUInt32LE(sectionBases[position] ?? 0, record);
		archive.writeInt16LE(key, record + 4);
	}
	for (const piece of layout) {
		payloads[piece.index]?.copy(archive, piece.offset);
	}
	return archive;
}

describe("ArchAngel engine resource archive", () => {
	it("reads three sections with default typing", async () => {
		const imageA = Buffer.alloc(10, 0xa1);
		const imageB = Buffer.alloc(20, 0xa2);
		const scriptText = Buffer.from("print('hello')");
		const scriptStream = lzStream(scriptText);
		const brokenStream = brokenLzStream(0x30);
		const last = Buffer.alloc(0x10, 0xb1);
		const sizes = [
			imageA.length,
			imageB.length,
			scriptStream.length,
			brokenStream.length,
			last.length,
		];
		const archive = buildDat({
			sizes,
			payloads: [imageA, imageB, scriptStream, brokenStream, last],
			sectionKeys: [0, 2, 4],
		});
		await expectArchive({
			format: archangelDatFormat,
			archive,
			sourcePath: SOURCE_PATH,
			metadata: { entryCount: 5 },
			entries: [
				{ path: "0-000000", size: imageA.length, content: imageA },
				{ path: "0-000001", size: imageB.length, content: imageB },
				{ path: "1-000002", size: scriptStream.length, content: scriptText },
				{ path: "1-000003", size: brokenStream.length, content: brokenStream },
				{ path: "2-000004", size: last.length, content: last },
			],
		});
	});

	it("types sections by position when there are not three of them", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const archive = buildDat({
			sizes: [first.length, first.length, second.length],
			payloads: [first, first, second],
			sectionKeys: [0, 1],
		});
		await expectArchive({
			format: archangelDatFormat,
			archive,
			sourcePath: SOURCE_PATH,
			entries: [
				{ path: "0-000000", size: first.length, content: first },
				{ path: "1-000001", size: first.length, content: first },
				{ path: "1-000002", size: second.length, content: second },
			],
		});
	});

	it("skips zero sizes without advancing the base offset", async () => {
		const first = Buffer.from("first payload");
		const third = Buffer.from("third payload");
		const archive = buildDat({
			sizes: [first.length, 0, third.length],
			payloads: [first, Buffer.alloc(0), third],
			sectionKeys: [0, 2],
		});
		await expectArchive({
			format: archangelDatFormat,
			archive,
			sourcePath: SOURCE_PATH,
			entries: [
				{ path: "0-000000", size: first.length, content: first },
				{ path: "1-000002", size: third.length, content: third },
			],
		});
	});

	it("requires the engine file name", async () => {
		const payload = Buffer.from("payload");
		const archive = buildDat({
			sizes: [payload.length],
			payloads: [payload],
			sectionKeys: [0],
		});
		const source = new BufferByteSource(archive);
		expect(await archangelDatFormat.detect(source, "/games/PACK.DAT")).toBe(
			false,
		);
		expect(await archangelDatFormat.detect(source, SOURCE_PATH)).toBe(true);
	});

	it("rejects a section index beyond the file count", async () => {
		const payload = Buffer.from("payload");
		const archive = buildDat({
			sizes: [payload.length],
			payloads: [payload],
			sectionKeys: [0],
		});
		archive.writeInt16LE(3, 2 + SIZE_FIELD_SIZE + 4);
		const source = new BufferByteSource(archive);
		expect(await archangelDatFormat.detect(source, SOURCE_PATH)).toBe(false);
	});

	it("rejects a payload that falls outside the archive", async () => {
		const payload = Buffer.from("payload");
		const archive = buildDat({
			sizes: [payload.length],
			payloads: [payload],
			sectionKeys: [0],
		});
		archive.writeUInt32LE(archive.length + 0x100, 2 + SIZE_FIELD_SIZE);
		// The walk bound shrinks to the bogus offset, so the section table also disappears.
		const source = new BufferByteSource(archive);
		expect(await archangelDatFormat.detect(source, SOURCE_PATH)).toBe(false);
	});

	it("rejects a size field that runs past the end of the file", async () => {
		const payload = Buffer.from("payload");
		const archive = buildDat({
			sizes: [payload.length],
			payloads: [payload],
			sectionKeys: [0],
		});
		// Claim one more file than the archive can describe.
		archive.writeInt16LE(1, 0);
		const truncated = archive.subarray(0, 4);
		const source = new BufferByteSource(truncated);
		expect(await archangelDatFormat.detect(source, SOURCE_PATH)).toBe(false);
	});
});
