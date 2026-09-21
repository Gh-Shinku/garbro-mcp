import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { readWave } from "../../packages/formats/src/shared/wav.js";
import {
	findWpxSection,
	readWpxIndex,
} from "../../packages/formats/src/wildbug/wpx-section.js";
import {
	readWwaLayout,
	wildbugWwaAudioFormat,
	writeWwaWave,
} from "../../packages/formats/src/wildbug/wwa-audio.js";

const HEADER = 0x10;
const RECORD = 16;
const WAVE_TAIL = 20;

interface Record {
	id: number;
	format: number;
	body: Buffer;
	/** What the record names where its packed length stands. */
	packedSize?: number;
}

/** A file of this engine: the word, the kind, the directory, and the sections' bytes behind it. */
function wpxFile(options: {
	marker: string;
	records: Record[];
	recordSize?: number;
	version?: number;
	count?: number;
}): Buffer {
	const recordSize = options.recordSize ?? RECORD;
	const count = options.count ?? options.records.length;
	const directorySize = count * recordSize;
	const head = Buffer.alloc(HEADER, 0x00);
	head.write("WPX\u001a", 0, "latin1");
	head.write(options.marker, 4, "latin1");
	head[0x0c] = options.version ?? 1;
	head[0x0e] = count;
	head[0x0f] = recordSize;
	let offset = HEADER + directorySize;
	const directory = Buffer.alloc(directorySize, 0x00);
	const bodies: Buffer[] = [];
	options.records.forEach((record, index) => {
		const at = index * recordSize;
		directory[at] = record.id;
		directory[at + 1] = record.format;
		directory.writeInt32LE(offset, at + 4);
		directory.writeInt32LE(record.body.length, at + 8);
		directory.writeInt32LE(record.packedSize ?? 0, at + 12);
		bodies.push(record.body);
		offset += record.body.length;
	});
	return Buffer.concat([head, directory, ...bodies]);
}

/** The format block of a plain wave: two channels, forty four thousand and one hundred a second. */
function formatBlock(extra = 0): Buffer {
	const block = Buffer.alloc(16 + extra, 0x00);
	block.writeUInt16LE(1, 0);
	block.writeUInt16LE(2, 2);
	block.writeUInt32LE(44100, 4);
	block.writeUInt32LE(176400, 8);
	block.writeUInt16LE(4, 12);
	block.writeUInt16LE(16, 14);
	for (let at = 16; at < block.length; at += 1) block[at] = at & 0xff;
	return block;
}

function sound(records: Record[], recordSize = RECORD): Buffer {
	return wpxFile({ marker: "WAV", records, recordSize });
}

function defaultRecords(pcm: Buffer, extra = 0): Record[] {
	return [
		{ id: 0x20, format: 0x80, body: formatBlock(extra) },
		{ id: 0x21, format: 0x80, body: pcm, packedSize: pcm.length },
	];
}

async function extracted(file: Buffer): Promise<Buffer> {
	const archive = await wildbugWwaAudioFormat.open(
		new BufferByteSource(file),
		"sound.wwa",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("the sound has no entry");
		const chunks: Buffer[] = [];
		for await (const chunk of await archive.openEntry(entry.id)) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks);
	} finally {
		await archive.close();
	}
}

describe("Wild Bug WWA audio", () => {
	it("wraps the samples in a wave file around the format block it copies", async () => {
		const pcm = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const file = sound(defaultRecords(pcm));
		const layout = readWwaLayout(file);
		if (!layout) throw new Error("the fixture is not a WWA sound");
		expect(layout.format.channels).toBe(2);
		expect(layout.format.sampleRate).toBe(44100);
		expect(layout.format.bitsPerSample).toBe(16);
		expect(layout.pcm).toEqual(pcm);
		const wave = writeWwaWave(layout);
		expect(wave.subarray(0, 4)).toEqual(Buffer.from("RIFF", "latin1"));
		expect(wave.readUInt32LE(4)).toBe(WAVE_TAIL + 16 + pcm.length);
		expect(wave.subarray(8, 12)).toEqual(Buffer.from("WAVE", "latin1"));
		expect(wave.subarray(12, 16)).toEqual(Buffer.from("fmt ", "latin1"));
		expect(wave.readUInt32LE(16)).toBe(16);
		expect(wave.subarray(20, 36)).toEqual(formatBlock());
		expect(wave.subarray(36, 40)).toEqual(Buffer.from("data", "latin1"));
		expect(wave.readUInt32LE(40)).toBe(pcm.length);
		expect(wave.subarray(44)).toEqual(pcm);
		// The wave the project reads back says the same things.
		const read = readWave(wave);
		if (!read) throw new Error("the sound is not a wave");
		expect(read.format).toEqual(layout.format);
		expect(read.dataOffset).toBe(44);
		expect(read.dataSize).toBe(pcm.length);
		expect(await extracted(file)).toEqual(wave);
	});

	it("copies a format block longer than a plain wave one as it stands", async () => {
		const pcm = Buffer.from([9, 8, 7]);
		const file = sound(defaultRecords(pcm, 2));
		const layout = readWwaLayout(file);
		if (!layout) throw new Error("the fixture is not a WWA sound");
		expect(layout.formatBlock.length).toBe(18);
		const wave = writeWwaWave(layout);
		// A canonical writer would drop the two extra bytes and move the samples block behind them.
		expect(wave.subarray(20, 38)).toEqual(formatBlock(2));
		expect(wave.subarray(38, 42)).toEqual(Buffer.from("data", "latin1"));
		expect(wave.subarray(46)).toEqual(pcm);
		expect((await extracted(file)).subarray(46)).toEqual(pcm);
	});

	it("finds the records wherever they stand in the directory", () => {
		const pcm = Buffer.from([4, 4, 4, 4]);
		const records = defaultRecords(pcm);
		const reversed = [records[1], records[0]] as Record[];
		const file = sound(reversed);
		const layout = readWwaLayout(file);
		if (!layout) throw new Error("the fixture is not a WWA sound");
		// The samples are taken from the place their own record names, not from where the stream stands.
		expect(layout.pcm).toEqual(pcm);
		expect(layout.format.sampleRate).toBe(44100);
	});

	it("walks a directory whose records are wider than they need to be", () => {
		const pcm = Buffer.from([2, 2]);
		const file = sound(defaultRecords(pcm), 32);
		const index = readWpxIndex(file, "WAV");
		if (!index) throw new Error("the fixture has no index");
		expect(index.directorySize).toBe(32);
		expect(
			findWpxSection(index.directory, 0x21, index.count, 32)?.unpackedSize,
		).toBe(2);
		expect(readWwaLayout(file)?.pcm).toEqual(pcm);
	});

	it("tells a sound of this engine from a picture of it", async () => {
		const pcm = Buffer.from([1]);
		const wave = sound(defaultRecords(pcm));
		const picture = wpxFile({
			marker: "BMP",
			records: defaultRecords(pcm),
		});
		expect(await wildbugWwaAudioFormat.detect(new BufferByteSource(wave))).toBe(
			true,
		);
		expect(
			await wildbugWwaAudioFormat.detect(new BufferByteSource(picture)),
		).toBe(false);
		expect(readWwaLayout(picture)).toBeUndefined();
	});

	it("keeps the walk of the records inside the directory", () => {
		const directory = Buffer.alloc(RECORD * 2, 0x00);
		directory[0] = 0x20;
		expect(findWpxSection(directory, 0x20, 2, RECORD)?.dataFormat).toBe(0);
		// The record asked for is not there, and the count ends the walk before the end.
		expect(findWpxSection(directory, 0x21, 2, RECORD)).toBeUndefined();
		expect(findWpxSection(directory, 0x21, 1, RECORD)).toBeUndefined();
		// A directory that stops inside the record it names.
		expect(
			findWpxSection(directory.subarray(0, 8), 0x20, 1, RECORD),
		).toBeUndefined();
	});

	it("refuses a sound it cannot read", () => {
		const pcm = Buffer.from([1, 2]);
		const base = sound(defaultRecords(pcm));
		expect(readWwaLayout(base)).toBeDefined();
		const noFormatSection = sound([{ id: 0x21, format: 0x80, body: pcm }]);
		expect(readWwaLayout(noFormatSection)).toBeUndefined();
		const wrongFormat = sound([
			{ id: 0x20, format: 0x02, body: formatBlock() },
			{ id: 0x21, format: 0x80, body: pcm },
		]);
		expect(readWwaLayout(wrongFormat)).toBeUndefined();
		const shortBlock = sound([
			{ id: 0x20, format: 0x80, body: Buffer.alloc(8, 0x00) },
			{ id: 0x21, format: 0x80, body: pcm },
		]);
		expect(readWwaLayout(shortBlock)).toBeUndefined();
		const noData = sound([{ id: 0x20, format: 0x80, body: formatBlock() }]);
		expect(readWwaLayout(noData)).toBeUndefined();
		// A record that names samples reaching past the file.
		const past = Buffer.from(base);
		past.writeInt32LE(past.length, HEADER + 4 + 4);
		expect(readWwaLayout(past)).toBeUndefined();
		// A head of another version, no records, and a record narrower than its own fields.
		expect(
			readWpxIndex(
				wpxFile({
					marker: "WAV",
					records: defaultRecords(pcm),
					version: 2,
				}),
				"WAV",
			),
		).toBeUndefined();
		// A head that names no records at all.
		const empty = Buffer.from(base);
		empty[0x0e] = 0;
		expect(readWpxIndex(empty, "WAV")).toBeUndefined();
		// A record narrower than the fields it holds, which the reference would read into its neighbour.
		const narrow = Buffer.from(base);
		narrow[0x0f] = 8;
		expect(readWpxIndex(narrow, "WAV")).toBeUndefined();
		expect(readWwaLayout(base.subarray(0, 20))).toBeUndefined();
	});
});
