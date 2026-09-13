import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { xuseWagFormat } from "../../packages/formats/src/xuse/wag.js";
import { expectArchive } from "../helpers/archive.js";

/**
 * Golden values produced by transcribing `WagOpener.GenerateKey` and `IndexReader.ReadIndex` by hand,
 * so the tests do not re-implement the key schedule they are meant to check.
 */
const GAME_WAG_INDEX_OFFSET = 0xb5;
const GAME_WAG_NAME_KEY = Buffer.from(
	"0c034688327c9f9e9fa67ba43a949796979ea37ce28c8f8e8f96ab946aa48786878e93ac529cbfbebfc69bc4dab4b7b6b7bec39c82acafaeafb6cbb48ac4a7a6a7aeb3ccf2bcdfdedfe6bbe4fad4d7d6d7dee3bca2cccfcecfd6ebd42ae4c7c6c7ced3ec12dcfffeff06db049af4f7f6f7fe03dc42ecefeeeff60bf44a04e7e6e7eef30cb2fc1f1e1f26fb24ba141716171e23fc620c0f0e0f162b14ea240706070e132cd21c3f3e3f461b445a343736373e431c022c2f2e2f364b340a442726272e334c723c5f5e5f663b647a545756575e633c00",
	"hex",
);
const TEST_TITLE = "TestTitle";
const TEST_TITLE_KEY = Buffer.from(
	"010446885a927e97915fa37e946177897eaabaac9f9f80808c857fc581909277b597b4a8c89aa9adce9eb2bbc58397aab8d5c3ada29e9ed0abc394ccc0a9b3d9d5bcc69bd1bbd8dcacbed5c1a2bad6dfe9f7dbd6ccb9dfe1c6c2b2e4d7d700",
	"hex",
);

/** `WagOpener.Decrypt`: an involution, so the same call both encodes and decodes. */
function decryptOffset(
	offset: number,
	key: Buffer,
	data: Buffer,
	length = data.length,
): void {
	const keyLast = key.length - 1;
	for (let i = 0; i < length; i += 1)
		data[i] = (data[i] ?? 0) ^ (key[(offset + i) % keyLast] ?? 0);
}

interface V2FixtureEntry {
	data: Buffer;
	name?: string;
	/** Written into the eight header bytes that the reader skips. */
	nameLengthOverride?: number;
	dataSizeOverride?: number;
}

interface V3Chunk {
	tag: string;
	/** Six bytes of image payload flags plus the payload, or the raw chunk body. */
	body: Buffer;
}

interface FixtureOptions {
	count?: number;
	title?: string;
	entries: V2FixtureEntry[];
	v3Entries?: { chunks: V3Chunk[] }[];
	version?: number;
	dataKey?: Buffer;
	entryOffsetOverride?: number;
}

/**
 * Builds a WAG archive. The index sits at the offset derived from the file name and is encrypted with a
 * key derived from the nine byte name key; entry regions are encrypted with the title derived data key.
 */
function buildWag(options: FixtureOptions): Buffer {
	const version = options.version ?? 0x200;
	const title = Buffer.from(options.title ?? TEST_TITLE, "latin1");
	const dataKey = options.dataKey ?? TEST_TITLE_KEY;
	const regionCount =
		version === 0x200
			? options.entries.length
			: (options.v3Entries ?? []).length;
	const count = options.count ?? regionCount;
	const header = Buffer.alloc(0x4a);
	header.write(version === 0x200 ? "WAG@" : "WAG@", 0, 4, "latin1");
	header.writeUInt16LE(version, 4);
	title.copy(header, 6);
	header.writeInt32LE(count, 0x46);
	const regions: Buffer[] = [];
	const entryOffsets: number[] = [];
	// The index sits between the header and the first region.
	let cursor = GAME_WAG_INDEX_OFFSET + count * 4;
	if (version === 0x200) {
		for (const entry of options.entries) {
			const name =
				entry.name === undefined
					? Buffer.alloc(0)
					: Buffer.from(entry.name, "latin1");
			const dataSize = entry.dataSizeOverride ?? entry.data.length;
			const nameLength = entry.nameLengthOverride ?? name.length;
			// The region layout follows the real payload length; the size word may overstate it.
			const region = Buffer.alloc(0x10 + entry.data.length + name.length);
			region.writeUInt32LE(dataSize, 0);
			region.writeInt32LE(nameLength, 4);
			entry.data.copy(region, 0x10);
			name.copy(region, 0x10 + entry.data.length);
			entryOffsets.push(cursor);
			regions.push(region);
			cursor += region.length;
		}
	} else {
		for (const entry of options.v3Entries ?? []) {
			const parts: Buffer[] = [];
			for (const chunk of entry.chunks) {
				const chunkHeader = Buffer.alloc(10);
				chunkHeader.write(chunk.tag, 0, 4, "latin1");
				chunkHeader.writeInt32LE(chunk.body.length, 4);
				parts.push(chunkHeader, chunk.body);
			}
			const head = Buffer.alloc(10);
			head.write("DSET", 0, 4, "latin1");
			head.writeInt32LE(entry.chunks.length, 4);
			const region = Buffer.concat([head, ...parts]);
			entryOffsets.push(cursor);
			regions.push(region);
			cursor += region.length;
		}
	}
	if (options.entryOffsetOverride !== undefined) {
		// Put a bogus offset in the first index word; the region move is not simulated.
		entryOffsets[0] = options.entryOffsetOverride;
	}
	// Entry regions are encrypted with the absolute offset they sit at, in place, before the file is
	// assembled: concatenating would copy the plain regions.
	for (const [number, region] of regions.entries())
		decryptOffset(entryOffsets[number] ?? 0, dataKey, region);
	const index = Buffer.alloc(count * 4);
	const chain = [...entryOffsets, cursor];
	for (let i = 0; i < count; i += 1) index.writeUInt32LE(chain[i] ?? 0, i * 4);
	const indexKey = Buffer.alloc(index.length);
	for (let i = 0; i < indexKey.length; i += 1) {
		const value =
			(GAME_WAG_NAME_KEY[(i + 1) % GAME_WAG_NAME_KEY.length] ?? 0) ^
			(((GAME_WAG_NAME_KEY[i % GAME_WAG_NAME_KEY.length] ?? 0) + i) & 0xff);
		indexKey[i] = (count + value) & 0xff;
	}
	decryptOffset(GAME_WAG_INDEX_OFFSET, indexKey, index);
	// Reserve the index slot between the header and the payload regions.
	const file = Buffer.concat([
		header,
		Buffer.alloc(GAME_WAG_INDEX_OFFSET + count * 4 - header.length),
		...regions,
	]);
	index.copy(file, GAME_WAG_INDEX_OFFSET);
	return file;
}

function v3Pict(payload: Buffer): V3Chunk {
	return { tag: "PICT", body: Buffer.concat([Buffer.alloc(6), payload]) };
}

function v3Ftag(name: string): V3Chunk {
	return {
		tag: "FTAG",
		body: Buffer.concat([Buffer.from(name, "latin1"), Buffer.alloc(2)]),
	};
}

function sourceOf(archive: Buffer): BufferByteSource {
	return new BufferByteSource(archive);
}

describe("xuse WAG", () => {
	it("registers the WAG and GAF4 signatures", () => {
		expect(
			xuseWagFormat.detection?.signatures?.map((signature) =>
				Buffer.from(signature.bytes).toString("latin1"),
			),
		).toEqual(["WAG@", "GAF4"]);
	});

	it("declines an unknown version word", async () => {
		const built = buildWag({
			entries: [{ data: Buffer.from("x"), name: "a.txt" }],
			version: 0x100,
		});
		expect(await xuseWagFormat.detect(sourceOf(built), "game.wag")).toBe(false);
	});

	it("declines an insane entry count", async () => {
		const built = buildWag({
			entries: [{ data: Buffer.from("x"), name: "a.txt" }],
			count: 0x100000,
		});
		expect(await xuseWagFormat.detect(sourceOf(built), "game.wag")).toBe(false);
	});

	it("lists version two entries from the derived index offset", async () => {
		const built = buildWag({
			entries: [
				{ data: Buffer.from("first body"), name: "a.txt" },
				{ data: Buffer.from("second"), name: "b.dat" },
			],
		});
		await expectArchive({
			format: xuseWagFormat,
			archive: built,
			sourcePath: "game.wag",
			entries: [
				{ path: "a.txt", size: 10, content: Buffer.from("first body") },
				{ path: "b.dat", size: 6, content: Buffer.from("second") },
			],
		});
	});

	it("strips a trailing pipe from version two names", async () => {
		const built = buildWag({
			entries: [{ data: Buffer.from("body"), name: "name.txt|" }],
		});
		await expectArchive({
			format: xuseWagFormat,
			archive: built,
			sourcePath: "game.wag",
			entries: [{ path: "name.txt", size: 4, content: Buffer.from("body") }],
		});
	});

	it("generates a fallback name when the name field is empty", async () => {
		const built = buildWag({
			entries: [
				{ data: Buffer.from("anon") },
				{ data: Buffer.from("named"), name: "second.bin" },
			],
		});
		await expectArchive({
			format: xuseWagFormat,
			archive: built,
			sourcePath: "game.wag",
			entries: [
				{ path: "game#0000", size: 4, content: Buffer.from("anon") },
				{ path: "second.bin", size: 5, content: Buffer.from("named") },
			],
		});
	});

	it("declines an entry whose stored size reaches the region end", async () => {
		const built = buildWag({
			entries: [
				{ data: Buffer.from("first"), name: "a.txt", dataSizeOverride: 0x100 },
			],
		});
		expect(await xuseWagFormat.detect(sourceOf(built), "game.wag")).toBe(false);
	});

	it("declines an entry offset past the end of the archive", async () => {
		const built = buildWag({
			entries: [{ data: Buffer.from("first"), name: "a.txt" }],
			entryOffsetOverride: 0x100000,
		});
		expect(await xuseWagFormat.detect(sourceOf(built), "game.wag")).toBe(false);
	});

	it("decrypts version three picture entries", async () => {
		const payload = Buffer.from("picture bytes");
		const built = buildWag({
			entries: [],
			version: 0x300,
			v3Entries: [{ chunks: [v3Pict(payload)] }],
		});
		const archive = await xuseWagFormat.open(sourceOf(built), "game.wag");
		try {
			expect(archive.metadata).toMatchObject({ version: 0x300 });
			expect(archive.entries).toHaveLength(1);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect({
				path: entry.path,
				size: entry.size,
				type: (entry.metadata as { type?: string }).type,
			}).toEqual({ path: "game#0000", size: 13n, type: "image" });
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				payload,
			);
		} finally {
			await archive.close();
		}
	});

	it("reads version three file tags and strips a drive prefix", async () => {
		const payload = Buffer.from("script text");
		const built = buildWag({
			entries: [],
			version: 0x300,
			v3Entries: [
				{ chunks: [v3Ftag("C:\\game\\sub\\script.wsc"), v3Pict(payload)] },
			],
		});
		const archive = await xuseWagFormat.open(sourceOf(built), "game.wag");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// Only the drive prefix is stripped, the first directory component stays.
			expect(entry.path).toBe("game/sub/script.wsc");
			expect(entry.size).toBe(BigInt(payload.length));
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				payload,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a version three chunk with a non positive size", async () => {
		const built = buildWag({
			entries: [],
			version: 0x300,
			v3Entries: [{ chunks: [{ tag: "FTAG", body: Buffer.alloc(0) }] }],
		});
		expect(await xuseWagFormat.detect(sourceOf(built), "game.wag")).toBe(false);
	});

	it("uses the data key derived from the archive title", async () => {
		const payload = Buffer.from("title keyed payload");
		const built = buildWag({
			title: TEST_TITLE,
			entries: [{ data: payload, name: "t.bin" }],
		});
		const archive = await xuseWagFormat.open(sourceOf(built), "game.wag");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(true);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				payload,
			);
		} finally {
			await archive.close();
		}
	});

	it("honours the index key derived from the entry count", async () => {
		const built = buildWag({
			entries: [
				{ data: Buffer.from("one"), name: "1.bin" },
				{ data: Buffer.from("two"), name: "2.bin" },
				{ data: Buffer.from("three"), name: "3.bin" },
			],
		});
		await expectArchive({
			format: xuseWagFormat,
			archive: built,
			sourcePath: "game.wag",
			entries: [
				{ path: "1.bin", size: 3, content: Buffer.from("one") },
				{ path: "2.bin", size: 3, content: Buffer.from("two") },
				{ path: "3.bin", size: 5, content: Buffer.from("three") },
			],
		});
	});
});
