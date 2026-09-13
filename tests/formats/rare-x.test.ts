import { BufferByteSource, FileByteSource } from "@garbro-mcp/core";
import { rareXFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

const INDEX_OFFSET = 0x3a9a0;
const INDEX_COUNT = 715;
const INDEX_RECORD_SIZE = 12;

/** Writes an MSB-first bit stream, the order the Rare decompressor reads. */
class BitWriter {
	#bits: number[] = [];

	push(value: number, count: number): void {
		for (let index = count - 1; index >= 0; index -= 1)
			this.#bits.push((value >> index) & 1);
	}

	toBuffer(): Buffer {
		const data = Buffer.alloc(Math.ceil(this.#bits.length / 8));
		for (const [index, bit] of this.#bits.entries()) {
			if (bit === 0) continue;
			const position = index >> 3;
			data[position] = (data[position] ?? 0) | (0x80 >> (index & 7));
		}
		return data;
	}
}

/**
 * Builds a Rare payload: `AB` followed by a copy from frame slot 1, which has to reproduce `AB`
 * because offsets index the frame directly rather than counting back from the write cursor.
 */
function buildPayload(): Buffer {
	const writer = new BitWriter();
	writer.push(1, 1);
	writer.push(0x41, 8);
	writer.push(1, 1);
	writer.push(0x42, 8);
	writer.push(0, 1);
	writer.push(1, 10);
	writer.push(2 - 2, 5);
	return writer.toBuffer();
}

/** Reads the first entry of an archive kept next to its index executable. */
async function firstEntryContent(mainPath: string): Promise<Buffer> {
	const source = await FileByteSource.open(mainPath);
	try {
		const archive = await rareXFormat.open(source, mainPath);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			return await consumeBuffer(await archive.openEntry(entry.id));
		} finally {
			await archive.close();
		}
	} finally {
		await source.close();
	}
}

interface Fixture {
	archive: Buffer;
	executable: Buffer;
}

/** Lays out a `PP.X` whose entries share one payload and an executable holding their index. */
function buildFixture(payload: Buffer, options?: { offset?: number }): Fixture {
	const offset = options?.offset ?? 0x10;
	const archive = Buffer.alloc(offset + payload.length);
	payload.copy(archive, offset);
	const executable = Buffer.alloc(
		INDEX_OFFSET + INDEX_RECORD_SIZE * INDEX_COUNT,
	);
	for (let id = 0; id < INDEX_COUNT; id += 1) {
		const base = INDEX_OFFSET + id * INDEX_RECORD_SIZE;
		executable.writeUInt32LE(offset, base);
		executable.writeUInt32LE(payload.length, base + 4);
		executable.writeUInt32LE(4, base + 8);
	}
	return { archive, executable };
}

describe("Rare resource archive", () => {
	it("lists every indexed entry", async () => {
		const payload = buildPayload();
		const { archive, executable } = buildFixture(payload);
		await withCompanionFiles(
			"PP.X",
			{ "PP.X": archive, "seisen.exe": executable },
			async (mainPath) => {
				await expectCompanionArchive({
					format: rareXFormat,
					mainPath,
					entries: Array.from({ length: INDEX_COUNT }, (_, id) => ({
						path: `PP#${String(id).padStart(5, "0")}.BMP`,
						size: 4,
					})),
					metadata: { entryCount: INDEX_COUNT },
				});
			},
		);
	});

	it("decompresses an entry", async () => {
		const payload = buildPayload();
		const { archive, executable } = buildFixture(payload);
		await withCompanionFiles(
			"PP.X",
			{ "PP.X": archive, "seisen.exe": executable },
			async (mainPath) => {
				expect(await firstEntryContent(mainPath)).toEqual(Buffer.from("ABAB"));
			},
		);
	});

	it("accepts a lower case archive name", async () => {
		const payload = buildPayload();
		const { archive, executable } = buildFixture(payload);
		await withCompanionFiles(
			"pp.x",
			{ "pp.x": archive, "seisen.exe": executable },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await rareXFormat.detect(source, mainPath)).toBe(true);
				} finally {
					await source.close();
				}
			},
		);
	});

	it("rejects a file with a different name", async () => {
		const payload = buildPayload();
		const { archive } = buildFixture(payload);
		expect(
			await rareXFormat.detect(new BufferByteSource(archive), "/game/PP.Y"),
		).toBe(false);
	});

	it("rejects a volume without the index executable", async () => {
		const payload = buildPayload();
		const { archive } = buildFixture(payload);
		await withCompanionFiles("PP.X", { "PP.X": archive }, async (mainPath) => {
			expect(
				await rareXFormat.detect(new BufferByteSource(archive), mainPath),
			).toBe(false);
		});
	});

	it("rejects an entry outside the volume", async () => {
		const payload = buildPayload();
		const { archive, executable } = buildFixture(payload);
		executable.writeUInt32LE(0x100000, INDEX_OFFSET);
		await withCompanionFiles(
			"PP.X",
			{ "PP.X": archive, "seisen.exe": executable },
			async (mainPath) => {
				expect(
					await rareXFormat.detect(new BufferByteSource(archive), mainPath),
				).toBe(false);
			},
		);
	});
});
