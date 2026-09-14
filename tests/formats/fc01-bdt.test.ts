import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import {
	KEY_OFFSET_TABLE,
	KEY_SOURCE,
	KEY_SOURCE_SHIFT,
	fc01BdtFormat,
} from "@garbro-mcp/formats";
import { createCipheriv } from "node:crypto";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { withCompanionFiles } from "../helpers/companion.js";

const HEADER_SIZE = 12;

/** The key the archive's number picks out of the reference's tables, worked out the way the reference does. */
function keyFor(number: number): Buffer {
	const at = number * 8;
	const key: Buffer = Buffer.alloc(8, 0x00);
	for (let index = 0; index < 8; index += 1) {
		const offset = KEY_OFFSET_TABLE[at + index] ?? 0;
		key[index] = KEY_SOURCE[offset + (index < 3 ? 0 : KEY_SOURCE_SHIFT)] ?? 0;
	}
	return key;
}

/** Builds a literal only lzss stream: one control byte per eight literals, least significant bit first. */
function literalStream(data: Buffer): Buffer {
	const output: number[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const group = data.subarray(start, start + 8);
		let control = 0;
		const body: number[] = [];
		for (const [index, value] of group.entries()) {
			control |= 1 << index;
			body.push(value);
		}
		output.push(control, ...body);
	}
	return Buffer.from(output);
}

/** The reference's own encryption of an entry's head, so a fixture can carry one. */
function encryptHead(plain: Buffer, key: Buffer): Buffer {
	const padded: Buffer = Buffer.alloc(Math.ceil(plain.length / 8) * 8, 0x00);
	plain.copy(padded);
	// The same single des the port runs, reached through the three key slots of triple des.
	const cipher = createCipheriv(
		"des-ede3",
		Buffer.concat([key, key, key]),
		null,
	);
	cipher.setAutoPadding(false);
	const output = Buffer.concat([cipher.update(padded), cipher.final()]);
	return Buffer.from(output.subarray(0, plain.length));
}

interface RecordSpec {
	name: string;
	unpackedSize: number;
	size: number;
	method: number;
	offset: number;
}

interface BdtOptions {
	records?: RecordSpec[];
	data?: Buffer;
	recordSize?: number;
	/** Replaces the whole file behind the header. */
	body?: Buffer;
	signature?: string;
}

/** An archive that holds its own records, which is what the index archive itself does. */
function buildBdt(options: BdtOptions = {}): Buffer {
	const records = options.records ?? [];
	const recordSize = options.recordSize ?? 0x20;
	const data = options.data ?? Buffer.alloc(0);
	const index: Buffer = Buffer.alloc(records.length * recordSize, 0x00);
	for (const [position, record] of records.entries()) {
		const at = position * recordSize;
		index.writeUInt32LE(record.unpackedSize, at);
		index.writeUInt32LE(record.size, at + 4);
		index.writeInt32LE(record.method, at + 8);
		index.writeUInt32LE(record.offset, at + 0x0c);
		index.write(record.name, at + 0x10, "latin1");
	}
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.signature ?? "PACK", 0, "latin1");
	header.writeInt32LE(records.length, 4);
	header.writeInt32LE(recordSize, 8);
	return Buffer.concat([header, options.body ?? index, data]);
}

/** An archive whose records live in the index archive beside it. */
function buildPlain(
	recordCount: number,
	data: Buffer,
	recordSize = 0x20,
): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("PACK", 0, "latin1");
	header.writeInt32LE(recordCount, 4);
	header.writeInt32LE(recordSize, 8);
	// The records of this file live in the index archive, but its own header still measures where its data is.
	return Buffer.concat([
		header,
		Buffer.alloc(recordCount * recordSize, 0x00),
		data,
	]);
}

/** The records of one archive, as the index archive keeps them. */
function vomIndex(records: RecordSpec[], recordSize = 0x20): Buffer {
	const index: Buffer = Buffer.alloc(records.length * recordSize, 0x00);
	for (const [position, record] of records.entries()) {
		const at = position * recordSize;
		index.writeUInt32LE(record.unpackedSize, at);
		index.writeUInt32LE(record.size, at + 4);
		index.writeInt32LE(record.method, at + 8);
		index.writeUInt32LE(record.offset, at + 0x0c);
		index.write(record.name, at + 0x10, "latin1");
	}
	return index;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(
	file: Buffer,
	name: string,
	entryIndex = 0,
): Promise<Buffer> {
	const archive = await fc01BdtFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[entryIndex];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Fairytale resource archive", () => {
	it("declares its word and asks to be tried on every file", async () => {
		expect(fc01BdtFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("PACK", "ascii") },
		]);
		expect(fc01BdtFormat.detection?.extensionFallback).toBe(true);
		expect(fc01BdtFormat.descriptor.extensions).toEqual([]);
		expect(
			await fc01BdtFormat.detect(
				sourceOf(
					buildBdt({
						records: [
							{ name: "a.dat", unpackedSize: 2, size: 2, method: 0, offset: 0 },
						],
						data: Buffer.from([1, 2]),
					}),
				),
				"dt004.bdt",
			),
		).toBe(true);
		expect(
			await fc01BdtFormat.detect(sourceOf(Buffer.alloc(8)), "dt004.bdt"),
		).toBe(false);
	});

	it("reads the records the index archive holds itself", async () => {
		const body = Buffer.from([0xaa, 0xbb, 0xcc]);
		const file = buildBdt({
			records: [
				{
					name: "first.clm",
					unpackedSize: 0x800,
					size: 3,
					method: 6,
					offset: 0,
				},
				{
					name: "Copyright.Dat",
					unpackedSize: 9,
					size: 0,
					method: 0,
					offset: 0,
				},
			],
			data: body,
		});
		const archive = await fc01BdtFormat.open(sourceOf(file), "dt004.bdt");
		try {
			expect(archive.metadata).toEqual({ entryCount: 2, keyIndex: 4 });
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"first.clm",
				"Copyright.Dat",
			]);
			expect(archive.entries[0]?.size).toBe(3n);
			expect(archive.entries[0]?.metadata).toMatchObject({
				method: 6,
				unpackedSize: 0x800,
			});
			expect(archive.entries[1]?.metadata).toMatchObject({ special: true });
		} finally {
			await archive.close();
		}
	});

	it("takes its records out of the index archive beside it", async () => {
		// The records of dt001 live in dt004, in a file named for it, an entry of which is read in turn.
		const records: RecordSpec[] = [
			{ name: "image.clm", unpackedSize: 4, size: 4, method: 0, offset: 0 },
			{ name: "sound.wav", unpackedSize: 2, size: 2, method: 0, offset: 4 },
		];
		const contents = Buffer.from([1, 2, 3, 4, 5, 6]);
		const index = vomIndex(records);
		const companion = buildBdt({
			records: [
				{
					name: "vom001.dat",
					unpackedSize: index.length,
					size: index.length,
					method: 0,
					offset: 0,
				},
			],
			data: index,
		});
		const main = buildPlain(records.length, contents);
		await withCompanionFiles(
			"dt001.bdt",
			{ "dt001.bdt": main, "dt004.bdt": companion },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await fc01BdtFormat.detect(source, mainPath)).toBe(true);
				const archive = await fc01BdtFormat.open(source, mainPath);
				try {
					expect(archive.metadata).toEqual({ entryCount: 2, keyIndex: 1 });
					expect(archive.entries.map((entry) => entry.path)).toEqual([
						"image.clm",
						"sound.wav",
					]);
				} finally {
					await archive.close();
				}
				const opened = await FileByteSource.open(mainPath);
				const handle = await fc01BdtFormat.open(opened, mainPath);
				try {
					const second = handle.entries[1];
					if (!second) throw new Error("missing entry");
					expect(
						await consumeBuffer(await handle.openEntry(second.id)),
					).toEqual(Buffer.from([5, 6]));
				} finally {
					await handle.close();
				}
			},
		);
	});

	it("counts the index files from the fifth archive up", async () => {
		// dt012 is the eighteenth archive, whose records live in vom017.dat.
		const records: RecordSpec[] = [
			{ name: "a.dat", unpackedSize: 1, size: 1, method: 0, offset: 0 },
		];
		const index = vomIndex(records);
		const companion = buildBdt({
			records: [
				{
					name: "vom017.dat",
					unpackedSize: index.length,
					size: index.length,
					method: 0,
					offset: 0,
				},
			],
			data: index,
		});
		await withCompanionFiles(
			"dt012.bdt",
			{
				"dt012.bdt": buildPlain(1, Buffer.from([7])),
				"dt004.bdt": companion,
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				const archive = await fc01BdtFormat.open(source, mainPath);
				try {
					expect(archive.metadata).toEqual({ entryCount: 1, keyIndex: 18 });
					expect(archive.entries[0]?.path).toBe("a.dat");
				} finally {
					await archive.close();
				}
			},
		);
	});

	it("declines an archive whose index file or index archive is not there", async () => {
		// The records are named for another archive than the one asking for them.
		const index = vomIndex([
			{ name: "a.dat", unpackedSize: 1, size: 1, method: 0, offset: 0 },
		]);
		const companion = buildBdt({
			records: [
				{
					name: "vom002.dat",
					unpackedSize: index.length,
					size: index.length,
					method: 0,
					offset: 0,
				},
			],
			data: index,
		});
		await withCompanionFiles(
			"dt001.bdt",
			{
				"dt001.bdt": buildPlain(1, Buffer.from([7])),
				"dt004.bdt": companion,
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await fc01BdtFormat.detect(source, mainPath)).toBe(false);
			},
		);
		// No index archive at all beside it.
		await withCompanionFiles(
			"dt001.bdt",
			{ "dt001.bdt": buildPlain(1, Buffer.from([7])) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await fc01BdtFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});

	it("declines a name that is not one of the family", async () => {
		const file = buildBdt({
			records: [
				{ name: "a.dat", unpackedSize: 1, size: 1, method: 0, offset: 0 },
			],
			data: Buffer.from([1]),
		});
		expect(await fc01BdtFormat.detect(sourceOf(file), "other.bdt")).toBe(false);
		expect(await fc01BdtFormat.detect(sourceOf(file), "dt0zz.bdt")).toBe(false);
		// A number past the end of the key table is one the reference throws over.
		expect(await fc01BdtFormat.detect(sourceOf(file), "dt0fff.bdt")).toBe(
			false,
		);
	});

	it("hands media kept under the archive's extension over as one entry", async () => {
		const ogg = Buffer.concat([
			Buffer.from("OggS", "ascii"),
			Buffer.alloc(8, 0x11),
		]);
		const avi = Buffer.concat([
			Buffer.from("RIFF", "ascii"),
			Buffer.alloc(4, 0x00),
			Buffer.from("AVI ", "ascii"),
			Buffer.alloc(4, 0x22),
		]);
		const archive = await fc01BdtFormat.open(sourceOf(ogg), "movie.bdt");
		try {
			expect(archive.metadata).toEqual({ entryCount: 1, media: true });
			expect(archive.entries[0]?.path).toBe("movie.ogg");
			expect(archive.entries[0]?.size).toBe(BigInt(ogg.length));
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
		} finally {
			await archive.close();
		}
		expect(await extract(avi, "movie.bdt")).toEqual(avi);
		const aviArchive = await fc01BdtFormat.open(sourceOf(avi), "movie.bdt");
		try {
			expect(aviArchive.entries[0]?.path).toBe("movie.avi");
		} finally {
			await aviArchive.close();
		}
		// A RIFF file that is not tagged as a video, and media under another extension, are not this format.
		const wave = Buffer.concat([
			Buffer.from("RIFF", "ascii"),
			Buffer.alloc(4, 0x00),
			Buffer.from("WAVE", "ascii"),
		]);
		expect(await fc01BdtFormat.detect(sourceOf(wave), "movie.bdt")).toBe(false);
		expect(await fc01BdtFormat.detect(sourceOf(ogg), "movie.dat")).toBe(false);
	});

	it("picks the keys the reference's own tables hold", async () => {
		// Golden values worked out from the tables in the reference, which guard their transcription.
		expect([...keyFor(1)]).toEqual([
			0xbb, 0xb3, 0xa6, 0xdb, 0x3c, 0x3e, 0x24, 0x5e,
		]);
		expect([...keyFor(4)]).toEqual([
			0xbe, 0xce, 0x2f, 0x68, 0xdb, 0xce, 0x2d, 0x61,
		]);
	});

	it("unwraps an entry with the key its number picks out", async () => {
		const content = Buffer.from("an encrypted entry of the index archive");
		const packed = literalStream(content);
		const head: Buffer = Buffer.alloc(1024, 0x00);
		packed.copy(head, 0);
		head.writeInt32LE(packed.length, 1020);
		const file = buildBdt({
			records: [
				{
					name: "secret.dat",
					unpackedSize: packed.length,
					// Seven is the packed method of six, encrypted.
					size: 1024,
					method: 7,
					offset: 0,
				},
			],
			data: encryptHead(head, keyFor(4)),
		});
		expect(await extract(file, "dt004.bdt")).toEqual(content);
	});

	it("joins the unwrapped head to the rest of a longer entry", async () => {
		const first: Buffer = Buffer.alloc(1024, 0x41);
		const head: Buffer = Buffer.alloc(1032, 0x00);
		first.copy(head, 0);
		// The whole head belongs to the entry, so what follows it is carried as it stands.
		head.writeInt32LE(1032, 1028);
		const tail = Buffer.alloc(8, 0x42);
		const file = buildBdt({
			records: [
				{
					name: "long.dat",
					unpackedSize: 1040,
					size: 1040,
					method: 3,
					offset: 0,
				},
			],
			data: Buffer.concat([encryptHead(head, keyFor(4)), tail]),
		});
		const output = await extract(file, "dt004.bdt");
		expect(output.length).toBe(1040);
		expect(output.subarray(0, 1024)).toEqual(first);
		expect(output.subarray(1032)).toEqual(tail);
	});

	it("declines a record with no name and an entry that does not fit", async () => {
		expect(
			await fc01BdtFormat.detect(
				sourceOf(
					buildBdt({
						records: [
							{ name: "", unpackedSize: 0, size: 0, method: 0, offset: 0 },
						],
						data: Buffer.alloc(1),
					}),
				),
				"dt004.bdt",
			),
		).toBe(false);
		expect(
			await fc01BdtFormat.detect(
				sourceOf(
					buildBdt({
						records: [
							{
								name: "a.dat",
								unpackedSize: 0,
								size: 0x40,
								method: 0,
								offset: 0x200,
							},
						],
						data: Buffer.alloc(4),
					}),
				),
				"dt004.bdt",
			),
		).toBe(false);
	});
});
