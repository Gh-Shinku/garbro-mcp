import { rainBinFormat } from "@garbro-mcp/formats";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { expectArchive } from "../helpers/archive.js";
import { describe, expect, it } from "vitest";

const INDEX_OFFSET = 4;
const RECORD_SIZE = 12;

interface Entry {
	number: number;
	content: Buffer;
}

/** The count sits at 0 and twelve-byte records follow it, with payloads behind the index. */
function buildRain(entries: readonly Entry[]): Buffer {
	const indexSize = RECORD_SIZE * entries.length;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeUInt32LE(entries.length, 0);
	let data = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		archive.writeUInt32LE(entry.number, record);
		archive.writeUInt32LE(data, record + 4);
		archive.writeUInt32LE(entry.content.length, record + 8);
		entry.content.copy(archive, data);
		data += entry.content.length;
	}
	return archive;
}

/** An SZDD header, four padding bytes, the unpacked size, then the LZSS stream. */
function szdd(unpackedSize: number, stream: Buffer): Buffer {
	const header = Buffer.alloc(12);
	header.write("SZDD", 0, "ascii");
	header.writeUInt32LE(unpackedSize, 8);
	return Buffer.concat([header, stream]);
}

describe("Rain Software BIN resource archive", () => {
	it("reads plain payloads and decodes SZDD payloads", async () => {
		const plain = Buffer.from("plain body");
		// One control byte drives the whole stream: its low bit emits the literal 'A' at ring position
		// 0xFF0, and the next two clear bits start matches. The first match reads ring offset 0xF00
		// three times, which only yields spaces when the ring fill is 0x20; the second reads ring
		// offset 0xFF0 three times, which yields the literal followed by two fills, proving that the
		// ring starts at 0xFF0. The stream ends there, so the control byte's remaining clear bits are
		// never reached.
		const stream = Buffer.from([0x01, 0x41, 0x00, 0xf0, 0xf0, 0xf0]);
		await expectArchive({
			format: rainBinFormat,
			archive: buildRain([
				{ number: 1, content: plain },
				{ number: 2, content: szdd(7, stream) },
			]),
			sourcePath: "packbin.bin",
			entries: [
				{ path: "00001.bin", size: plain.length, content: plain },
				{ path: "00002.bin", size: 7, content: Buffer.from("A   A  ") },
			],
		});
	});

	/** A picture of the engine: the head, the colour maps and the places of the picture. */
	function cgdPicture(input: {
		width: number;
		height: number;
		places: Buffer;
		blocks?: number[];
		blockPlaces?: Buffer;
		rgb16?: number;
		rgb24?: number;
	}): Buffer {
		const rgb16 = input.rgb16 ?? 0;
		const rgb24 = input.rgb24 ?? 0;
		const head = Buffer.alloc(0x2c);
		// The count of the whole data of the picture, of which the head names the place of the places of it.
		head.writeInt32LE(rgb24 + input.places.length, 0);
		head.writeUInt32LE(input.width, 4);
		head.writeUInt32LE(input.height, 8);
		head.writeInt32LE(input.blocks ? 0x2c : 0, 0x20);
		head.writeInt32LE(rgb16, 0x24);
		head.writeInt32LE(rgb24, 0x28);
		const table = Buffer.alloc((input.blocks?.length ?? 0) * 4);
		for (const [index, word] of (input.blocks ?? []).entries())
			table.writeInt32LE(word, index * 4);
		return Buffer.concat([
			head,
			table,
			Buffer.alloc(Math.max(rgb24 - rgb16, 0), 0x5a),
			input.blockPlaces ?? input.places,
		]);
	}

	/** The picture an entry stands of, read back through the bitmap walk of this project. */
	async function pictureOfEntry(
		archive: Buffer,
		index: number,
	): Promise<{ width: number; height: number; pixels: number[] }> {
		const handle = await rainBinFormat.open(
			new BufferByteSource(archive),
			"packcgd.bin",
		);
		const entry = handle.entries[index];
		if (!entry) throw new Error("no entry");
		const image = readBmpImage(
			await consumeBuffer(await handle.openEntry(entry.id)),
		);
		if (!image) throw new Error("no bitmap");
		return {
			width: image.width,
			height: image.height,
			pixels: [...image.pixels],
		};
	}

	it("reads the places of a picture of the engine of no table of blocks", async () => {
		// Two pixels of three places of a colour, the colour maps standing between the head and the places.
		const places = Buffer.from([1, 2, 3, 4, 5, 6]);
		const picture = cgdPicture({
			width: 2,
			height: 1,
			places,
			rgb24: 0x10,
		});
		const archive = buildRain([{ number: 1, content: picture }]);
		expect(await pictureOfEntry(archive, 0)).toEqual({
			width: 2,
			height: 1,
			pixels: [1, 2, 3, 4, 5, 6],
		});
	});

	it("reads the places of a picture of the engine of a table of blocks", async () => {
		// One block of eight pixels to a row and eight rows stands of a word naming one block and a row of
		// eight pixels of three places of a colour; the places of the seven rows behind the first stand of a
		// run of their own.
		const row = Buffer.alloc(8 * 3);
		for (let place = 0; place < row.length; place += 1) row[place] = place;
		const rest = Buffer.alloc(7 * 8 * 3, 0x40);
		const picture = cgdPicture({
			width: 8,
			height: 8,
			places: Buffer.alloc(0),
			// A word of a block stands of the count of its places of a row in its high places and of the count
			// of the blocks of the run in the places behind them.
			// Every block stands of two words of the table, of which the walk of the places stands of the
			// first alone for a picture of one row of blocks.
			blocks: [(1 << 16) | (1 << 8), 0],
			blockPlaces: Buffer.concat([row, rest]),
		});
		const archive = buildRain([{ number: 1, content: picture }]);
		const shown = await pictureOfEntry(archive, 0);
		expect(shown).toMatchObject({ width: 8, height: 8 });
		expect(shown.pixels.slice(0, 24)).toEqual([...row]);
		expect(shown.pixels.slice(24, 48)).toEqual([...rest.subarray(0, 24)]);
	});

	it("requires the pack name pattern", async () => {
		const archive = buildRain([{ number: 1, content: Buffer.from("x") }]);
		await expectArchive({
			format: rainBinFormat,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a duplicate entry number", async () => {
		const archive = buildRain([
			{ number: 1, content: Buffer.from("x") },
			{ number: 1, content: Buffer.from("y") },
		]);
		await expectArchive({
			format: rainBinFormat,
			archive,
			sourcePath: "packbin.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects an offset inside the index", async () => {
		const archive = buildRain([{ number: 1, content: Buffer.from("x") }]);
		archive.writeUInt32LE(0, INDEX_OFFSET + 4);
		await expectArchive({
			format: rainBinFormat,
			archive,
			sourcePath: "packbin.bin",
			detected: false,
			entries: [],
		});
	});
});
