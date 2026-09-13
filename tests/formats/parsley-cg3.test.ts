import {
	BufferByteSource,
	FileByteSource,
	type ArchiveFormat,
} from "@garbro-mcp/core";
import { parsleyDesertCgFormat } from "@garbro-mcp/formats";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { expectCompanionArchive } from "../helpers/companion.js";

const IMAGE_BASE = 0x400000;
const NAME_TABLE_ADDRESS = 0x49e348;
const NAME_ENTRY_SIZE = 0x104;
const SECTION_RVA = 0x9e000;
const SECTION_RAW = 0x400;
const SECTION_SIZE = 0x1000;
/** Payloads start behind the padded index table. */
const INDEX_PADDING = 0x10;

interface CgSpec {
	name: string;
	payload: Buffer;
}

/**
 * Builds the `CG` archive: an offset table followed by the payloads. The reference requires the
 * first payload to start behind the table, so the index is padded.
 */
function buildArchive(specs: readonly CgSpec[]): Buffer {
	const tableSize = 4 + 4 * specs.length;
	const payloads: Buffer[] = [];
	const offsets: number[] = [];
	let offset = tableSize + INDEX_PADDING;
	for (const spec of specs) {
		offsets.push(offset);
		payloads.push(spec.payload);
		offset += spec.payload.length;
	}
	const header = Buffer.alloc(tableSize + INDEX_PADDING);
	header.writeInt32LE(specs.length, 0);
	for (const [id, value] of offsets.entries())
		header.writeUInt32LE(value, 4 + id * 4);
	return Buffer.concat([header, ...payloads]);
}

/**
 * A 32-bit executable whose only section maps the name table address 0x49E348 to file offset 0x748.
 * GARbro reads the table relative to the archive directory, so the file is called `..\DTime.exe`.
 */
function buildExecutable(names: readonly string[], magic = 0x010b): Buffer {
	const tableOffset =
		SECTION_RAW + (NAME_TABLE_ADDRESS - IMAGE_BASE - SECTION_RVA);
	const stub = Buffer.alloc(SECTION_RAW + SECTION_SIZE, 0);
	stub.write("MZ", 0, "ascii");
	stub.writeUInt32LE(0x40, 0x3c);
	stub.write("PE\0\0", 0x40, "binary");
	stub.writeUInt16LE(1, 0x40 + 6);
	stub.writeUInt16LE(0xe0, 0x40 + 0x14);
	stub.writeUInt16LE(magic, 0x40 + 0x18);
	stub.writeUInt32LE(IMAGE_BASE, 0x40 + 0x18 + 0x1c);
	const section = 0x40 + 0xe0 + 0x18;
	stub.writeUInt32LE(SECTION_RVA, section + 0x0c);
	stub.writeUInt32LE(SECTION_SIZE, section + 0x10);
	stub.writeUInt32LE(SECTION_RAW, section + 0x14);
	for (const [id, name] of names.entries())
		stub.write(name, tableOffset + id * NAME_ENTRY_SIZE, "latin1");
	return stub;
}

/** Runs the callback inside a temporary game directory that holds the `CG` archive. */
async function withGameDirectory(
	archive: Buffer,
	build: (mainPath: string, directory: string) => Promise<void>,
	options?: { executable?: Buffer; subdirectory?: boolean },
): Promise<void> {
	const directory = await mkdtemp(resolve(tmpdir(), "garbro-parsley-"));
	try {
		const gameDirectory =
			options?.subdirectory === false ? directory : resolve(directory, "game");
		if (options?.subdirectory !== false) await mkdir(gameDirectory);
		await writeFile(resolve(gameDirectory, "CG"), archive);
		if (options?.executable)
			await writeFile(resolve(directory, "DTime.exe"), options.executable);
		await build(resolve(gameDirectory, "CG"), gameDirectory);
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
}

async function listEntries(
	format: ArchiveFormat,
	mainPath: string,
): Promise<{ path: string; size: bigint }[]> {
	const source = await FileByteSource.open(mainPath);
	try {
		const archive = await format.open(source, mainPath);
		try {
			return archive.entries.map((entry) => ({
				path: entry.path,
				size: entry.size,
			}));
		} finally {
			await archive.close();
		}
	} finally {
		await source.close();
	}
}

describe("Software House Parsley CG archive", () => {
	it("reads names from the game executable", async () => {
		const first = Buffer.from("first image");
		const second = Buffer.from("second image data");
		const archive = buildArchive([
			{ name: "first.png", payload: first },
			{ name: "second.png", payload: second },
		]);
		await withGameDirectory(
			archive,
			async (mainPath) => {
				await expectCompanionArchive({
					format: parsleyDesertCgFormat,
					mainPath,
					entries: [
						{ path: "first.png", size: first.length, content: first },
						{ path: "second.png", size: second.length, content: second },
					],
					metadata: { entryCount: 2 },
				});
			},
			{ executable: buildExecutable(["first.png", "second.png"]) },
		);
	});

	it("falls back to generated names without the executable", async () => {
		const payload = Buffer.from("only image");
		await withGameDirectory(
			buildArchive([{ name: "", payload }]),
			async (mainPath) => {
				expect(await listEntries(parsleyDesertCgFormat, mainPath)).toEqual([
					{ path: "CG#0000", size: BigInt(payload.length) },
				]);
			},
		);
	});

	it("falls back to generated names for a 64-bit image", async () => {
		const payload = Buffer.from("only image");
		await withGameDirectory(
			buildArchive([{ name: "", payload }]),
			async (mainPath) => {
				expect(await listEntries(parsleyDesertCgFormat, mainPath)).toEqual([
					{ path: "CG#0000", size: BigInt(payload.length) },
				]);
			},
			{ executable: buildExecutable(["ignored.png"], 0x020b) },
		);
	});

	it("accepts a lower case archive name", async () => {
		const payload = Buffer.from("payload");
		expect(
			await parsleyDesertCgFormat.detect(
				new BufferByteSource(buildArchive([{ name: "", payload }])),
				"/game/cg",
			),
		).toBe(true);
	});

	it("sizes the last entry to the end of the file", async () => {
		const first = Buffer.from("first image");
		const second = Buffer.from("second image data");
		const archive = buildArchive([
			{ name: "", payload: first },
			{ name: "", payload: second },
		]);
		await withGameDirectory(archive, async (mainPath) => {
			expect(await listEntries(parsleyDesertCgFormat, mainPath)).toEqual([
				{ path: "CG#0000", size: BigInt(first.length) },
				{ path: "CG#0001", size: BigInt(second.length) },
			]);
		});
	});

	it("stops at the first zero offset", async () => {
		const first = Buffer.from("first image");
		const second = Buffer.from("second image data");
		const archive = buildArchive([
			{ name: "", payload: first },
			{ name: "", payload: second },
		]);
		archive.writeUInt32LE(0, 4 + 4);
		await withGameDirectory(archive, async (mainPath) => {
			// The last listed entry absorbs everything behind it, as in the reference.
			expect(await listEntries(parsleyDesertCgFormat, mainPath)).toEqual([
				{ path: "CG#0000", size: BigInt(first.length + second.length) },
			]);
		});
	});

	it("rejects an offset that does not advance", async () => {
		const archive = buildArchive([
			{ name: "", payload: Buffer.from("first image") },
			{ name: "", payload: Buffer.from("second image data") },
		]);
		archive.writeUInt32LE(8, 4 + 4);
		await withGameDirectory(archive, async (mainPath) => {
			const source = await FileByteSource.open(mainPath);
			try {
				expect(await parsleyDesertCgFormat.detect(source, mainPath)).toBe(
					false,
				);
			} finally {
				await source.close();
			}
		});
	});

	it("rejects a file with a different name", async () => {
		const file = buildArchive([{ name: "", payload: Buffer.from("payload") }]);
		expect(
			await parsleyDesertCgFormat.detect(
				new BufferByteSource(file),
				"/game/CGA",
			),
		).toBe(false);
	});

	it("rejects an empty file", async () => {
		expect(
			await parsleyDesertCgFormat.detect(
				new BufferByteSource(Buffer.alloc(0)),
				"/game/CG",
			),
		).toBe(false);
	});
});
