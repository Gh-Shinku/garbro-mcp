import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import {
	graFormat,
	mblFormat,
	readGraArchive,
	readMblArchive,
} from "../../packages/formats/src/marble/mbl-archive.js";

const NAME_LENGTH = 0x10;

interface Wanted {
	/** The name the first field holds, and the extension that may stand behind it. */
	name: string;
	extension?: string;
	content: Buffer;
}

/** An archive of this engine: the count, the length of a name, then the records and the files behind them. */
function buildMbl(
	wanted: readonly Wanted[],
	options: { declared?: number; indexOffset?: number; shown?: number } = {},
): Buffer {
	const nameLength = options.shown ?? NAME_LENGTH;
	const indexOffset = options.indexOffset ?? 8;
	const indexSize = (8 + nameLength) * wanted.length;
	const end = Math.max(
		indexOffset + indexSize,
		...wanted.map(
			(entry, number) =>
				indexOffset +
				indexSize +
				wanted
					.slice(0, number)
					.reduce((total, before) => total + before.content.length, 0) +
				entry.content.length,
		),
	);
	const data = Buffer.alloc(end, 0x00);
	data.writeInt32LE(wanted.length, 0);
	data.writeUInt32LE(options.declared ?? nameLength, 4);
	let at = indexOffset;
	let place = indexOffset + indexSize;
	for (const entry of wanted) {
		data.write(entry.name, at, "latin1");
		if (entry.extension)
			data.write(entry.extension, at + entry.name.length + 1, "latin1");
		data.writeUInt32LE(place, at + nameLength);
		data.writeUInt32LE(entry.content.length, at + nameLength + 4);
		entry.content.copy(data, place);
		at += nameLength + 8;
		place += entry.content.length;
	}
	return data;
}

/** The archive of the graphics of this engine, whose file carries a name of its own. */
function buildGra(wanted: readonly Wanted[]): Buffer {
	const indexSize = (8 + NAME_LENGTH) * wanted.length;
	const places: number[] = [];
	let place = 8 + indexSize;
	for (const entry of wanted) {
		places.push(place);
		place += entry.content.length;
	}
	const data = Buffer.alloc(place, 0x00);
	data.writeUInt32LE(NAME_LENGTH, 0);
	data.writeInt32LE(wanted.length, 4);
	let at = 8;
	for (const [number, entry] of wanted.entries()) {
		data.write(entry.name, at, "latin1");
		data.writeUInt32LE(places[number] ?? 0, at + NAME_LENGTH);
		data.writeUInt32LE(entry.content.length, at + NAME_LENGTH + 4);
		at += NAME_LENGTH + 8;
	}
	for (const [number, entry] of wanted.entries()) {
		entry.content.copy(data, places[number] ?? 0);
	}
	return data;
}

async function extract(
	format: typeof mblFormat,
	data: Buffer,
	sourcePath: string,
	position = 0,
): Promise<Buffer> {
	const handle = await format.open(new BufferByteSource(data), sourcePath);
	const entry = handle.entries[position];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

const PICTURE = {
	name: "title",
	extension: "bmp",
	content: Buffer.from("a picture", "latin1"),
};
const SOUND = {
	name: "sound",
	extension: "wav",
	content: Buffer.from("a sound", "latin1"),
};
const PLAIN = [PICTURE, SOUND];

describe("Marble engine archives", () => {
	it("lists and hands over the entries of a resource archive", async () => {
		await expectArchive({
			format: mblFormat,
			archive: buildMbl(PLAIN),
			sourcePath: "game.mbl",
			entries: PLAIN.map((entry) => ({
				path: `${entry.name}.${entry.extension}`,
				size: entry.content.length,
				content: entry.content,
			})),
			metadata: { entryCount: 2, scripts: false },
		});
	});

	it("reads the extension that stands behind a name in its own field", () => {
		const data = buildMbl(PLAIN);
		const entries = readMblArchive(data, BigInt(data.length), "game.mbl");
		expect(entries?.map((entry) => entry.name)).toEqual([
			"title.bmp",
			"sound.wav",
		]);
		expect(entries?.map((entry) => entry.type)).toEqual(["image", "audio"]);
	});

	it("falls back to the two layouts whose length it assumes", () => {
		// A head that declares no length at all: the records then stand at 4 with a field of sixteen bytes.
		const assumed = buildMbl(PLAIN, {
			declared: 0,
			indexOffset: 4,
			shown: NAME_LENGTH,
		});
		const entries = readMblArchive(assumed, BigInt(assumed.length), "game.mbl");
		expect(entries?.map((entry) => entry.name)).toEqual([
			"title.bmp",
			"sound.wav",
		]);
		// And the wider field of fifty six bytes, which the reference reaches for last.
		const wide = buildMbl([PICTURE], {
			declared: 0,
			indexOffset: 4,
			shown: 0x38,
		});
		const wideEntries = readMblArchive(wide, BigInt(wide.length), "game.mbl");
		expect(wideEntries?.map((entry) => entry.name)).toEqual(["title.bmp"]);
	});

	it("negates the bytes of a script of an archive that holds them", async () => {
		const script = Buffer.from([0x01, 0x02, 0xfd, 0xff]);
		const data = buildMbl([{ name: "main", extension: "s", content: script }]);
		const stored = await extract(mblFormat, data, "game_data.mbl");
		expect([...stored]).toEqual([0xff, 0xfe, 0x03, 0x01]);
		const handle = await mblFormat.open(
			new BufferByteSource(data),
			"game_data.mbl",
		);
		expect(handle.entries[0]?.metadata).toMatchObject({ type: "script" });
	});

	it("unwraps the zlib streams of the graphics archive, which is told by its name", async () => {
		const picture = Buffer.from("a picture of the graphics archive", "latin1");
		const plain = Buffer.from("a picture as it stands", "latin1");
		const data = buildGra([
			{ name: "title.bmp", content: deflateSync(picture) },
			{ name: "other.bmp", content: plain },
		]);
		const zipped = await extract(graFormat, data, "mg_gra.mbl");
		expect([...zipped]).toEqual([...picture]);
		const raw = await extract(graFormat, data, "mg_gra.mbl", 1);
		expect([...raw]).toEqual([...plain]);

		const entries = readGraArchive(data, BigInt(data.length), "mg_gra.mbl");
		expect(entries?.map((entry) => entry.path)).toEqual([
			"title.bmp",
			"other.bmp",
		]);
		// The same bytes under another name are not this archive at all.
		expect(
			readGraArchive(data, BigInt(data.length), "other.bmp"),
		).toBeUndefined();
		expect(
			await graFormat.detect(new BufferByteSource(data), "other.bmp"),
		).toBe(false);
	});

	it("turns away a head that names nothing and an entry that stands past the end", async () => {
		const empty = buildMbl([]);
		expect(
			readMblArchive(empty, BigInt(empty.length), "game.mbl"),
		).toBeUndefined();
		expect(
			await mblFormat.detect(new BufferByteSource(empty), "game.mbl"),
		).toBe(false);
		await expect(
			mblFormat.open(new BufferByteSource(empty), "game.mbl"),
		).rejects.toThrow(GarbroError);

		const outside = buildMbl([PICTURE]);
		outside.writeUInt32LE(outside.length - 2, 8 + NAME_LENGTH);
		outside.writeUInt32LE(0x40, 8 + NAME_LENGTH + 4);
		expect(
			readMblArchive(outside, BigInt(outside.length), "game.mbl"),
		).toBeUndefined();
	});
});
