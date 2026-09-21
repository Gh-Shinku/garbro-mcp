import { Buffer } from "node:buffer";
import { FileByteSource, GarbroError } from "@garbro-mcp/core";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	digitalWorksBinPacFormat,
	findBinScheme,
	parseBinIndex,
} from "../../packages/formats/src/digitalworks/bin-pac.js";
import {
	exeAddressOffset,
	exeCString,
	readExeFile,
} from "../../packages/formats/src/microsoft/exe-file.js";

/** The head of the executable, and the places its own header, its optional header and its section stand. */
const PE_OFFSET = 0x80;
const OPTIONAL_SIZE = 0xe0;
const SECTION_TABLE = PE_OFFSET + OPTIONAL_SIZE + 0x18;
const DATA_RAW_OFFSET = 0x200;
const DATA_RAW_SIZE = 0x400;
const DATA_VIRTUAL_ADDRESS = 0x1000;
const IMAGE_BASE = 0x400000;
/** One entry of the index, and the mark the index is found by. */
const ENTRY_SIZE = 12;
const MARK_SIZE = 12;

interface FixtureEntry {
	offset: number;
	size: number;
	id: number;
	packed?: boolean;
}

/**
 * A thirty-two-bit executable with one `.data` section: the entries of an index, the mark that names the
 * archive's size twice over, and a name standing at a virtual address of its own.
 */
function buildExe(archiveSize: number, entries: FixtureEntry[]): Buffer {
	const exe = Buffer.alloc(DATA_RAW_OFFSET + DATA_RAW_SIZE, 0x00);
	exe.write("MZ", 0, "latin1");
	exe.writeUInt32LE(PE_OFFSET, 0x3c);
	exe.write("PE\0\0", PE_OFFSET, "latin1");
	exe.writeUInt16LE(1, PE_OFFSET + 6);
	exe.writeUInt16LE(OPTIONAL_SIZE, PE_OFFSET + 0x14);
	exe.writeUInt16LE(0x010b, PE_OFFSET + 0x18);
	exe.writeUInt32LE(IMAGE_BASE, PE_OFFSET + 0x18 + 0x1c);
	exe.writeUInt32LE(DATA_RAW_OFFSET, PE_OFFSET + 0x54);
	exe.write(".data\0\0\0", SECTION_TABLE, "latin1");
	exe.writeUInt32LE(DATA_RAW_SIZE, SECTION_TABLE + 0x08);
	exe.writeUInt32LE(DATA_VIRTUAL_ADDRESS, SECTION_TABLE + 0x0c);
	exe.writeUInt32LE(DATA_RAW_SIZE, SECTION_TABLE + 0x10);
	exe.writeUInt32LE(DATA_RAW_OFFSET, SECTION_TABLE + 0x14);
	exe.writeUInt32LE(0x40000040, SECTION_TABLE + 0x24);
	// The index is walked backwards from the mark towards the head, and every entry must stand before the one
	// read before it, so the entries rise in offset with their own places in the file.
	const body = Buffer.alloc(DATA_RAW_SIZE, 0x00);
	const ordered = [...entries].sort(
		(left, right) => left.offset - right.offset,
	);
	const entriesSize = ordered.length * ENTRY_SIZE;
	// The mark stands immediately behind the entries, since the walk reads backwards from it.
	const markAt = entriesSize;
	body.writeUInt32LE(archiveSize, markAt);
	body.writeUInt32LE(archiveSize, markAt + 4);
	let at = 0;
	for (const entry of ordered) {
		body.writeUInt32LE(entry.offset, at);
		body.writeUInt32LE(entry.size, at + 4);
		body.writeUInt16LE(entry.packed ? 1 : 0, at + 8);
		body.writeUInt16LE(entry.id, at + 10);
		at += ENTRY_SIZE;
	}
	// A name of its own stands at the far end, so a virtual address can be read back from it.
	body.write("HERO.BIN\0", DATA_RAW_SIZE - 16, "latin1");
	body.copy(exe, DATA_RAW_OFFSET);
	return exe;
}

/** Three entries of an archive of 0x300 bytes, the first of them packed. */
const ENTRIES: FixtureEntry[] = [
	{ offset: 0x200, size: 0x100, id: 1, packed: true },
	{ offset: 0x100, size: 0x100, id: 2 },
	{ offset: 0x000, size: 0x100, id: 3 },
];
const ARCHIVE_SIZE = 0x300;

describe("Digital Works resource archive", () => {
	it("reads the header and the sections of an executable", () => {
		const exe = readExeFile(buildExe(ARCHIVE_SIZE, ENTRIES));
		expect(exe).toBeDefined();
		if (!exe) return;
		expect(exe.win16).toBe(false);
		expect(exe.sections.get(".data")).toEqual({
			offset: DATA_RAW_OFFSET,
			size: DATA_RAW_SIZE,
		});
		expect(exe.imageSections).toHaveLength(1);
		expect(exe.imageBase).toBe(IMAGE_BASE);
		// The overlay begins behind the last section, rounded up to sixteen bytes.
		expect(exe.overlay.offset).toBe(DATA_RAW_OFFSET + DATA_RAW_SIZE);
		// A name stands at a virtual address of its own, and the section it stands in is read to find it.
		expect(
			exeCString(exe, IMAGE_BASE + DATA_VIRTUAL_ADDRESS + DATA_RAW_SIZE - 16),
		).toBe("HERO.BIN");
		expect(exeAddressOffset(exe, IMAGE_BASE + DATA_VIRTUAL_ADDRESS)).toBe(
			DATA_RAW_OFFSET,
		);
	});

	it("walks an index backwards from the mark of the archive's own size", () => {
		const exe = readExeFile(buildExe(ARCHIVE_SIZE, ENTRIES));
		expect(exe).toBeDefined();
		if (!exe) return;
		const scheme = findBinScheme(exe, ARCHIVE_SIZE, "hero.pac");
		expect(scheme).toMatchObject({ size: ARCHIVE_SIZE, extension: "" });
		expect(scheme?.index).toEqual([
			{ offset: 0x200, size: 0x100, packed: true, id: 1 },
			{ offset: 0x100, size: 0x100, packed: false, id: 2 },
			{ offset: 0x000, size: 0x100, packed: false, id: 3 },
		]);
		// The extension comes from the name of the archive, as the reference's own table gives it.
		expect(findBinScheme(exe, ARCHIVE_SIZE, "STR.bin")?.extension).toBe("OGG");
		expect(findBinScheme(exe, ARCHIVE_SIZE, "MOV.pac")?.extension).toBe("MPG");
		// A mark whose own size is nothing ends the walk at once, so the index comes back empty.
		expect(
			parseBinIndex(
				exe.data,
				{ offset: DATA_RAW_OFFSET, size: DATA_RAW_SIZE },
				MARK_SIZE,
				"hero.pac",
			),
		).toMatchObject({ index: [] });
	});

	it("turns away an executable whose header is not one", () => {
		const notAnExe = Buffer.alloc(0x100, 0x00);
		notAnExe.write("ZM", 0, "latin1");
		expect(readExeFile(notAnExe)).toBeUndefined();
		const noSections = Buffer.from(buildExe(ARCHIVE_SIZE, ENTRIES));
		noSections.write("XXXX", SECTION_TABLE, "latin1");
		const exe = readExeFile(noSections);
		expect(exe?.sections.has(".data")).toBe(false);
		expect(exe && findBinScheme(exe, ARCHIVE_SIZE, "hero.pac")).toBeUndefined();
	});

	it("reads an archive whose index the executable beside it holds", async () => {
		const root = await mkdtemp(join(tmpdir(), "binpac-"));
		try {
			const gameDir = join(root, "game");
			const dataDir = join(gameDir, "data");
			await mkdir(dataDir, { recursive: true });
			// The archive stands below the executable's own directory, as the reference looks for it.
			const archivePath = join(dataDir, "hero.pac");
			const archive = Buffer.alloc(ARCHIVE_SIZE, 0x00);
			for (const entry of ENTRIES) {
				for (let at = 0; at < entry.size; at += 1) {
					archive[entry.offset + at] = (entry.id + at) & 0xff;
				}
			}
			await writeFile(archivePath, archive);
			await writeFile(
				join(gameDir, "hero.exe"),
				buildExe(ARCHIVE_SIZE, ENTRIES),
			);
			expect(
				await digitalWorksBinPacFormat.detect(
					await FileByteSource.open(resolve(archivePath)),
					archivePath,
				),
			).toBe(true);
			const handle = await digitalWorksBinPacFormat.open(
				await FileByteSource.open(resolve(archivePath)),
				archivePath,
			);
			// The extension comes from the reference's own table of archive names, which knows the name
			// "HERO" not - so the name it writes carries a dot and nothing behind it.
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"hero00001.",
				"hero00002.",
				"hero00003.",
			]);
			const first = handle.entries[0];
			if (!first) throw new Error("no entry");
			const out = await consumeBuffer(await handle.openEntry(first.id));
			expect(out.length).toBe(0x100);
			expect(out[0]).toBe(1);
			expect(out[1]).toBe(2);
			// The archive's bytes stand in it as they are.
			expect(out).toEqual(archive.subarray(0x200, 0x300));
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});

	it("turns away an archive whose executable is not beside it", async () => {
		const root = await mkdtemp(join(tmpdir(), "binpac-none-"));
		try {
			const dataDir = join(root, "game", "data");
			await mkdir(dataDir, { recursive: true });
			const archivePath = join(dataDir, "lonely.bin");
			await writeFile(archivePath, Buffer.alloc(0x40, 0x00));
			await expect(
				digitalWorksBinPacFormat.open(
					await FileByteSource.open(resolve(archivePath)),
					archivePath,
				),
			).rejects.toThrow(GarbroError);
			expect(
				await digitalWorksBinPacFormat.detect(
					await FileByteSource.open(resolve(archivePath)),
					archivePath,
				),
			).toBe(false);
			// A name the engine's archives never carry is turned away before anything is read.
			expect(
				await digitalWorksBinPacFormat.detect(
					await FileByteSource.open(resolve(archivePath)),
					join(dataDir, "lonely.dat"),
				),
			).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
