import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { system98LibFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { literalLzssStream } from "../helpers/lzss.js";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

const RECORD_SIZE = 0x16;
/** Packed payloads carry a 10-byte prefix with their unpacked size at +6. */
const PREFIX_SIZE = 10;

interface Entry {
	name: string;
	content: Buffer;
	/** The stored payload; defaults to the content. */
	stored?: Buffer;
	/** Whether the record marks the payload as packed. */
	packed?: boolean;
}

function storedOf(entry: Entry): Buffer {
	return entry.stored ?? entry.content;
}

/** Writes records with payload offsets that start at `payloadBase`. */
function buildIndex(entries: readonly Entry[], payloadBase: number): Buffer {
	const index = Buffer.alloc(RECORD_SIZE * entries.length);
	let running = payloadBase;
	for (const [id, entry] of entries.entries()) {
		const record = id * RECORD_SIZE;
		index.write(entry.name, record, "latin1");
		index.writeUInt8(entry.packed ? 1 : 0, record + 0x0c);
		index.writeUInt32LE(storedOf(entry).length, record + 0x0e);
		index.writeUInt32LE(running, record + 0x12);
		running += storedOf(entry).length;
	}
	return index;
}

/** A `Cat0` archive: the plain index sits inside the LIB behind its six-byte header. */
function buildPlain(entries: readonly Entry[]): {
	archive: Buffer;
	index: Buffer;
} {
	const indexSize = RECORD_SIZE * entries.length;
	const index = buildIndex(entries, 6 + indexSize);
	const header = Buffer.alloc(6);
	header.write("Lib0", 0, "latin1");
	return {
		archive: Buffer.concat([header, index, ...entries.map(storedOf)]),
		index,
	};
}

/** A `Cat1` archive: the LIB is only a header plus payloads, and the CAT holds the packed index. */
function buildPacked(entries: readonly Entry[]): {
	archive: Buffer;
	index: Buffer;
} {
	const index = buildIndex(entries, 6);
	const header = Buffer.alloc(6);
	header.write("Lib0", 0, "latin1");
	return {
		archive: Buffer.concat([header, ...entries.map(storedOf)]),
		index,
	};
}

/** A CAT file: its magic and a 16-bit entry count. */
function buildCat(magic: string, count: number, index?: Buffer): Buffer {
	const cat = Buffer.alloc(6 + (index?.length ?? 0));
	cat.write(magic, 0, "latin1");
	cat.writeInt16LE(count, 4);
	index?.copy(cat, 6);
	return cat;
}

/** A packed payload: a 10-byte prefix holding the unpacked size, then the LZSS stream. */
function packedPayload(content: Buffer, stream: Buffer): Buffer {
	const payload = Buffer.alloc(PREFIX_SIZE + stream.length);
	payload.writeUInt32LE(content.length, 6);
	stream.copy(payload, PREFIX_SIZE);
	return payload;
}

/**
 * Builds the format's LZSS stream around an optional match. Control bits are packed least significant
 * first, and a match's two bytes carry a 12-bit offset and a length biased by three.
 */
function buildMatchStream(
	literals: readonly number[],
	match?: readonly [number, number],
): Buffer {
	const bytes: number[] = [];
	let control = 0;
	let bit = 1;
	for (const literal of literals) {
		control |= bit;
		bytes.push(literal);
		bit = (bit << 1) & 0xff;
	}
	if (match) {
		const [offset, count] = match;
		bytes.push(((offset & 0x0f) << 4) | ((count - 3) & 0x0f), offset >> 4);
	}
	return Buffer.concat([Buffer.from([control]), Buffer.from(bytes)]);
}

describe("System-98 engine resource archive", () => {
	it("reads a plain index from the LIB and decodes packed payloads", async () => {
		const raw = Buffer.from("stored payload");
		const content = Buffer.from("packed payload");
		const entries: Entry[] = [
			{ name: "raw.bin", content: raw },
			{
				name: "packed.bin",
				content,
				stored: packedPayload(content, literalLzssStream(content)),
				packed: true,
			},
		];
		const { archive } = buildPlain(entries);
		await withCompanionFiles(
			"sample.Lib",
			{ "sample.Lib": archive, "sample.CAT": buildCat("Cat0", entries.length) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: system98LibFormat,
					mainPath,
					entries: [
						{ path: "raw.bin", size: raw.length, content: raw },
						{ path: "packed.bin", size: content.length, content },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("decodes a packed index from the CAT", async () => {
		const content = Buffer.from("payload behind a packed index");
		const entries: Entry[] = [{ name: "file.bin", content }];
		const { archive, index } = buildPacked(entries);
		await withCompanionFiles(
			"sample.Lib",
			{
				"sample.Lib": archive,
				"sample.CAT": buildCat(
					"Cat1",
					entries.length,
					literalLzssStream(index),
				),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: system98LibFormat,
					mainPath,
					entries: [{ path: "file.bin", size: content.length, content }],
				});
			},
		);
	});

	it("copies matches through the ring buffer", async () => {
		// Two literals seed the ring at position one, then a match copies four bytes from behind it.
		const content = Buffer.from("ABABAB");
		const entries: Entry[] = [
			{
				name: "match.bin",
				content,
				stored: packedPayload(content, buildMatchStream([0x41, 0x42], [1, 4])),
				packed: true,
			},
		];
		const { archive } = buildPlain(entries);
		await withCompanionFiles(
			"sample.Lib",
			{ "sample.Lib": archive, "sample.CAT": buildCat("Cat0", entries.length) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: system98LibFormat,
					mainPath,
					entries: [{ path: "match.bin", size: content.length, content }],
				});
			},
		);
	});

	it("trims trailing whitespace from names", async () => {
		const content = Buffer.from("trimmed payload");
		const entries: Entry[] = [{ name: "name.bin  ", content }];
		const { archive } = buildPlain(entries);
		await withCompanionFiles(
			"sample.Lib",
			{ "sample.Lib": archive, "sample.CAT": buildCat("Cat0", entries.length) },
			async (mainPath) => {
				await expectCompanionArchive({
					format: system98LibFormat,
					mainPath,
					entries: [{ path: "name.bin", size: content.length, content }],
				});
			},
		);
	});

	it("rejects a LIB without its companion CAT", async () => {
		await withCompanionFiles(
			"sample.Lib",
			{ "sample.Lib": Buffer.from("Lib0\0\0\0\0") },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await system98LibFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects an unknown CAT magic", async () => {
		const entries: Entry[] = [{ name: "a.bin", content: Buffer.from("x") }];
		const { archive } = buildPlain(entries);
		await withCompanionFiles(
			"sample.Lib",
			{
				"sample.Lib": archive,
				"sample.CAT": buildCat("Cat2", entries.length),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await system98LibFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects an insane entry count", async () => {
		await withCompanionFiles(
			"sample.Lib",
			{
				"sample.Lib": Buffer.from("Lib0\0\0\0\0"),
				"sample.CAT": Buffer.from([...Buffer.from("Cat0", "latin1"), 0, 0x80]),
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await system98LibFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects a payload outside the archive", async () => {
		const entries: Entry[] = [{ name: "a.bin", content: Buffer.from("x") }];
		const { archive, index } = buildPlain(entries);
		index.writeUInt32LE(0x1000, 0x12);
		const broken = Buffer.concat([
			archive.subarray(0, 6),
			index,
			archive.subarray(6 + index.length),
		]);
		await withCompanionFiles(
			"sample.Lib",
			{ "sample.Lib": broken, "sample.CAT": buildCat("Cat0", entries.length) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await system98LibFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects a foreign LIB signature", async () => {
		expect(
			await system98LibFormat.detect(
				new BufferByteSource(Buffer.from("Lib1\0\0\0\0")),
				"sample.Lib",
			),
		).toBe(false);
	});
});
