import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	openWarWave,
	readWarIndex,
	sas5War2Format,
	sas5WarFormat,
	warEntryName,
} from "../../packages/formats/src/sas5/war.js";

const INDEX_OFFSET = 0x40;
const SECOND_OFFSET = 0x58;
/** The places of the wave of the first file of the archive: how long the places that name how the places of
 * the wave stand, and how much of the wave stands. */
const FORMAT_SIZE = 12;
const DATA_SIZE = 4;

/** A sound archive of two files: the head, the index of two places, the wave of the first file, and the places
 * of the second. */
function buildArchive(mark = "war "): Buffer {
	const entrySize = 0x18;
	const head = Buffer.alloc(0x10, 0x00);
	head.write(mark, 0, "latin1");
	head.writeInt32LE(2, 8);
	head.writeUInt32LE(entrySize, 0x0c);
	const index = Buffer.alloc(entrySize * 2, 0x00);
	index.writeUInt32LE(INDEX_OFFSET, 0);
	index.writeUInt32LE(8 + FORMAT_SIZE + DATA_SIZE, 4);
	// The first file of the archive stands as the places of a wave, which stands as no kind of sound of its
	// own in the words of the head.
	index.writeUInt8(0, 0x14);
	index.writeUInt32LE(SECOND_OFFSET, entrySize);
	index.writeUInt32LE(4, entrySize + 4);
	index.writeUInt8(2, entrySize + 0x14);
	const wave = Buffer.alloc(8 + FORMAT_SIZE + DATA_SIZE, 0x00);
	wave.writeUInt32LE(FORMAT_SIZE, 0);
	wave.writeUInt32LE(DATA_SIZE, 4);
	wave.write("fmt words", 8, "latin1");
	wave.writeUInt32LE(0x11223344, 8 + FORMAT_SIZE);
	return Buffer.concat([head, index, wave, Buffer.from("OggS")]);
}

const ARCHIVE = buildArchive();

async function extract(format: typeof sas5WarFormat, data: Buffer, at: number) {
	const handle = await format.open(new BufferByteSource(data), "sound.war");
	const entry = handle.entries[at];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("SAS5 engine audio archive", () => {
	it("reads the index of an archive", () => {
		expect(readWarIndex(ARCHIVE, ARCHIVE.length)).toEqual({
			entrySize: 0x18,
			entries: [
				{ offset: INDEX_OFFSET, size: 8 + FORMAT_SIZE + DATA_SIZE, format: 0 },
				{ offset: SECOND_OFFSET, size: 4, format: 2 },
			],
		});
	});

	it("turns away a head that names no index", () => {
		const shortPlace = Buffer.from(ARCHIVE);
		shortPlace.writeUInt32LE(8, 0x0c);
		expect(readWarIndex(shortPlace, shortPlace.length)).toBeUndefined();
		const noFiles = Buffer.from(ARCHIVE);
		noFiles.writeInt32LE(0, 8);
		expect(readWarIndex(noFiles, noFiles.length)).toBeUndefined();
		const outside = Buffer.from(ARCHIVE);
		outside.writeUInt32LE(0x1000, 0x10 + 4);
		expect(readWarIndex(outside, outside.length)).toBeUndefined();
		expect(readWarIndex(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("names the files of an archive as the reference names them", () => {
		expect(warEntryName("sound", 0, 0)).toBe("sound#00000.wav");
		expect(warEntryName("sound", 2, 1)).toBe("sound#00001.ogg");
		expect(warEntryName("sound", 1, 12)).toBe("sound#00012");
	});

	it("writes the words of a wave around the places of a sound of the first kind", () => {
		const entry = {
			offset: INDEX_OFFSET,
			size: 8 + FORMAT_SIZE + DATA_SIZE,
			format: 0,
		};
		const wav = openWarWave(ARCHIVE, entry);
		expect(wav.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
		expect(wav.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(wav.subarray(12, 16).toString("latin1")).toBe("fmt ");
		expect(wav.readUInt32LE(16)).toBe(FORMAT_SIZE);
		expect(wav.subarray(20, 29).toString("latin1")).toBe("fmt words");
		expect(
			wav.subarray(20 + FORMAT_SIZE, 24 + FORMAT_SIZE).toString("latin1"),
		).toBe("data");
		expect(wav.readUInt32LE(24 + FORMAT_SIZE)).toBe(DATA_SIZE);
		expect(wav.subarray(28 + FORMAT_SIZE)).toEqual(
			ARCHIVE.subarray(
				INDEX_OFFSET + 8 + FORMAT_SIZE,
				INDEX_OFFSET + 8 + FORMAT_SIZE + DATA_SIZE,
			),
		);
	});

	it("hands out the files of an archive", async () => {
		const handle = await sas5WarFormat.open(
			new BufferByteSource(ARCHIVE),
			"sound.war",
		);
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"sound#00000.wav",
				"sound#00001.ogg",
			]);
			expect(handle.metadata).toMatchObject({ entryCount: 2, entrySize: 0x18 });
		} finally {
			await handle.close();
		}
		expect(
			(await extract(sas5WarFormat, ARCHIVE, 0))
				.subarray(0, 4)
				.toString("latin1"),
		).toBe("RIFF");
		expect(await extract(sas5WarFormat, ARCHIVE, 1)).toEqual(
			Buffer.from("OggS"),
		);
	});

	it("reads an archive of the second kind", async () => {
		const data = buildArchive("war2");
		expect(sas5War2Format.descriptor.id).toBe("sas5-war2");
		expect(sas5War2Format.descriptor.extensions).toEqual(["war"]);
		await expect(
			sas5War2Format.detect(new BufferByteSource(data)),
		).resolves.toBe(true);
		await expect(
			sas5WarFormat.detect(new BufferByteSource(data)),
		).resolves.toBe(false);
		expect(sas5WarFormat.descriptor.id).toBe("sas5-war");
		await expect(
			sas5WarFormat.detect(new BufferByteSource(ARCHIVE)),
		).resolves.toBe(true);
	});

	it("turns away a file whose places stand as no sound at all", async () => {
		await expect(
			sas5WarFormat.open(new BufferByteSource(Buffer.alloc(8)), "sound.war"),
		).rejects.toThrow(GarbroError);
	});
});
