// The resource archives of the engine of Seraphim (GARbro "ArcFormats/Seraphim/ArcSeraph.cs", class
// ArchPacOpener), against files built in the test: the index of such an archive stands in a companion file,
// at a place the companion's own head names.
import { Buffer } from "node:buffer";
import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import {
	decodeSeraphimArchPicture,
	seraphimArchFormat,
	unpackSeraphimArchEntry,
	walkSeraphimArchIndex,
} from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { withCompanionFiles } from "../helpers/companion.js";
import { buffer as consumeBuffer } from "node:stream/consumers";

/** The index of an archive of the engine: two runs of one file and of two files, and the places of them. */
function indexOf(places: number[]): Buffer {
	const index = Buffer.alloc(0x40, 0x00);
	index.writeInt32LE(2, 0); // the runs of the index
	index.writeInt32LE(3, 4); // the files of the archive
	index.writeUInt32LE(0x100, 8); // the first run: a place of the file and one file
	index.writeInt32LE(1, 12);
	index.writeUInt32LE(0x200, 16); // the second run: another place and two files
	index.writeInt32LE(2, 20);
	for (const [at, place] of places.entries()) {
		index.writeUInt32LE(place, 0x18 + at * 4);
	}
	return index;
}

/** The companion of an archive of the engine, of the index at the place given. */
function companionOf(index: Buffer, indexAt: number): Buffer {
	const out = Buffer.alloc(indexAt + index.length, 0x00);
	out.writeUInt32LE(0x20, 4); // the place of the first file, of the head of the companion
	out.writeUInt32LE(indexAt, 0x1c); // the place of the index, of the place in front of it
	index.copy(out, indexAt);
	return out;
}

/** A picture of the engine: the counts of the places of it and then three places of the file a place. */
function picture(planes: number, colours: number[]): Buffer {
	const out = Buffer.alloc(4 + planes, 0x00);
	out.writeUInt16LE(2, 0);
	out.writeUInt16LE(1, 2);
	Buffer.from(colours).copy(out, 4);
	return out;
}

describe("Seraphim engine resource archive", () => {
	it("reads the files of the index of the engine, of the places of the companion", () => {
		const walked = walkSeraphimArchIndex(
			indexOf([0x10, 0x20, 0x30, 0x40, 0x50]),
			0,
			0x400n,
		);
		if (!walked) throw new Error("no files of the index");
		// The runs of the index stand walked from the last of them, and the place of a file of a run
		// stands of the place of the run itself.
		expect(
			walked.map((entry) => [entry.name, entry.offset, entry.size]),
		).toEqual([
			["1-00000.cts", 0x210n, 0x10n],
			["1-00001.cts", 0x220n, 0x10n],
			["0-00000.cts", 0x140n, 0x10n],
		]);
		// The counts of the runs of the index and of the files of them stand as the reference stands of
		// them: at most `0x40` runs, and the files of the runs over all of them.
		expect(
			walkSeraphimArchIndex(indexOf([0x10, 0x20, 0x30, 0x40, 0x50]), 0, 0x100n),
		).toBeUndefined();
		const wrong = indexOf([0x10, 0x20, 0x30, 0x40, 0x50]);
		wrong.writeInt32LE(3, 8 + 4); // the first run names three files where two stand behind it
		expect(walkSeraphimArchIndex(wrong, 0, 0x400n)).toBeUndefined();
	});

	it("reads the files of an archive of the engine, of the index of its companion", async () => {
		const main = Buffer.alloc(0x300, 0x11);
		picture(6, [1, 2, 3, 4, 5, 6]).copy(main, 0x140);
		await withCompanionFiles(
			"ArchPac.dat",
			{
				"ArchPac.dat": main,
				"ScnPac.dat": companionOf(
					indexOf([0x10, 0x20, 0x30, 0x40, 0x50]),
					0x24,
				),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await seraphimArchFormat.detect(source, mainPath)).toBe(true);
					const handle = await seraphimArchFormat.open(source, mainPath);
					try {
						expect(handle.entries.map((entry) => entry.path)).toEqual([
							"1-00000.cts",
							"1-00001.cts",
							"0-00000.cts",
						]);
						// The file of the first run stands of the picture of the engine itself, of the
						// places of the file of the archive at the place the run names.
						const places = await consumeBuffer(
							await handle.openEntry(handle.entries[2]?.id ?? "0"),
						);
						expect(places.toString("latin1", 0, 2)).toBe("BM");
						expect([...places.subarray(54, 60)]).toEqual([1, 2, 3, 4, 5, 6]);
					} finally {
						await handle.close();
					}
				} finally {
					await source.close();
				}
			},
		);
	});

	it("reads the picture of a file of the engine, and the places of zlib behind a file", async () => {
		const raw = picture(6, [1, 2, 3, 4, 5, 6]);
		const bmp = decodeSeraphimArchPicture(raw);
		if (!bmp) throw new Error("no picture");
		expect(bmp.toString("latin1", 0, 2)).toBe("BM");
		expect([...bmp.subarray(54, 60)]).toEqual([1, 2, 3, 4, 5, 6]);
		expect(bmp.readInt32LE(22)).toBe(-1);
		// A picture of no counts of the reference stands of no picture at all.
		const broken = picture(6, [1, 2, 3, 4, 5, 6]);
		broken.writeUInt16LE(0x4101, 0);
		expect(decodeSeraphimArchPicture(broken)).toBeUndefined();
		// The places of a file of the engine stand of zlib where the head of the file names it.
		const zlib = deflateSync(raw);
		const wrapped = await unpackSeraphimArchEntry(zlib);
		expect([...wrapped.subarray(0, 4)]).toEqual([...raw.subarray(0, 4)]);
		const skipped = await unpackSeraphimArchEntry(
			Buffer.concat([Buffer.from([1, 0, 0, 0]), zlib]),
		);
		expect([...skipped.subarray(0, 4)]).toEqual([...raw.subarray(0, 4)]);
		// A file of no word of zlib at its head stands as it stands.
		const plain = await unpackSeraphimArchEntry(raw);
		expect([...plain]).toEqual([...raw]);
	});

	it("reads no archive of another name, of no companion, and of no index of the engine", async () => {
		const other = new BufferByteSource(Buffer.alloc(0x300, 0x00));
		expect(await seraphimArchFormat.detect(other, "/tmp/other.dat")).toBe(
			false,
		);
		const main = new BufferByteSource(Buffer.alloc(0x300, 0x00));
		expect(await seraphimArchFormat.detect(main, "/tmp/ArchPac.dat")).toBe(
			false,
		);
	});
});
