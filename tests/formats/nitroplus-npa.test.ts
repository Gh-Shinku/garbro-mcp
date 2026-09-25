// The walk of the places of the file of a NitroPlus archive of this port and of the reference of the same
// engine, against an archive written out of the reference's own `Indexer` and `NpaOpener.Create`.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { BufferByteSource, encodeCp932, GarbroError } from "@garbro-mcp/core";
import { nitroplusNpaFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	npaNameKey,
	readNpaIndex,
} from "../../packages/formats/src/nitroplus/npa.js";
import { expectArchive } from "../helpers/archive.js";

const DEFAULT_KEY1 = 0x4147414e;
const DEFAULT_KEY2 = 0x21214f54;
const DIRECTORY = 1;
const FILE = 2;

/**
 * `NpaOpener.DecryptName`, written out of the reference for the test alone so the fixture does not lean on
 * the port's own arithmetic.
 */
function nameKey(index: number, curfile: number, arcKey: number): number {
	let key = 0xfc * index;
	key -= arcKey >> 0x18;
	key -= arcKey >> 0x10;
	key -= arcKey >> 0x08;
	key -= arcKey & 0xff;
	key -= curfile >> 0x18;
	key -= curfile >> 0x10;
	key -= curfile >> 0x08;
	key -= curfile;
	return key & 0xff;
}

interface NpaFile {
	name: string;
	content: Buffer;
	packed?: boolean;
	directory?: boolean;
	folderId?: number;
}

interface NpaSpec {
	key1?: number;
	key2?: number;
	compressed?: boolean;
	encrypted?: boolean;
	files: NpaFile[];
	/** Overrides the count of the records of the head, to build an index the reference refuses. */
	total?: number;
}

/** `NpaOpener.Create`: the head, the record run and the payloads of the reference's own writer. */
function buildNpa(spec: NpaSpec): Buffer {
	const key1 = spec.key1 ?? DEFAULT_KEY1;
	const key2 = spec.key2 ?? DEFAULT_KEY2;
	const key = Math.imul(key1, key2);
	const files = spec.files;
	const payloads = files.map((file) => {
		if (file.directory) return Buffer.alloc(0);
		return file.packed ? deflateSync(file.content) : file.content;
	});
	let dirSize = 0;
	for (const file of files) dirSize += 4 + encodeCp932(file.name).length + 17;
	const dataAt = 41 + dirSize;
	const total = dataAt + payloads.reduce((sum, body) => sum + body.length, 0);
	const archive = Buffer.alloc(total, 0);
	archive.write("NPA\x01", 0, "latin1");
	archive.writeInt32LE(key1, 7);
	archive.writeInt32LE(key2, 11);
	archive[15] = spec.compressed ? 1 : 0;
	archive[16] = spec.encrypted ? 1 : 0;
	archive.writeInt32LE(spec.total ?? files.length, 17);
	archive.writeInt32LE(files.filter((file) => file.directory).length, 21);
	archive.writeInt32LE(files.filter((file) => !file.directory).length, 25);
	archive.writeUInt32LE(dirSize, 37);
	let at = 41;
	let offset = 0;
	for (const [id, file] of files.entries()) {
		const raw = encodeCp932(file.name);
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeInt32LE(raw.length, at);
		for (let x = 0; x < raw.length; x += 1) {
			archive[at + 4 + x] = ((raw[x] ?? 0) - nameKey(x, id, key)) & 0xff;
		}
		archive[at + 4 + raw.length] = file.directory ? DIRECTORY : FILE;
		archive.writeInt32LE(file.folderId ?? 0, at + 5 + raw.length);
		archive.writeUInt32LE(offset, at + 9 + raw.length);
		archive.writeUInt32LE(payload.length, at + 13 + raw.length);
		archive.writeUInt32LE(
			file.directory ? 0 : file.content.length,
			at + 17 + raw.length,
		);
		payload.copy(archive, dataAt + offset);
		offset += payload.length;
		at += 4 + raw.length + 17;
	}
	return archive;
}

async function contentOf(
	archive: Buffer,
	at: number,
): Promise<Buffer | undefined> {
	const handle = await nitroplusNpaFormat.open(
		new BufferByteSource(archive),
		"sample.npa",
	);
	const entry = handle.entries[at];
	if (!entry) return undefined;
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("NitroPlus resource archive", () => {
	it("restores the names of the engine with the key of the archive", () => {
		// The values are an independent transcription of the reference's arithmetic for the default keys
		// (the product of which is 0xe1967f98) and for a second archive of other keys.
		const key = Math.imul(DEFAULT_KEY1, DEFAULT_KEY2);
		expect(key).toBe(-510230632);
		expect([0, 1, 2, 3, 4, 5].map((x) => nameKey(x, 0, key))).toEqual([
			114, 110, 106, 102, 98, 94,
		]);
		expect([0, 1, 2, 3].map((x) => nameKey(x, 1, key))).toEqual([
			113, 109, 105, 101,
		]);
		const other = Math.imul(0x12345678, 5);
		expect(other).toBe(1527099480);
		expect([0, 1, 2, 3, 4].map((x) => nameKey(x, 2, other))).toEqual([
			150, 146, 142, 138, 134,
		]);
		const negative = Math.imul(-1, DEFAULT_KEY2);
		expect(negative).toBe(-555831124);
		expect([0, 1, 2, 3].map((x) => nameKey(x, 0, negative))).toEqual([
			232, 228, 224, 220,
		]);
		// The port's own arithmetic agrees with the transcription for every one of them.
		for (const [k1, k2] of [
			[DEFAULT_KEY1, DEFAULT_KEY2],
			[0x12345678, 5],
			[-1, DEFAULT_KEY2],
		] as const) {
			const archiveKey = Math.imul(k1, k2);
			expect(
				[0, 1, 2, 3, 4, 5].map((x) => npaNameKey(x, 1, archiveKey)),
			).toEqual([0, 1, 2, 3, 4, 5].map((x) => nameKey(x, 1, archiveKey)));
		}
	});

	it("reads the head of the engine and the names of its entries", () => {
		const archive = buildNpa({
			compressed: true,
			files: [
				{
					name: "data",
					content: Buffer.alloc(0),
					directory: true,
					folderId: 1,
				},
				{ name: "data/one.txt", content: Buffer.from("plain") },
				{ name: "テスト.txt", content: Buffer.from("the places of the file") },
			],
		});
		const layout = readNpaIndex(archive);
		expect(layout.total).toBe(3);
		expect(layout.folders).toBe(1);
		expect(layout.files).toBe(2);
		expect(layout.compressed).toBe(true);
		expect(layout.dirSize).toBe(archive.readUInt32LE(37));
		expect(layout.entries.map((entry) => entry.name)).toEqual([
			"data/one.txt",
			"テスト.txt",
		]);
		expect(layout.entries.map((entry) => entry.folderId)).toEqual([0, 0]);
		// The stored name places differ from the letters of the name, which is what the walk restores.
		const stored = archive.subarray(45, 45 + 12);
		expect(stored.toString("latin1")).not.toBe("data/one.txt");
		expect(layout.entries[0]?.rawName.toString("latin1")).toBe("data/one.txt");
	});

	it("lists and extracts the entries of a plain archive", async () => {
		await expectArchive({
			format: nitroplusNpaFormat,
			archive: buildNpa({
				files: [
					{
						name: "data",
						content: Buffer.alloc(0),
						directory: true,
						folderId: 1,
					},
					{ name: "data/one.txt", content: Buffer.from("plain"), folderId: 1 },
					{ name: "two.bin", content: Buffer.from([1, 2, 3, 4]) },
				],
			}),
			entries: [
				{ path: "data/one.txt", size: 5, content: Buffer.from("plain") },
				{ path: "two.bin", size: 4, content: Buffer.from([1, 2, 3, 4]) },
			],
			metadata: { total: 3, folders: 1, files: 2, compressed: false },
		});
	});

	it("reads out the packed entries of a compressed archive", async () => {
		const body = Buffer.from(
			"the places of the file of the walk of the engine",
		);
		await expectArchive({
			format: nitroplusNpaFormat,
			archive: buildNpa({
				compressed: true,
				files: [
					{ name: "one.txt", content: body, packed: true },
					{ name: "two.txt", content: Buffer.from("plain") },
				],
			}),
			entries: [
				{ path: "one.txt", size: body.length, content: body },
				{ path: "two.txt", size: 5, content: Buffer.from("plain") },
			],
			metadata: { total: 2, compressed: true },
		});
	});

	it("hands over a payload of a compressed archive that is not a whole stream", async () => {
		// The reference clears the flag for the entries whose extension names a picture, so a payload it
		// wrote plain stands inside a compressed archive; this port keeps the flag of the head and looks
		// for the zlib head instead.
		const archive = buildNpa({
			compressed: true,
			files: [
				{ name: "one.txt", content: Buffer.from("plain") },
				{ name: "two.txt", content: Buffer.from([0x78, 0x9c, 0x00]) },
			],
		});
		// The places of the file of the picture of the engine of the walk of the table of it stand of the
		// places of the file of the head of the stream of the engine, of the walk of the places of the file
		// of the whole stream of it behind them.
		expect([...((await contentOf(archive, 1)) ?? [])]).toEqual([
			0x78, 0x9c, 0x00,
		]);
		expect([...((await contentOf(archive, 0)) ?? [])]).toEqual([
			...Buffer.from("plain"),
		]);
	});

	it("refuses an archive of a game of the engine", async () => {
		const archive = buildNpa({
			compressed: true,
			encrypted: true,
			files: [{ name: "one.txt", content: Buffer.from("plain") }],
		});
		expect(await nitroplusNpaFormat.detect(new BufferByteSource(archive))).toBe(
			false,
		);
		await expect(
			nitroplusNpaFormat.open(new BufferByteSource(archive), "sample.npa"),
		).rejects.toThrow(GarbroError);
		await expect(
			nitroplusNpaFormat.open(new BufferByteSource(archive), "sample.npa"),
		).rejects.toMatchObject({ code: "UNSUPPORTED_FEATURE" });
	});

	it("refuses an index the reference cannot walk", async () => {
		// The places of the file of the mark of the engine.
		expect(
			await nitroplusNpaFormat.detect(new BufferByteSource(Buffer.alloc(0x40))),
		).toBe(false);
		const short = Buffer.from(buildNpa({ files: [] }));
		short.write("NPB\x01", 0, "latin1");
		expect(await nitroplusNpaFormat.detect(new BufferByteSource(short))).toBe(
			false,
		);
		// A count of the entries smaller than the folders and the files beside it.
		const wrongCount = buildNpa({
			files: [{ name: "one.txt", content: Buffer.from("plain") }],
		});
		wrongCount.writeInt32LE(0, 17);
		expect(
			await nitroplusNpaFormat.detect(new BufferByteSource(wrongCount)),
		).toBe(false);
		await expect(
			nitroplusNpaFormat.open(new BufferByteSource(wrongCount), "sample.npa"),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
		// A record that reaches past the end of the file.
		const truncated = Buffer.from(
			buildNpa({
				files: [{ name: "one.txt", content: Buffer.from("plain") }],
			}),
		);
		truncated.writeInt32LE(0x1000, 41);
		expect(
			await nitroplusNpaFormat.detect(new BufferByteSource(truncated)),
		).toBe(false);
		// The places of the file of the index of the engine stand behind the file itself.
		const deepIndex = buildNpa({
			files: [{ name: "one.txt", content: Buffer.from("plain") }],
		});
		deepIndex.writeUInt32LE(0x10000, 37);
		await expect(
			nitroplusNpaFormat.open(new BufferByteSource(deepIndex), "sample.npa"),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
		// An entry whose own places of the file reach past the file itself.
		const beyond = buildNpa({
			files: [{ name: "one.txt", content: Buffer.from("plain") }],
		});
		beyond.writeUInt32LE(0x10000, 41 + 4 + 7 + 5);
		expect(await nitroplusNpaFormat.detect(new BufferByteSource(beyond))).toBe(
			false,
		);
		await expect(
			nitroplusNpaFormat.open(new BufferByteSource(beyond), "sample.npa"),
		).rejects.toMatchObject({ code: "INVALID_ARCHIVE" });
	});
});
