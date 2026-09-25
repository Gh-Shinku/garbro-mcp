import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import {
	mgpkFormat,
	readMgpkIndex,
} from "../../packages/formats/src/manga-gamer/mgpk.js";

const INDEX_BASE = 0x0c;
const ENTRY_SIZE = 0x30;

interface Wanted {
	name: string;
	content: Buffer;
	/** A place the entry names itself, for the files that do not stand one behind the other. */
	offset?: number;
}

/** An archive of this engine: the head, then a record of forty eight bytes for every entry. */
function buildArchive(wanted: readonly Wanted[], version = 1): Buffer {
	const indexEnd = INDEX_BASE + wanted.length * ENTRY_SIZE;
	const sizes = wanted.map((entry) => entry.content.length);
	const places = wanted.map((entry, number) => {
		if (entry.offset !== undefined) return entry.offset;
		let at = indexEnd;
		for (let before = 0; before < number; before += 1) at += sizes[before] ?? 0;
		return at;
	});
	const end = Math.max(
		indexEnd,
		...places.map((place, number) => place + (sizes[number] ?? 0)),
	);
	const data = Buffer.alloc(end, 0x00);
	data.write("MGPK", 0, "latin1");
	data.writeInt32LE(version, 4);
	data.writeInt32LE(wanted.length, 8);
	for (const [number, entry] of wanted.entries()) {
		const at = INDEX_BASE + number * ENTRY_SIZE;
		const name = Buffer.from(entry.name, "utf8");
		data[at] = name.length;
		name.copy(data, at + 1);
		data.writeUInt32LE(places[number] ?? 0, at + 0x20);
		data.writeUInt32LE(sizes[number] ?? 0, at + 0x24);
	}
	for (const [number, entry] of wanted.entries()) {
		entry.content.copy(data, places[number] ?? 0);
	}
	return data;
}

const PLAIN = [
	{ name: "TITLE.GRP", content: Buffer.from("first picture", "latin1") },
	{ name: "text.txt", content: Buffer.from("a text of its own", "latin1") },
];

describe("MG resource archive", () => {
	it("lists and hands over the entries of an archive", async () => {
		await expectArchive({
			format: mgpkFormat,
			archive: buildArchive(PLAIN),
			sourcePath: "data.pac",
			entries: PLAIN.map((entry) => ({
				path: entry.name,
				size: entry.content.length,
				content: entry.content,
			})),
			metadata: { extension: "pac", entryCount: 2 },
		});
	});

	it("reads the names of the index as text of their own", () => {
		const picture = Buffer.from("a picture", "latin1");
		const data = buildArchive([
			{ name: "画像.png", content: picture },
			{ name: "", content: Buffer.alloc(3, 0x41) },
		]);
		const index = readMgpkIndex(data, BigInt(data.length));
		expect(index?.entries.map((entry) => entry.name)).toEqual(["画像.png", ""]);
		expect(index?.entries[0]).toMatchObject({
			offset: INDEX_BASE + 2 * ENTRY_SIZE,
			size: picture.length,
		});
		// A name the reference would key is reported, since a stock build carries no key to unwrap it with.
		expect(index?.holdsKeyedNames).toBe(true);
	});

	it("keeps a text entry as it stands, since the way it could be unwrapped needs a key", async () => {
		const text = {
			name: "text.txt",
			content: Buffer.from("a text of its own", "latin1"),
		};
		const handle = await mgpkFormat.open(
			new BufferByteSource(buildArchive([text])),
			"data.pac",
		);
		expect(handle.metadata).toMatchObject({ holdsKeyedNames: true });
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const { buffer: consumeBuffer } = await import("node:stream/consumers");
		const stored = await consumeBuffer(await handle.openEntry(entry.id));
		expect([...stored]).toEqual([...text.content]);
	});

	it("turns away the head the older format of this engine claims", async () => {
		// The version of nothing belongs to `MGPK0`, whose records hold their names and lengths elsewhere.
		const older = buildArchive(PLAIN, 0);
		expect(
			await mgpkFormat.detect(new BufferByteSource(older), "data.pac"),
		).toBe(false);
		await expect(
			mgpkFormat.open(new BufferByteSource(older), "data.pac"),
		).rejects.toThrow(GarbroError);
	});

	it("turns away a head that names nothing and an entry that stands past the end", () => {
		const empty = buildArchive([]);
		expect(readMgpkIndex(empty, BigInt(empty.length))).toBeUndefined();

		const beyond = buildArchive(PLAIN);
		beyond.writeInt32LE(0x400, 8);
		expect(readMgpkIndex(beyond, BigInt(beyond.length))).toBeUndefined();

		const outside = buildArchive([
			{ name: "TITLE.GRP", content: Buffer.alloc(0x20, 1), offset: 0 },
		]);
		outside.writeUInt32LE(outside.length - 4, INDEX_BASE + 0x20);
		outside.writeUInt32LE(0x40, INDEX_BASE + 0x24);
		expect(readMgpkIndex(outside, BigInt(outside.length))).toBeUndefined();
	});

	it("is told by the word it opens with", async () => {
		const data = buildArchive(PLAIN);
		expect(await mgpkFormat.detect(new BufferByteSource(data), "a.bin")).toBe(
			true,
		);
		const elsewhere = Buffer.from(data);
		elsewhere.write("XXXX", 0, "latin1");
		expect(
			await mgpkFormat.detect(new BufferByteSource(elsewhere), "a.pac"),
		).toBe(false);
	});
});
