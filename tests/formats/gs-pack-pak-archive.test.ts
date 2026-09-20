import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { literalLzssStream } from "../helpers/lzss.js";
import {
	gsPackPakFormat,
	packGsPackNameKey,
	readGsPackLayout,
	unpackGsPackEntry,
} from "../../packages/formats/src/gs-pack/pak-archive.js";

const INDEX_AT = 0x80;
const DATA_AT = 0x400;
const SHORT_RECORD = 0x48;
const LONG_RECORD = 0x68;
const ENCRYPTED_INDEX = 1;
const ENCRYPTED_DATA = 2;

interface FixtureEntry {
	name: string;
	data: Buffer;
}

/** One index record: a name of at most sixty four bytes, then the offset and the size. */
function record(
	entry: FixtureEntry,
	offset: number,
	recordSize: number,
): Buffer {
	const out = Buffer.alloc(recordSize, 0x00);
	Buffer.from(entry.name, "latin1").copy(
		out,
		0,
		0,
		Math.min(entry.name.length, 0x3f),
	);
	out.writeUInt32LE(offset, 0x40);
	out.writeUInt32LE(entry.data.length, 0x44);
	return out;
}

/** A `GsPack` archive, with an index that may be packed and XORed and records that may be folded. */
function buildGsPack(options: {
	entries: (FixtureEntry | null)[];
	mark?: string;
	versionMajor?: number;
	packIndex?: boolean;
	encryptIndex?: boolean;
	encryptData?: boolean;
	dataOffset?: number;
}): Buffer {
	const mark = options.mark ?? "DataPack5";
	const recordSize =
		(options.versionMajor ?? 5) < 5 ? SHORT_RECORD : LONG_RECORD;
	const dataOffset = options.dataOffset ?? DATA_AT;
	const records: Buffer[] = [];
	const data: Buffer[] = [];
	let at = 0;
	for (const entry of options.entries) {
		if (!entry) {
			records.push(Buffer.alloc(recordSize, 0x00));
			continue;
		}
		const stored =
			options.encryptData === true
				? unpackGsPackEntry(Buffer.from(entry.data), entry.name, true)
				: entry.data;
		records.push(record(entry, at, recordSize));
		data.push(stored);
		at += entry.data.length;
	}
	const index = Buffer.concat(records);
	const stored = options.packIndex
		? literalLzssStream(index)
		: Buffer.from(index);
	if (options.encryptIndex === true) {
		for (let i = 0; i !== stored.length; i += 1)
			stored[i] = (stored[i] ?? 0) ^ (i & 0xff);
	}
	const indexSize = options.packIndex ? stored.length : 0;
	const file = Buffer.alloc(dataOffset + at, 0x00);
	file.write(mark, 0, "latin1");
	file.writeUInt16LE(1, 0x30);
	file.writeUInt16LE(options.versionMajor ?? 5, 0x32);
	file.writeUInt32LE(indexSize, 0x34);
	file.writeUInt32LE(
		(options.encryptIndex === true ? ENCRYPTED_INDEX : 0) |
			(options.encryptData === true ? ENCRYPTED_DATA : 0),
		0x38,
	);
	// The count is the number of records, blank ones included; a blank record is walked past.
	file.writeInt32LE(options.entries.length, 0x3c);
	file.writeUInt32LE(dataOffset, 0x40);
	file.writeInt32LE(INDEX_AT, 0x44);
	stored.copy(file, INDEX_AT);
	let dataAt = dataOffset;
	for (const part of data) {
		part.copy(file, dataAt);
		dataAt += part.length;
	}
	return file;
}

describe("GsPack resource archive", () => {
	it("folds a record name into its own key", () => {
		// The name is folded by repeated multiplication and its case is dropped on the way.
		expect(packGsPackNameKey("")).toBe(0);
		expect(packGsPackNameKey("a")).toBe(0x61);
		expect(packGsPackNameKey("ab")).toBe(0x61 * 37 + 0x62);
		expect(packGsPackNameKey("Ab")).toBe(packGsPackNameKey("ab"));
		expect(packGsPackNameKey("ABC")).toBe(packGsPackNameKey("abc"));
	});

	it("reads the header of all three marks and refuses anything else", async () => {
		for (const mark of ["DataPack5", "GsPack5", "GsPack4"]) {
			const file = buildGsPack({
				mark,
				entries: [{ name: "a.txt", data: Buffer.from("hello", "latin1") }],
			});
			const layout = await readGsPackLayout(
				new BufferByteSource(file),
				"image01.pak",
			);
			expect(layout?.entries).toHaveLength(1);
			expect(layout?.defaultType).toBe("image");
		}
		const other = buildGsPack({
			mark: "DataPack9",
			entries: [{ name: "a.txt", data: Buffer.from("hello", "latin1") }],
		});
		expect(
			await readGsPackLayout(new BufferByteSource(other), "a.pak"),
		).toBeUndefined();
		expect(
			await readGsPackLayout(
				new BufferByteSource(Buffer.alloc(0x20, 0)),
				"a.pak",
			),
		).toBeUndefined();
		const noEntries = buildGsPack({ entries: [] });
		expect(
			await readGsPackLayout(new BufferByteSource(noEntries), "a.pak"),
		).toBeUndefined();
	});

	it("takes the record size from the major version", async () => {
		const entries = [
			{ name: "one.bin", data: Buffer.from("one", "latin1") },
			{ name: "two.bin", data: Buffer.from("two!", "latin1") },
		];
		const older = await readGsPackLayout(
			new BufferByteSource(buildGsPack({ entries, versionMajor: 4 })),
			"voice01.pak",
		);
		expect(older?.entrySize).toBe(SHORT_RECORD);
		expect(older?.defaultType).toBe("audio");
		expect(older?.entries.map((entry) => entry.name)).toEqual([
			"one.bin",
			"two.bin",
		]);
		const newer = await readGsPackLayout(
			new BufferByteSource(buildGsPack({ entries, versionMajor: 5 })),
			"other.pak",
		);
		expect(newer?.entrySize).toBe(LONG_RECORD);
		expect(newer?.defaultType).toBe("");
	});

	it("walks the records of a stored index", async () => {
		{
			const file = buildGsPack({
				entries: [
					{ name: "one.bin", data: Buffer.from("one", "latin1") },
					null, // a record without a name, which the reference walks past
					{ name: "two.bin", data: Buffer.from("two!", "latin1") },
				],
			});
			const layout = await readGsPackLayout(
				new BufferByteSource(file),
				"a.pak",
			);
			if (!layout) throw new Error("no layout");
			expect(layout.entries.map((entry) => entry.name)).toEqual([
				"one.bin",
				"two.bin",
			]);
			expect(layout.entries[0]?.offset).toBe(BigInt(DATA_AT));
			expect(layout.entries[0]?.size).toBe(3n);
			expect(layout.entries[1]?.offset).toBe(BigInt(DATA_AT + 3));
			expect(layout.entries[1]?.size).toBe(4n);
		}
	});

	it("unpacks a packed and mixed index", async () => {
		const entries = [
			{ name: "one.bin", data: Buffer.from("one", "latin1") },
			{ name: "two.bin", data: Buffer.from("two!", "latin1") },
		];
		const packed = await readGsPackLayout(
			new BufferByteSource(buildGsPack({ entries, packIndex: true })),
			"a.pak",
		);
		expect(packed?.entries.map((entry) => entry.name)).toEqual([
			"one.bin",
			"two.bin",
		]);
		const mixed = await readGsPackLayout(
			new BufferByteSource(
				buildGsPack({ entries, packIndex: true, encryptIndex: true }),
			),
			"a.pak",
		);
		expect(mixed?.entries.map((entry) => entry.name)).toEqual([
			"one.bin",
			"two.bin",
		]);
	});

	it("refuses a record that would leave the file", async () => {
		const file = buildGsPack({
			entries: [{ name: "one.bin", data: Buffer.from("one", "latin1") }],
			encryptIndex: false,
		});
		// The one record's size is pushed past the end of the archive.
		file.writeUInt32LE(0x1000, INDEX_AT + 0x44);
		expect(
			await readGsPackLayout(new BufferByteSource(file), "a.pak"),
		).toBeUndefined();
	});

	it("hands an unencrypted record over and unfolds an encrypted one", async () => {
		const plain = Buffer.from("plain record", "latin1");
		const open = buildGsPack({ entries: [{ name: "one.bin", data: plain }] });
		const openLayout = await readGsPackLayout(
			new BufferByteSource(open),
			"a.pak",
		);
		expect(openLayout?.encrypted).toBe(false);
		expect(unpackGsPackEntry(plain, "one.bin", false).equals(plain)).toBe(true);
		// A name of one letter folds into 0x61, so every word of the stored record is mixed with it.
		const folded = Buffer.from("fold", "latin1");
		const stored = Buffer.alloc(4, 0x00);
		stored.writeUInt32LE(0x646c6f66 ^ 0x61, 0);
		const secret = buildGsPack({
			entries: [{ name: "a", data: folded }],
			encryptData: true,
		});
		const secretLayout = await readGsPackLayout(
			new BufferByteSource(secret),
			"a.pak",
		);
		expect(secretLayout?.encrypted).toBe(true);
		expect(
			unpackGsPackEntry(stored, "a", true).equals(
				Buffer.from("fold", "latin1"),
			),
		).toBe(true);
		// A record whose length is not a whole number of words keeps its last bytes.
		const tail = Buffer.from([1, 2, 3, 4, 5, 6]);
		const mixed = unpackGsPackEntry(tail, "a", true);
		expect(mixed.subarray(4).equals(Buffer.from([5, 6]))).toBe(true);
		expect(mixed.readUInt32LE(0)).toBe((0x04030201 ^ 0x61) >>> 0);
	});

	it("detects, lists and extracts through the registered format", async () => {
		const file = buildGsPack({
			entries: [
				{ name: "one.bin", data: Buffer.from("one", "latin1") },
				{ name: "two.bin", data: Buffer.from("two!", "latin1") },
			],
			encryptData: true,
		});
		await expect(
			gsPackPakFormat.detect(new BufferByteSource(file), "image01.pak"),
		).resolves.toBe(true);
		// The other two marks are of a different length, so each is detected over its own.
		for (const mark of ["GsPack5", "GsPack4"]) {
			await expect(
				gsPackPakFormat.detect(
					new BufferByteSource(buildGsPack({ mark, entries: [] })),
					"other.pak",
				),
			).resolves.toBe(false);
			await expect(
				readGsPackLayout(
					new BufferByteSource(
						buildGsPack({
							mark,
							entries: [
								{ name: "one.bin", data: Buffer.from("one", "latin1") },
							],
						}),
					),
					"other.pak",
				),
			).resolves.toBeDefined();
		}
		await expect(
			gsPackPakFormat.detect(
				new BufferByteSource(Buffer.alloc(0x80, 0)),
				"image01.pak",
			),
		).resolves.toBe(false);
		const archive = await gsPackPakFormat.open(
			new BufferByteSource(file),
			"image01.pak",
		);
		expect(archive.entries.map((entry) => entry.path)).toEqual([
			"one.bin",
			"two.bin",
		]);
		expect(archive.metadata.defaultType).toBe("image");
		const first = archive.entries[0];
		if (!first) throw new Error("no entry");
		expect(first.encrypted).toBe(true);
		const extracted = await consumeBuffer(await archive.openEntry(first.id));
		expect(extracted.toString("latin1")).toBe("one");
		await expect(
			gsPackPakFormat.open(
				new BufferByteSource(Buffer.alloc(0x80, 0)),
				"a.pak",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
