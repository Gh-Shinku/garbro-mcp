import { FileByteSource } from "@garbro-mcp/core";
import { detFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";

const SMALL_RECORD_SIZE = 0x10;
const LARGE_RECORD_SIZE = 0x14;
const HISTORY_MASK = 0xff;

/** Writes the RLE stream the reference decodes, keeping the same sliding history. */
class RleWriter {
	readonly #output: number[] = [];
	readonly #history = Buffer.alloc(0x100);
	#position = 0;

	literal(value: number): this {
		this.#output.push(value === 0xff ? 0xff : value);
		if (value === 0xff) this.#output.push(0xff);
		this.#push(value);
		return this;
	}

	bytes(values: Buffer): this {
		for (const value of values) this.literal(value);
		return this;
	}

	/** Copies three to six bytes from one to sixty four bytes behind the current position. */
	copy(distance: number, count: number): this {
		this.#output.push(0xff, ((distance - 1) << 2) | (count - 3));
		for (let step = 0; step < count; step += 1)
			this.#push(
				this.#history[(this.#position - distance + step) & HISTORY_MASK] ?? 0,
			);
		return this;
	}

	#push(value: number): void {
		this.#history[this.#position++ & HISTORY_MASK] = value;
	}

	toBuffer(): Buffer {
		return Buffer.from(this.#output);
	}
}

interface RecordSpec {
	name: string;
	requested: Buffer;
	stored: Buffer;
	unpackedSize?: number;
}

/** Builds a name file and an index for the given records. */
function buildCompanions(
	records: readonly RecordSpec[],
	recordSize = LARGE_RECORD_SIZE,
): { names: Buffer; index: Buffer } {
	const names: number[] = [];
	const index = Buffer.alloc(records.length * recordSize);
	let offset = 0;
	for (const [id, record] of records.entries()) {
		const position = id * recordSize;
		const nameOffset = names.length;
		for (const byte of Buffer.from(record.name, "latin1")) names.push(byte);
		names.push(0);
		index.writeInt32LE(nameOffset, position);
		index.writeUInt32LE(offset, position + 4);
		index.writeUInt32LE(record.stored.length, position + 8);
		if (recordSize >= LARGE_RECORD_SIZE)
			index.writeUInt32LE(
				record.unpackedSize ?? record.requested.length,
				position + 0x10,
			);
		offset += record.stored.length;
	}
	return { names: Buffer.from(names), index };
}

/** Runs the archive through detection, listing and extraction with its companions in place. */
async function withArchive(
	archive: Buffer,
	companions: { names: Buffer; index: Buffer },
	extension: "atm" | "at2",
	run: (mainPath: string) => Promise<void>,
): Promise<void> {
	await withCompanionFiles(
		"archive.det",
		{
			"archive.det": archive,
			"archive.nme": companions.names,
			[`archive.${extension}`]: companions.index,
		},
		run,
	);
}

describe("μ-GameOperationSystem DET resource archive", () => {
	it("lists entries from its companion index", async () => {
		const first = new RleWriter()
			.bytes(Buffer.from("first payload!"))
			.toBuffer();
		const second = new RleWriter().bytes(Buffer.from("second")).toBuffer();
		const companions = buildCompanions([
			{
				name: "first.dat",
				requested: Buffer.from("first payload!"),
				stored: first,
			},
			{ name: "second.dat", requested: Buffer.from("second"), stored: second },
		]);
		await withArchive(
			Buffer.concat([first, second]),
			companions,
			"atm",
			async (mainPath) => {
				await expectCompanionArchive({
					format: detFormat,
					mainPath,
					entries: [
						{
							path: "first.dat",
							size: 14,
							content: Buffer.from("first payload!"),
						},
						{ path: "second.dat", size: 6, content: Buffer.from("second") },
					],
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("decodes a copy command from the sliding history", async () => {
		const plain = Buffer.from("ABCDABCD");
		const stored = new RleWriter()
			.bytes(Buffer.from("ABCD"))
			.copy(4, 4)
			.toBuffer();
		// A single compact record has no unpacked size, so the entry is listed with its stored length and
		// decoded to the end of its stream.
		const companions = buildCompanions(
			[{ name: "framed.bmp.txt", requested: plain, stored }],
			SMALL_RECORD_SIZE,
		);
		await withArchive(stored, companions, "atm", async (mainPath) => {
			await expectCompanionArchive({
				format: detFormat,
				mainPath,
				entries: [
					{ path: "framed.bmp.txt", size: stored.length, content: plain },
				],
			});
		});
	});

	it("decodes an escaped literal byte", async () => {
		const plain = Buffer.from([0x41, 0xff, 0x42, 0xff, 0xff, 0x43]);
		const stored = new RleWriter().bytes(plain).toBuffer();
		const companions = buildCompanions(
			[{ name: "escaped.dat", requested: plain, stored }],
			SMALL_RECORD_SIZE,
		);
		await withArchive(stored, companions, "atm", async (mainPath) => {
			await expectCompanionArchive({
				format: detFormat,
				mainPath,
				entries: [{ path: "escaped.dat", size: stored.length, content: plain }],
			});
		});
	});

	it("decodes a compact index to the end of its stream", async () => {
		const plain = Buffer.from("compact payload");
		const stored = new RleWriter().bytes(plain).toBuffer();
		const companions = buildCompanions(
			[{ name: "compact.dat", requested: plain, stored }],
			SMALL_RECORD_SIZE,
		);
		await withArchive(stored, companions, "atm", async (mainPath) => {
			await expectCompanionArchive({
				format: detFormat,
				mainPath,
				entries: [{ path: "compact.dat", size: stored.length, content: plain }],
			});
			const source = await FileByteSource.open(mainPath);
			const archive = await detFormat.open(source, mainPath);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			await archive.close();
		});
	});

	it("retries the compact index with the larger record size", async () => {
		const plain = Buffer.from("retried payload bytes");
		const stored = new RleWriter().bytes(plain).toBuffer();
		const second = new RleWriter().bytes(Buffer.from("xyz")).toBuffer();
		// Read as compact records, the second record starts in the middle of the first one, so its name
		// offset is the first record's unpacked size. Keeping the name file shorter than that size makes the
		// compact read fail and the reader retry with the larger records.
		const companions = buildCompanions([
			{ name: "a", requested: plain, stored },
			{ name: "b", requested: Buffer.from("xyz"), stored: second },
		]);
		expect(companions.names.length).toBeLessThan(plain.length);
		await withArchive(
			Buffer.concat([stored, second]),
			companions,
			"atm",
			async (mainPath) => {
				await expectCompanionArchive({
					format: detFormat,
					mainPath,
					entries: [
						{ path: "a", size: plain.length, content: plain },
						{ path: "b", size: 3, content: Buffer.from("xyz") },
					],
				});
			},
		);
	});

	it("marks an image name with the image type", async () => {
		const plain = Buffer.from("image bytes");
		const stored = new RleWriter().bytes(plain).toBuffer();
		const companions = buildCompanions([
			{ name: "still.bmp.txt", requested: plain, stored },
			{ name: "script.dat", requested: plain, stored },
		]);
		await withArchive(
			Buffer.concat([stored, stored]),
			companions,
			"atm",
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				const archive = await detFormat.open(source, mainPath);
				expect(archive.entries.map((entry) => entry.metadata?.type)).toEqual([
					"image",
					"data",
				]);
				await archive.close();
			},
		);
	});

	it("rejects a corrupt atm companion even when an at2 file exists", async () => {
		const plain = Buffer.from("large index payload");
		const stored = new RleWriter().bytes(plain).toBuffer();
		const companions = buildCompanions([
			{ name: "large.dat", requested: plain, stored },
		]);
		await withCompanionFiles(
			"archive.det",
			{
				"archive.det": stored,
				"archive.nme": companions.names,
				"archive.atm": Buffer.alloc(2),
				"archive.at2": companions.index,
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await detFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});

	it("rejects a file without the archive extension", async () => {
		const companions = buildCompanions([
			{
				name: "first.dat",
				requested: Buffer.from("x"),
				stored: Buffer.from("x"),
			},
		]);
		await withCompanionFiles(
			"archive.dat",
			{
				"archive.dat": Buffer.from("x"),
				"archive.nme": companions.names,
				"archive.atm": companions.index,
			},
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await detFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});

	it("rejects an archive without a name file", async () => {
		const companions = buildCompanions([
			{
				name: "first.dat",
				requested: Buffer.from("x"),
				stored: Buffer.from("x"),
			},
		]);
		await withCompanionFiles(
			"archive.det",
			{ "archive.det": Buffer.from("x"), "archive.atm": companions.index },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await detFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});

	it("rejects a name offset behind the name file", async () => {
		const plain = Buffer.from("payload");
		const stored = new RleWriter().bytes(plain).toBuffer();
		const companions = buildCompanions([
			{ name: "first.dat", requested: plain, stored },
		]);
		const index = Buffer.from(companions.index);
		index.writeInt32LE(0x1000, 0);
		await withArchive(
			stored,
			{ names: companions.names, index },
			"atm",
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await detFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});

	it("rejects an entry that leaves the archive", async () => {
		const plain = Buffer.from("payload");
		const stored = new RleWriter().bytes(plain).toBuffer();
		const companions = buildCompanions([
			{ name: "first.dat", requested: plain, stored },
		]);
		const index = Buffer.from(companions.index);
		index.writeUInt32LE(0x1000, 8);
		await withArchive(
			stored,
			{ names: companions.names, index },
			"atm",
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await detFormat.detect(source, mainPath)).toBe(false);
			},
		);
	});
});
