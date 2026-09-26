// The NScripter engine resource archive (GARbro "ArcFormats/NScripter/ArcNSA.cs", class NsaOpener), against
// archives built in the test. The index of the archive stands of the count of its files, of the place of
// their tables and of the names, places and walks of the files themselves.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { nsaFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** A walker of the places of the file of the engine, which stands of the high place of a place first. */
class BitWriter {
	#bytes: number[] = [];
	#value = 0;
	#count = 0;

	write(value: number, count: number): void {
		for (let at = count - 1; at >= 0; at -= 1) {
			this.#value = (this.#value << 1) | ((value >> at) & 1);
			this.#count += 1;
			if (8 === this.#count) {
				this.#bytes.push(this.#value & 0xff);
				this.#value = 0;
				this.#count = 0;
			}
		}
	}

	done(): Buffer {
		if (0 !== this.#count)
			this.#bytes.push((this.#value << (8 - this.#count)) & 0xff);
		return Buffer.from(this.#bytes);
	}
}

interface FileIn {
	name: string;
	compression: number;
	data: Buffer;
	unpacked?: number;
}

/** An archive of the engine: the count of the files, the place of their tables, the index, and the data. */
function nsaFile(input: {
	zero?: boolean;
	files: FileIn[];
	placed?: number;
}): Buffer {
	const start = input.zero ? 2 : 0;
	const count = input.files.length;
	const words: Buffer[] = [];
	let offset = 0;
	for (const file of input.files) {
		const name = Buffer.from(`${file.name}\0`, "latin1");
		const record = Buffer.alloc(13, 0x00);
		record[0] = file.compression;
		record.writeUInt32BE(offset, 1);
		record.writeUInt32BE(file.data.length, 5);
		record.writeUInt32BE(file.unpacked ?? file.data.length, 9);
		words.push(name, record);
		offset += file.data.length;
	}
	const index = Buffer.concat(words);
	// The place of the tables of the engine stands of the count of the files and of the count of the
	// places of the index itself, of thirteen places of the file behind the last name of it.
	const placed = input.placed ?? Math.max(15 * count, index.length + 6 + 13);
	const padding = placed - 6 - index.length;
	const data = Buffer.concat(input.files.map((file) => file.data));
	const head = Buffer.alloc(start + 6, 0x00);
	head.writeInt16BE(count, start);
	head.writeUInt32BE(placed, start + 2);
	return Buffer.concat([head, index, Buffer.alloc(padding, 0x00), data]);
}

describe("NScripter engine resource archive", () => {
	it("reads the index of the archive and hands over a file of the places as they stand", async () => {
		const file = nsaFile({
			files: [
				{
					name: "plain.txt",
					compression: 0,
					data: Buffer.from("as it stands", "latin1"),
				},
			],
		});
		const source = new BufferByteSource(file);
		expect(await nsaFormat.detect(source, "sample.nsa")).toBe(true);
		const archive = await nsaFormat.open(source, "sample.nsa");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["plain.txt"]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			expect(Number(entry.size)).toBe(12);
			expect(entry.compressed).toBe(false);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("as it stands", "latin1"),
			);
		} finally {
			await archive.close();
		}
	});

	it("reads a file of the engine of the walk of the places of the file", async () => {
		// The walk of the engine: one place of the stream that stands of one stands of the next eight
		// places of the file, so a file of the places that all stand on their own stands of a walk of one
		// place of the stream and eight places of the file.
		const writer = new BitWriter();
		const plain = Buffer.from("abcd", "latin1");
		for (const byte of plain) {
			writer.write(1, 1);
			writer.write(byte, 8);
		}
		const file = nsaFile({
			files: [
				{ name: "walk.txt", compression: 2, data: writer.done(), unpacked: 4 },
			],
		});
		const source = new BufferByteSource(file);
		expect(await nsaFormat.detect(source, "sample.nsa")).toBe(true);
		const archive = await nsaFormat.open(source, "sample.nsa");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			expect(entry.compressed).toBe(true);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("reads a picture of the engine of the count the places of its file stand of", async () => {
		// A picture of two places by two: for every one of the three planes of the picture the walk stands
		// of the first place of the plane and then of a count of nought, which stands of four places of the
		// same colour, so every plane of the picture stands of one colour.
		const writer = new BitWriter();
		for (const colour of [0x11, 0x22, 0x33]) {
			writer.write(colour, 8);
			writer.write(0, 3);
		}
		const head = Buffer.from([0x00, 0x02, 0x00, 0x02]);
		const file = nsaFile({
			files: [
				{
					name: "picture.spb",
					compression: 1,
					data: Buffer.concat([head, writer.done()]),
					unpacked: 0x100,
				},
			],
		});
		const source = new BufferByteSource(file);
		expect(await nsaFormat.detect(source, "sample.nsa")).toBe(true);
		const archive = await nsaFormat.open(source, "sample.nsa");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			const places = await consumeBuffer(await archive.openEntry(entry.id));
			expect(places.subarray(0, 2).toString("latin1")).toBe("BM");
			const picture = readBmpImage(places);
			if (!picture) throw new Error("no picture");
			expect([picture.width, picture.height, picture.bitsPerPixel]).toEqual([
				2, 2, 24,
			]);
			for (let at = 0; at < picture.pixels.length; at += 3) {
				expect([...picture.pixels.subarray(at, at + 3)]).toEqual([
					0x11, 0x22, 0x33,
				]);
			}
		} finally {
			await archive.close();
		}
	});

	it("turns away a file of the walk of bzip2 and a file of no index at all", async () => {
		const file = nsaFile({
			files: [
				{
					name: "sound.nbz",
					compression: 4,
					data: Buffer.from("BZh9", "latin1"),
				},
			],
		});
		const source = new BufferByteSource(file);
		const archive = await nsaFormat.open(source, "sample.nsa");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			expect(entry.metadata).toMatchObject({ type: "audio", compression: 4 });
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "UNSUPPORTED_FEATURE",
			});
		} finally {
			await archive.close();
		}
		// A file of the mark of a sound of the engine stands of an archive of one sound.
		const sound = Buffer.concat([
			Buffer.from([0xff, 0xfb, 0x90]),
			Buffer.alloc(0x40, 0x00),
		]);
		const soundSource = new BufferByteSource(sound);
		expect(await nsaFormat.detect(soundSource, "music.nsa")).toBe(true);
		const wrapped = await nsaFormat.open(soundSource, "music.nsa");
		try {
			expect(wrapped.entries.map((entry) => entry.path)).toEqual(["music.mp3"]);
			expect(wrapped.metadata).toMatchObject({ shape: "one-sound" });
		} finally {
			await wrapped.close();
		}
	});

	it("stands of no file of a count of files beyond any archive or of a place beyond it", async () => {
		const good = nsaFile({
			files: [{ name: "a.txt", compression: 0, data: Buffer.alloc(4, 0x01) }],
		});
		const count = Buffer.from(good);
		count.writeInt16BE(0x7fff, 0);
		const placed = Buffer.from(good);
		placed.writeUInt32BE(0x10000, 2);
		for (const [what, data] of [
			["a count of files beyond any archive", count],
			["a place of the tables beyond the file", placed],
		] as [string, Buffer][]) {
			const source = new BufferByteSource(data);
			expect(await nsaFormat.detect(source, "other.nsa"), what).toBe(false);
		}
	});
});
