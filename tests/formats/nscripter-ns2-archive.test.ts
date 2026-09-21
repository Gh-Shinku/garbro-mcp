import { Buffer } from "node:buffer";
import { BufferByteSource, encodeCp932, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	ns2ArchiveFormat,
	readNs2Index,
} from "../../packages/formats/src/nscripter/ns2-archive.js";

const HEADER_SIZE = 4;
const RECORD_MARK = 0x22;

/** One record of the index: a quoted name, then the size of the entry behind it. */
function record(name: string, size: number): Buffer {
	const bytes = encodeCp932(name);
	return Buffer.concat([
		Buffer.from([RECORD_MARK]),
		bytes,
		Buffer.from([RECORD_MARK]),
		(() => {
			const out = Buffer.alloc(4, 0x00);
			out.writeUInt32LE(size, 0);
			return out;
		})(),
	]);
}

/** A container whose entries stand one behind the other from the place its head names. */
function buildNs2(entries: Array<[string, Buffer]>): Buffer {
	const index = Buffer.concat(
		entries.map(([name, body]) => record(name, body.length)),
	);
	const baseOffset = HEADER_SIZE + index.length;
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	head.writeUInt32LE(baseOffset, 0);
	return Buffer.concat([head, index, ...entries.map(([, body]) => body)]);
}

const ENTRIES: Array<[string, Buffer]> = [
	["a.txt", Buffer.alloc(0x10, 0x11)],
	["dir/b.bin", Buffer.alloc(0x20, 0x22)],
	["c.ogg", Buffer.alloc(0x08, 0x33)],
];

async function open(data: Buffer) {
	return ns2ArchiveFormat.open(new BufferByteSource(data), "archive.ns2");
}

describe("NScripter engine resource archive", () => {
	it("reads the index between the head and the data it names", () => {
		const plans = readNs2Index(buildNs2(ENTRIES));
		expect(plans?.map((plan) => plan.name)).toEqual([
			"a.txt",
			"dir/b.bin",
			"c.ogg",
		]);
		// The entries stand one behind the other, so the second begins where the first ends.
		// The head is four bytes, and the three records take thirty seven, so the data begins at 41.
		expect(plans?.[0]).toMatchObject({ offset: 41, size: 0x10 });
		expect((plans?.[1]?.offset ?? 0) - (plans?.[0]?.offset ?? 0)).toBe(0x10);
		expect((plans?.[2]?.offset ?? 0) - (plans?.[1]?.offset ?? 0)).toBe(0x20);
	});

	it("reads a name of more than one byte", () => {
		// A name of the Japanese code page the engine keeps its own names in.
		const file = buildNs2([["あ.bmp", Buffer.alloc(4, 0x44)]]);
		const plans = readNs2Index(file);
		expect(plans?.[0]?.name).toBe("あ.bmp");
	});

	it("hands each entry over as it stands", async () => {
		const handle = await open(buildNs2(ENTRIES));
		expect(handle.entries.map((entry) => entry.path)).toEqual([
			"a.txt",
			"dir/b.bin",
			"c.ogg",
		]);
		const second = handle.entries[1];
		if (!second) throw new Error("no entry");
		expect(second.size).toBe(0x20n);
		expect(await consumeBuffer(await handle.openEntry(second.id))).toEqual(
			Buffer.alloc(0x20, 0x22),
		);
	});

	it("ends the index at a record that does not open with a quote", () => {
		const good = buildNs2([ENTRIES[0] as [string, Buffer]]);
		// The reference walks while the place stands before the head's own place, and stops at a record
		// whose first character is not a quote - so a trailing byte of nothing simply ends the walk.
		const index = good.subarray(HEADER_SIZE, good.readUInt32LE(0));
		const withTail = Buffer.concat([
			Buffer.alloc(HEADER_SIZE, 0x00),
			index,
			Buffer.from([0x00, 0x00, 0x00, 0x00]),
			Buffer.alloc(0x10, 0x11),
		]);
		withTail.writeUInt32LE(HEADER_SIZE + index.length + 4, 0);
		const plans = readNs2Index(withTail);
		expect(plans).toHaveLength(1);
		expect(plans?.[0]?.name).toBe("a.txt");
	});

	it("turns away an index whose place or entry stands outside the file", () => {
		const good = buildNs2(ENTRIES);
		// A place the data may not begin at, and one that stands past the file.
		for (const place of [0, HEADER_SIZE, good.length, good.length + 0x100]) {
			const bad = Buffer.from(good);
			bad.writeUInt32LE(place, 0);
			expect(readNs2Index(bad)).toBeUndefined();
		}
		// A name of nothing, and an entry that reaches past the file.
		const emptyName = Buffer.concat([
			Buffer.alloc(HEADER_SIZE, 0x00),
			Buffer.from([RECORD_MARK, RECORD_MARK]),
			Buffer.alloc(4, 0x00),
		]);
		emptyName.writeUInt32LE(emptyName.length, 0);
		expect(readNs2Index(emptyName)).toBeUndefined();
		const tooBig = Buffer.from(good);
		tooBig.writeUInt32LE(0xffffff, HEADER_SIZE + 1 + 5 + 1);
		expect(readNs2Index(tooBig)).toBeUndefined();
	});

	it("is told by the shape of its index rather than by a word of its own", async () => {
		expect(ns2ArchiveFormat.descriptor.id).toBe("nscripter-ns2-archive");
		const good = buildNs2(ENTRIES);
		expect(
			await ns2ArchiveFormat.detect(new BufferByteSource(good), "archive.ns2"),
		).toBe(true);
		// The reference tries this index for any file at all, so a name of another kind is no bar.
		expect(
			await ns2ArchiveFormat.detect(new BufferByteSource(good), "archive.dat"),
		).toBe(true);
		expect(
			await ns2ArchiveFormat.detect(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"archive.ns2",
			),
		).toBe(false);
		await expect(
			ns2ArchiveFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"archive.ns2",
			),
		).rejects.toThrow(GarbroError);
	});
});
