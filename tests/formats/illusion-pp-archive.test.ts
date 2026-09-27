// The resource archives of the engine of Illusion (GARbro "ArcFormats/Illusion/ArcPP.cs", class PpOpener),
// against files built in the test: the head and the index of an archive of the engine stand of the cipher
// of the engine's own, whose two keys stand in the reference's source.
import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import {
	decryptPpIndex,
	illusionPpFormat,
	PP_INDEX_KEYS,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { buffer as consumeBuffer } from "node:stream/consumers";

const SIGNATURE = Buffer.from("[PPVER]\0", "latin1");
const HEAD_OFFSET = 8;
const INDEX_OFFSET = 0x11;
const RECORD_PLACES = 0x120;
const NAME_PLACES = 0x104;

/** `PpOpener.DecryptIndex` backwards, of the counts of the cipher of the engine. */
function encryptPpIndex(data: Buffer, position: number, length: number): void {
	decryptPpIndex(data, position, length);
}

/** An archive of the engine, of the counts given and of the files of it. */
function archive(
	version: number,
	method: number,
	files: { name: string; offset: number; size: number }[],
	slack = 0x300,
): Buffer {
	const count = files.length;
	const head = Buffer.alloc(9, 0x00);
	head.writeInt32LE(version, 0);
	head[4] = method;
	head.writeInt32LE(count, 5);
	// The reference stands of the cipher of the head three times, of every count of the places of the
	// head of its own, and of the keys as they stand at the head of every one of them.
	encryptPpIndex(head, 0, 4);
	encryptPpIndex(head, 4, 1);
	encryptPpIndex(head, 5, 4);
	const index = Buffer.alloc(count * RECORD_PLACES, 0x00);
	for (let at = 0; at < count; at += 1) {
		const base = at * RECORD_PLACES;
		index.write(files[at]?.name ?? "", base, "latin1");
		index.writeUInt32LE(files[at]?.size ?? 0, base + NAME_PLACES);
		index.writeUInt32LE(files[at]?.offset ?? 0, base + NAME_PLACES + 4);
	}
	encryptPpIndex(index, 0, index.length);
	const file = Buffer.alloc(INDEX_OFFSET + index.length + slack, 0x00);
	SIGNATURE.copy(file, 0);
	head.copy(file, HEAD_OFFSET);
	index.copy(file, INDEX_OFFSET);
	for (let at = INDEX_OFFSET + index.length; at < file.length; at += 1) {
		file[at] = at & 0xff;
	}
	return file;
}

describe("Illusion resource archive", () => {
	it("reads the cipher of the head and of the index of the engine", () => {
		// The two keys of the cipher of the index of the engine, of the reference as they stand there.
		expect(PP_INDEX_KEYS).toEqual([
			[0xfa, 0x49, 0x7b, 0x1c, 0xf9, 0x4d, 0x83, 0x0a],
			[0x3a, 0xe3, 0x87, 0xc2, 0xbd, 0x1e, 0xa6, 0xfe],
		]);
		// The first nine counts of the walk, worked out here by hand: the first key stands of the second
		// one, of every place of the file of the first key standing behind the count of the places of the
		// index, and the ninth place stands of the first key of the walk again.
		const places = Buffer.alloc(9, 0x00);
		decryptPpIndex(places, 0, 9);
		expect([...places]).toEqual([
			0x34, 0x2c, 0x02, 0xde, 0xb6, 0x6b, 0x29, 0x08, 0x6e,
		]);
	});

	it("reads the files of an archive of the engine, of the counts of the engine", async () => {
		const file = archive(0x6c, 2, [
			{ name: "first.g24", offset: 0x200, size: 0x10 },
			{ name: "second.bmp", offset: 0x210, size: 0x20 },
		]);
		const source = new BufferByteSource(file);
		expect(await illusionPpFormat.detect(source, "/tmp/sample.pp")).toBe(true);
		const handle = await illusionPpFormat.open(source, "/tmp/sample.pp");
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"first.g24",
				"second.bmp",
			]);
			expect(handle.entries.map((entry) => entry.size)).toEqual([0x10n, 0x20n]);
			expect(handle.metadata?.method).toBe(2);
			// A file of the count of the places of the walk of the archive itself stands as it stands.
			const places = await consumeBuffer(
				await handle.openEntry(handle.entries[0]?.id ?? "0"),
			);
			expect([...places]).toEqual([...file.subarray(0x200, 0x210)]);
		} finally {
			await handle.close();
		}
	});

	it("reads the files of the walk of no scheme and of the stub of the engine", async () => {
		// The count of the places of the walk of the fourth count of the engine stands of the stub of the
		// reference (`UnpackData`), which hands the places of the file back as they stand.
		const file = archive(0x6d, 4, [
			{ name: "packed.bin", offset: 0x200, size: 0x8 },
		]);
		const source = new BufferByteSource(file);
		const handle = await illusionPpFormat.open(source, "/tmp/stub.pp");
		try {
			const places = await consumeBuffer(
				await handle.openEntry(handle.entries[0]?.id ?? "0"),
			);
			expect([...places]).toEqual([...file.subarray(0x200, 0x208)]);
		} finally {
			await handle.close();
		}
		// The counts of the places of the walk of a scheme of the game stand of a key the reference looks
		// up by the name of the game: with no such key the walk stands refused, named as such.
		for (const method of [1, 3]) {
			const encrypted = archive(0x6e, method, [
				{ name: "secret.bin", offset: 0x200, size: 0x10 },
			]);
			const other = new BufferByteSource(encrypted);
			const otherHandle = await illusionPpFormat.open(other, "/tmp/secret.pp");
			try {
				await expect(
					otherHandle.openEntry(otherHandle.entries[0]?.id ?? "0"),
				).rejects.toThrow(GarbroError);
			} finally {
				await otherHandle.close();
			}
		}
	});

	it("reads no archive of a head the engine stands of no count of, and no other count of it", async () => {
		const good = archive(0x6c, 2, [
			{ name: "a.bin", offset: 0x200, size: 0x8 },
		]);
		const cases: Buffer[] = [];
		// The word of the head of the engine.
		const wrongWord = Buffer.from(good);
		wrongWord.write("XPVER\0", 0, "latin1");
		cases.push(wrongWord);
		// The count of the version of the engine stands at or behind the counts of the reference.
		cases.push(archive(0x6b, 2, [{ name: "a.bin", offset: 0x200, size: 0x8 }]));
		// The count of the walk of the places of an entry stands at most at the fourth count.
		cases.push(archive(0x6c, 5, [{ name: "a.bin", offset: 0x200, size: 0x8 }]));
		// The count of the files of an archive of the engine stands of a count of the places of it.
		const none = Buffer.from(good);
		none.fill(0x00, INDEX_OFFSET);
		cases.push(none);
		// The places of a file of the engine stand within the file itself.
		cases.push(
			archive(0x6c, 2, [{ name: "a.bin", offset: 0x1000, size: 0x8 }], 0x10),
		);
		for (const file of cases) {
			const source = new BufferByteSource(file);
			expect(await illusionPpFormat.detect(source, "/tmp/bad.pp")).toBe(false);
		}
	});
});
