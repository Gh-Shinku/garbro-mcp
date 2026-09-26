// The Entis GLS archive port, against archives built in the test: the head of the archive of the engine (the
// word of the format, the identifier of the kind of it) and the counts of the walk of the engine of the index
// of it (`DirEntry`, of the places of the count of the walk of the picture of every count of the archive, of
// the places of the count of the walk of the engine of its own and of the places of the count of the walk of
// the engine behind them).
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { entisNoaFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

const HEAD = 0x40;
const DIR_ENTRY_HEAD = 0x10;
const ENTRY_HEAD = 0x10;
const ENTRY_STRIDE = 0x20;
const ATTR_DIRECTORY = 0x10;
const ATTR_LAST = 0x20;
const ATTR_LAST_LONG = 0x40;
const RAW = 0x00000000;
const ERISA = 0x80000010;
const BSHF = 0x40000000;

interface NoaRecord {
	name: string;
	/** The places of a count of the file of the archive, of a count of a colour of it. */
	data?: Buffer;
	/** The counts of the walk of the engine of the places of the count of the walk of the picture of it. */
	directory?: { index: Buffer; payload?: Buffer };
	attr?: number;
	encryption?: number;
	extra?: Buffer;
	/** The counts of the places of the count of the walk of the engine the head of the count stands of. */
	recorded?: number;
}

/** The counts of the walk of the engine of the places of the count of the walk of the engine of the record. */
function recordBytes(record: NoaRecord, relative: bigint): Buffer {
	const name = Buffer.from(record.name, "latin1");
	const extra = record.extra ?? Buffer.alloc(0);
	const head = Buffer.alloc(ENTRY_STRIDE);
	head.writeUInt32LE(record.recorded ?? record.data?.length ?? 0, 0);
	head.writeUInt32LE(record.attr ?? 0, 8);
	head.writeUInt32LE(record.encryption ?? RAW, 0x0c);
	head.writeBigInt64LE(relative, 0x10);
	const tail = Buffer.alloc(4 + extra.length + 4 + name.length);
	tail.writeUInt32LE(extra.length, 0);
	extra.copy(tail, 4);
	tail.writeUInt32LE(name.length, 4 + extra.length);
	name.copy(tail, 8 + extra.length);
	return Buffer.concat([head, tail]);
}

/** The counts of the walk of the engine of the places of the count of the walk of the engine of a file. */
function fileEntry(data: Buffer): Buffer {
	const head = Buffer.alloc(ENTRY_HEAD);
	head.writeBigUInt64LE(BigInt(data.length), 8);
	return Buffer.concat([head, data]);
}

/** The counts of the walk of the engine of the count of the walk of the engine of a count of the archive. */
function dirEntry(
	records: readonly NoaRecord[],
	offsets: readonly bigint[],
): Buffer {
	const body = Buffer.concat([
		Buffer.from([records.length & 0xff, (records.length >> 8) & 0xff, 0, 0]),
		...records.map((record, at) => recordBytes(record, offsets[at] ?? 0n)),
	]);
	const head = Buffer.alloc(DIR_ENTRY_HEAD);
	head.write("DirEntry", 0, "latin1");
	head.writeBigInt64LE(BigInt(DIR_ENTRY_HEAD + body.length), 8);
	return Buffer.concat([head, body]);
}

/**
 * `DirEntry`: the counts of the walk of the engine of the places of an archive of the engine, of the places
 * of the count of the walk of the engine of every count of the walk of the picture of it. The counts of the
 * walk of the engine of the count of the walk of the picture stand of the counts of the walk of the engine of
 * the places of the count of the walk of the picture of the count of the walk of the engine behind them.
 */
function buildNoa(input: {
	signature: string;
	records: readonly NoaRecord[];
}): { file: Buffer; offsets: number[] } {
	const head = Buffer.alloc(HEAD);
	head.write(input.signature, 0, "latin1");
	head.writeUInt32LE(0x02000400, 8);
	const empty = dirEntry(
		input.records,
		input.records.map(() => 0n),
	);
	let at = HEAD + empty.length;
	const offsets: number[] = [];
	const payloads: Buffer[] = [];
	for (const record of input.records) {
		offsets.push(at);
		const payload =
			record.directory !== undefined
				? Buffer.concat([
						Buffer.alloc(ENTRY_HEAD),
						record.directory.index,
						record.directory.payload ?? Buffer.alloc(0),
					])
				: (() => {
						const entry = Buffer.alloc(ENTRY_HEAD);
						const data = record.data ?? Buffer.alloc(0);
						entry.writeBigUInt64LE(BigInt(data.length), 8);
						return Buffer.concat([entry, data]);
					})();
		payloads.push(payload);
		at += payload.length;
	}
	const index = dirEntry(
		input.records,
		offsets.map((offset) => BigInt(offset - HEAD)),
	);
	expect(index.length).toBe(empty.length);
	return { file: Buffer.concat([head, index, ...payloads]), offsets };
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("Entis GLS archive", () => {
	it("stands of the counts of the walk of the engine of the places of the count of the archive", async () => {
		// The places of the count of the walk of the engine stand of the counts of the walk of the engine of
		// the places of the count of the walk of the picture of its own: the counts of the walk of the engine
		// of the count of the walk of the picture stand of the counts of the walk of the engine of the count
		// of the walk of the engine itself.
		const first = Buffer.from("the places of the first count");
		const extra = Buffer.from(
			"the places of the count of the walk of the engine",
		);
		const last = Buffer.from("the places of the last count");
		const { file } = buildNoa({
			signature: "Entis\x1a",
			records: [
				{ name: "first.bin", data: first },
				{ name: "extra.bin", data: extra, extra: Buffer.from("the count") },
				{ name: "last.bin", data: last },
				{ name: "term.bin", attr: ATTR_LAST },
				{ name: "behind.bin", data: Buffer.from("no count at all") },
			],
		});
		const source = sourceOf(file);
		expect(await entisNoaFormat.detect(source, "archive.noa")).toBe(true);
		const archive = await entisNoaFormat.open(source, "archive.noa");
		try {
			// The counts of the walk of the engine of the places of the count of the walk of the engine
			// behind a count of the last place of the walk of the picture stand of no place of the archive at
			// all.
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"first.bin",
				"extra.bin",
				"last.bin",
			]);
			expect(archive.metadata).toMatchObject({
				entryCount: 3,
				encrypted: false,
			});
			const [firstEntry, extraEntry] = archive.entries;
			if (!firstEntry || !extraEntry) throw new Error("missing entry");
			expect(
				await consumeBuffer(await archive.openEntry(firstEntry.id)),
			).toEqual(first);
			expect(
				await consumeBuffer(await archive.openEntry(extraEntry.id)),
			).toEqual(extra);
		} finally {
			await archive.close();
		}
	});

	it("stands of the counts of the walk of the engine of the places of the count of the walk of the picture", async () => {
		// The counts of the walk of the picture of the archive stand of the counts of the walk of the engine
		// of the count of the walk of the engine of the count of the walk of the picture of its own: the
		// places of the count of the walk of the picture stand of the places of the count of the walk of the
		// engine of the count of the walk of the picture of the archive.
		const nested = Buffer.from(
			"the places of the count of the walk of the picture",
		);
		// The counts of the walk of the engine of the count of the walk of the picture of the places of the
		// count of the walk of the engine of its own stand behind the counts of the walk of the engine of the
		// places of the count of the walk of the engine of the count of the walk of the picture itself.
		const innerAt = dirEntry(
			[{ name: "inner.bin", data: nested }],
			[0n],
		).length;
		const inner = dirEntry(
			[{ name: "inner.bin", data: nested }],
			[BigInt(innerAt)],
		);
		const { file } = buildNoa({
			signature: "Entis\x1a",
			records: [
				{
					name: "dir",
					directory: { index: inner, payload: fileEntry(nested) },
					attr: ATTR_DIRECTORY,
				},
				{
					name: "top.bin",
					data: Buffer.from("the places of the count above it"),
				},
			],
		});
		const source = sourceOf(file);
		const archive = await entisNoaFormat.open(source, "archive.noa");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"dir/inner.bin",
				"top.bin",
			]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.compressed).toBe(false);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				nested,
			);
		} finally {
			await archive.close();
		}
	});

	it("stands of the counts of the walk of the engine of the places of a count of the walk of the engine of its own", async () => {
		// A count of the walk of the engine of the kind `ERISACode` stands of the counts of the walk of the
		// engine of the count of the walk of the engine of the `Nemesis` of it, which stand unported here; a
		// count of the walk of the engine of the counts of the walk of the engine of a count of the walk of
		// it of its own stands refused as well (the reference stands of the places of the count of the walk
		// of the engine of the counts of a colour of the engine of the counts of the walk of it).
		const data = Buffer.from(
			"the places of the count of the walk of the engine",
		);
		const { file } = buildNoa({
			signature: "VIST\x1a",
			records: [
				{ name: "packed.bin", data, encryption: ERISA },
				{ name: "crypt.bin", data, encryption: BSHF },
			],
		});
		const source = sourceOf(file);
		expect(await entisNoaFormat.detect(source, "archive.noa")).toBe(true);
		const archive = await entisNoaFormat.open(source, "archive.noa");
		try {
			expect(archive.metadata).toMatchObject({ encrypted: true });
			expect(archive.entries.map((entry) => entry.compressed)).toEqual([
				true,
				true,
			]);
			for (const entry of archive.entries) {
				const failure = await archive.openEntry(entry.id).then(
					() => undefined,
					(error: unknown) => error,
				);
				expect(failure).toBeInstanceOf(GarbroError);
				expect(failure).toMatchObject({ code: "UNSUPPORTED_FEATURE" });
			}
		} finally {
			await archive.close();
		}
	});

	it("stands of the counts of the walk of the engine of a count of no count of the walk of it", async () => {
		// A count of the walk of the engine of the count of the walk of the picture of the places of the
		// count of the walk of the engine of its own stands of no count of the walk of the engine of the
		// places of the count of the walk of the engine behind it: the counts of the walk of the engine of
		// the places of the count of the walk of the engine of the count of the walk of the engine of four
		// places of them stand of no place of the count of the walk of the engine at all.
		const small = Buffer.from([1, 2, 3, 4]);
		const { file, offsets } = buildNoa({
			signature: "Entis\x1a",
			records: [
				{ name: "small.bin", data: small },
				{ name: "past.bin", data: small, recorded: 0x1000 },
				{ name: "last.bin", data: small, attr: ATTR_LAST_LONG },
			],
		});
		const source = sourceOf(file);
		const archive = await entisNoaFormat.open(source, "archive.noa");
		try {
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				small.length,
				file.length - (offsets[1] ?? 0),
			]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.alloc(0),
			);
		} finally {
			await archive.close();
		}
	});

	it("turns away a count of the walk of the engine of another kind", async () => {
		// The head of the archive of the engine stands of the word of the format and of the identifier of the
		// kind of the file, and of the counts of the walk of the engine of the places of the count of the walk
		// of the picture of it.
		const other = Buffer.concat([
			Buffer.alloc(HEAD),
			Buffer.from("no count of the walk of the index at all"),
		]);
		other.write("Entis\x1a", 0, "latin1");
		other.writeUInt32LE(0x02000400, 8);
		expect(await entisNoaFormat.detect(sourceOf(other), "other.noa")).toBe(
			false,
		);
		const { file } = buildNoa({
			signature: "Entis\x1a",
			records: [{ name: "a.bin", data: Buffer.from("the places") }],
		});
		const wrongId = Buffer.from(file);
		wrongId.writeUInt32LE(0x02000500, 8);
		expect(await entisNoaFormat.detect(sourceOf(wrongId), "wrong.noa")).toBe(
			false,
		);
		const empty = Buffer.from(file);
		empty.writeInt32LE(0, HEAD + DIR_ENTRY_HEAD);
		expect(await entisNoaFormat.detect(sourceOf(empty), "empty.noa")).toBe(
			false,
		);
	});
});
