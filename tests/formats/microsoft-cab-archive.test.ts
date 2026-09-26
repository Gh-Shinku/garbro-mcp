// The cabinet format of Microsoft, against cabinets built in the test: a head that names the count of the
// folders and of the files, the optional room another program reserved and the names of the cabinets on
// either side of this one, the table of folders, the table of files and their names, and the blocks of every
// folder. Both kinds of compression the reader reads are built here — the raw bytes of one that is not
// compressed at all, and the deflate of MSZIP, whose blocks hand the window of the bytes before them to the
// reader of the block behind them. The blocks are written with the same deflate the reader unfolds them
// with, which is what the format itself prescribes; what is under test here is the walk of the cabinet
// around them, down to the window a block of MSZIP is handed.
import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { microsoftCabArchiveFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateRawSync, inflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEAD_SIZE = 36;
const FOLDER_RECORD_SIZE = 8;
const FILE_RECORD_SIZE = 16;
const BLOCK_SIZE = 0x8000;
const COMPRESSION_NONE = 0;
const COMPRESSION_MSZIP = 1;
const COMPRESSION_LZX = 3;
const MSZIP_SIGNATURE = Buffer.from("CK", "latin1");
const CONTINUED = 0xffffffff;

interface CabinetFile {
	name: string;
	data: Buffer;
	folder?: number;
	/** The length written into the record, when it is to be another one than the length of the data. */
	declared?: number;
	/** The place written into the record, when the file is to stand elsewhere in its folder. */
	offset?: number;
}

interface CabinetFolder {
	compression: number;
	blockSize?: number;
}

/** The blocks of one folder, as the format writes them: a head, then the bytes of the block. */
function folderBlocks(folder: CabinetFolder, content: Buffer): Buffer {
	const blockSize = folder.blockSize ?? BLOCK_SIZE;
	const parts: Buffer[] = [];
	let history: Buffer = Buffer.alloc(0);
	for (let at = 0; at < content.length; at += blockSize) {
		const raw = content.subarray(at, Math.min(at + blockSize, content.length));
		let stored: Buffer;
		if (COMPRESSION_MSZIP === folder.compression) {
			stored = Buffer.concat([
				MSZIP_SIGNATURE,
				deflateRawSync(
					raw,
					0 === history.length ? {} : { dictionary: history },
				),
			]);
			const soFar = Buffer.concat([history, raw]);
			history =
				soFar.length > BLOCK_SIZE
					? Buffer.from(soFar.subarray(soFar.length - BLOCK_SIZE))
					: soFar;
		} else {
			stored = Buffer.from(raw);
		}
		const head = Buffer.alloc(8);
		head.writeUInt32LE(0, 0);
		head.writeUInt16LE(stored.length, 4);
		head.writeUInt16LE(raw.length, 6);
		parts.push(head, stored);
	}
	return Buffer.concat(parts);
}

function stringLength(text: string): number {
	return Buffer.byteLength(text, "latin1") + 1;
}

/** Builds a cabinet of the folders and files a test asks for. */
function buildCab(input: {
	folders: CabinetFolder[];
	files: CabinetFile[];
	reserve?: number;
	previous?: readonly [string, string];
	next?: readonly [string, string];
	version?: readonly [number, number];
	cabinet?: number;
}): Buffer {
	const folderCount = input.folders.length;
	const files = input.files;
	// The contents of every folder: the data of its own files, one behind the other, in file order.
	const contents: Buffer[] = input.folders.map(() => Buffer.alloc(0));
	const offsets: number[] = files.map(() => 0);
	for (const [index, file] of files.entries()) {
		const folder = file.folder ?? 0;
		offsets[index] = contents[folder]?.length ?? 0;
		contents[folder] = Buffer.concat([
			contents[folder] ?? Buffer.alloc(0),
			file.data,
		]);
	}
	const blocks = input.folders.map((folder, index) =>
		folderBlocks(folder, contents[index] ?? Buffer.alloc(0)),
	);
	const flags =
		(undefined === input.reserve ? 0 : 0x0004) |
		(undefined === input.previous ? 0 : 0x0001) |
		(undefined === input.next ? 0 : 0x0002);
	let table = HEAD_SIZE;
	if (undefined !== input.reserve) table += 4 + input.reserve;
	if (input.previous) {
		table += stringLength(input.previous[0]) + stringLength(input.previous[1]);
	}
	if (input.next) {
		table += stringLength(input.next[0]) + stringLength(input.next[1]);
	}
	const folderTableAt = table;
	const fileTableAt = folderTableAt + FOLDER_RECORD_SIZE * folderCount;
	// The name of a file stands behind the record of it, so the table walks record by record.
	let place = fileTableAt;
	const recordAt: number[] = [];
	const nameAt: number[] = [];
	for (const file of files) {
		recordAt.push(place);
		place += FILE_RECORD_SIZE;
		nameAt.push(place);
		place += stringLength(file.name);
	}
	const dataAt = place;
	const starts: number[] = [];
	let blockAt = dataAt;
	for (const folder of blocks) {
		starts.push(blockAt);
		blockAt += folder.length;
	}
	const cabinet = Buffer.alloc(blockAt);
	cabinet.write("MSCF", 0, "latin1");
	cabinet.writeUInt32LE(cabinet.length, 8);
	cabinet.writeUInt32LE(fileTableAt, 16);
	const [major, minor] = input.version ?? [1, 3];
	cabinet[24] = minor;
	cabinet[25] = major;
	cabinet.writeUInt16LE(folderCount, 26);
	cabinet.writeUInt16LE(files.length, 28);
	cabinet.writeUInt16LE(flags, 30);
	cabinet.writeUInt16LE(1, 32);
	cabinet.writeUInt16LE(input.cabinet ?? 0, 34);
	let at = HEAD_SIZE;
	if (undefined !== input.reserve) {
		cabinet.writeUInt16LE(input.reserve, at);
		at += 4 + input.reserve;
	}
	for (const name of [input.previous, input.next]) {
		if (!name) continue;
		for (const text of name) {
			cabinet.write(text, at, "latin1");
			at += stringLength(text);
		}
	}
	for (const [index, folder] of input.folders.entries()) {
		cabinet.writeUInt32LE(starts[index] ?? 0, at);
		const count = blocks[index] ?? Buffer.alloc(0);
		// The count of blocks: every block head stands at the front of its own block.
		let blockCount = 0;
		let walkAt = 0;
		while (walkAt < count.length) {
			blockCount += 1;
			walkAt += 8 + count.readUInt16LE(walkAt + 4);
		}
		cabinet.writeUInt16LE(blockCount, at + 4);
		cabinet.writeUInt16LE(folder.compression, at + 6);
		at += FOLDER_RECORD_SIZE;
	}
	for (const [index, file] of files.entries()) {
		const record = recordAt[index] ?? 0;
		cabinet.writeUInt32LE(file.declared ?? file.data.length, record);
		cabinet.writeUInt32LE(file.offset ?? offsets[index] ?? 0, record + 4);
		cabinet.writeUInt16LE(file.folder ?? 0, record + 8);
		cabinet.write(file.name, nameAt[index] ?? 0, "latin1");
	}
	for (const [index, folder] of blocks.entries()) {
		folder.copy(cabinet, starts[index] ?? 0);
	}
	return cabinet;
}

/** The content of a folder of places that repeat, so a block of MSZIP reaches back into the one before it. */
function repeatingPlaces(seed: number, length: number): Buffer {
	const data = Buffer.alloc(length);
	let value = seed;
	for (let at = 0; at < length; at += 1) {
		value = (value * 1103515245 + 12345) & 0x7fffffff;
		data[at] = (value >> 16) & 0xff;
	}
	return data;
}

describe("Microsoft cabinet archive", () => {
	it("lists and extracts the files of a folder that is not compressed at all", async () => {
		const first = Buffer.from("the first file of the cabinet", "latin1");
		const second = repeatingPlaces(7, 0x1234);
		const cabinet = buildCab({
			folders: [{ compression: COMPRESSION_NONE }],
			files: [
				{ name: "first.txt", data: first },
				{ name: "sub\\dir\\second.bin", data: second },
			],
		});
		await expectArchive({
			format: microsoftCabArchiveFormat,
			archive: cabinet,
			entries: [
				{ path: "first.txt", size: first.length, content: first },
				{
					path: "sub/dir/second.bin",
					size: second.length,
					content: second,
				},
			],
			metadata: {
				versionMajor: 1,
				versionMinor: 3,
				cabinet: 0,
				folders: 1,
				length: cabinet.length,
			},
		});
		const archive = await microsoftCabArchiveFormat.open(
			new BufferByteSource(cabinet),
			"sample.cab",
		);
		// The name of the file stands of the separators of the system it was written on, and both readings
		// of it are handed over.
		expect(archive.entries[1]?.rawPath).toBe("sub\\dir\\second.bin");
		expect(archive.entries[0]?.rawPath).toBeUndefined();
		await archive.close();
	});

	it("unfolds the blocks of MSZIP against the window of the blocks before them", async () => {
		// The second block stands of the very places of the first one, so the deflate of it reaches back into
		// the window the block before it left behind, and a reader that hands over no window cannot read it.
		const block = repeatingPlaces(11, BLOCK_SIZE);
		const content = Buffer.concat([block, block]);
		const cabinet = buildCab({
			folders: [{ compression: COMPRESSION_MSZIP }],
			files: [{ name: "both.bin", data: content }],
		});
		// The bytes of the second block of the folder, as they stand behind its own head.
		const firstHead =
			HEAD_SIZE +
			FOLDER_RECORD_SIZE +
			FILE_RECORD_SIZE +
			stringLength("both.bin");
		const firstLength = cabinet.readUInt16LE(firstHead + 4);
		const secondHead = firstHead + 8 + firstLength;
		const secondLength = cabinet.readUInt16LE(secondHead + 4);
		const second = cabinet.subarray(
			secondHead + 8 + MSZIP_SIGNATURE.length,
			secondHead + 8 + secondLength,
		);
		expect(() => inflateRawSync(second)).toThrow();
		await expectArchive({
			format: microsoftCabArchiveFormat,
			archive: cabinet,
			entries: [{ path: "both.bin", size: content.length, content }],
			metadata: { folders: 1 },
		});
	});

	it("unfolds the blocks of MSZIP of a cabinet of two folders", async () => {
		const plain = Buffer.from("of no compression at all", "latin1");
		const pressed = repeatingPlaces(23, 0x2345);
		const cabinet = buildCab({
			folders: [
				{ compression: COMPRESSION_NONE },
				{ compression: COMPRESSION_MSZIP, blockSize: 0x100 },
			],
			files: [
				{ name: "plain.txt", data: plain, folder: 0 },
				{ name: "pressed.bin", data: pressed, folder: 1 },
			],
		});
		await expectArchive({
			format: microsoftCabArchiveFormat,
			archive: cabinet,
			entries: [
				{ path: "plain.txt", size: plain.length, content: plain },
				{ path: "pressed.bin", size: pressed.length, content: pressed },
			],
		});
	});

	it("reads a cabinet of a reserved room and of the names of its neighbours", async () => {
		const data = Buffer.from("of a cabinet of a set", "latin1");
		const cabinet = buildCab({
			folders: [{ compression: COMPRESSION_NONE }],
			files: [{ name: "one.bin", data }],
			reserve: 8,
			previous: ["prev.cab", "prev disk"],
			next: ["next.cab", "next disk"],
			version: [2, 1],
			cabinet: 1,
		});
		await expectArchive({
			format: microsoftCabArchiveFormat,
			archive: cabinet,
			entries: [{ path: "one.bin", size: data.length, content: data }],
			metadata: { versionMajor: 2, versionMinor: 1, cabinet: 1 },
		});
	});

	it("hands over the part of a file that continues into the cabinet behind it", async () => {
		const head = Buffer.from("the head of a file of two cabinets", "latin1");
		const rest = Buffer.from("the rest of it", "latin1");
		const cabinet = buildCab({
			folders: [{ compression: COMPRESSION_NONE }],
			files: [
				{
					name: "long.bin",
					data: Buffer.concat([head, rest]),
					declared: CONTINUED,
				},
			],
		});
		const archive = await microsoftCabArchiveFormat.open(
			new BufferByteSource(cabinet),
			"sample.cab",
		);
		const entry = archive.entries[0];
		expect(entry).toMatchObject({
			path: "long.bin",
			sizeKnown: false,
			metadata: { continued: true, folder: 0, folderOffset: 0 },
		});
		const content = await consumeBuffer(await archive.openEntry("0"));
		expect(content.equals(Buffer.concat([head, rest]))).toBe(true);
		await archive.close();
	});

	it("turns away a folder of a compression this reader does not read", async () => {
		const data = repeatingPlaces(31, 0x1000);
		const cabinet = buildCab({
			folders: [{ compression: COMPRESSION_LZX }],
			files: [{ name: "pressed.bin", data }],
		});
		// The cabinet is still read and its file is still listed; it is the extraction that is turned away.
		await expectArchive({
			format: microsoftCabArchiveFormat,
			archive: cabinet,
			entries: [{ path: "pressed.bin", size: data.length }],
		});
		const archive = await microsoftCabArchiveFormat.open(
			new BufferByteSource(cabinet),
			"sample.cab",
		);
		await expect(archive.openEntry("0")).rejects.toMatchObject({
			code: "UNSUPPORTED_FEATURE",
		});
		await archive.close();
	});

	it("turns away a block that stands of no words of its own", async () => {
		const data = repeatingPlaces(37, 0x800);
		const cabinet = buildCab({
			folders: [{ compression: COMPRESSION_MSZIP }],
			files: [{ name: "pressed.bin", data }],
		});
		const blockAt =
			HEAD_SIZE +
			FOLDER_RECORD_SIZE +
			FILE_RECORD_SIZE +
			stringLength("pressed.bin") +
			8;
		cabinet[blockAt] = 0x41;
		const archive = await microsoftCabArchiveFormat.open(
			new BufferByteSource(cabinet),
			"sample.cab",
		);
		await expect(archive.openEntry("0")).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
		await archive.close();
	});

	it("turns away a block that unfolds to a length it does not name", async () => {
		const data = repeatingPlaces(41, 0x800);
		const cabinet = buildCab({
			folders: [{ compression: COMPRESSION_MSZIP }],
			files: [{ name: "pressed.bin", data }],
		});
		const headAt =
			HEAD_SIZE +
			FOLDER_RECORD_SIZE +
			FILE_RECORD_SIZE +
			stringLength("pressed.bin");
		cabinet.writeUInt16LE(cabinet.readUInt16LE(headAt + 6) + 1, headAt + 6);
		const archive = await microsoftCabArchiveFormat.open(
			new BufferByteSource(cabinet),
			"sample.cab",
		);
		await expect(archive.openEntry("0")).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
		await archive.close();
	});

	it("turns away a file that stands outside the folder of the cabinet", async () => {
		const data = Buffer.from("short", "latin1");
		const cabinet = buildCab({
			folders: [{ compression: COMPRESSION_NONE }],
			files: [{ name: "one.bin", data, offset: 0x100 }],
		});
		const archive = await microsoftCabArchiveFormat.open(
			new BufferByteSource(cabinet),
			"sample.cab",
		);
		await expect(archive.openEntry("0")).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
		await archive.close();
	});

	it("does not read a stream that is no cabinet", async () => {
		const source = new BufferByteSource(
			Buffer.concat([Buffer.from("MSCF", "latin1"), Buffer.alloc(8)]),
		);
		expect(await microsoftCabArchiveFormat.detect(source, "sample.cab")).toBe(
			false,
		);
		const plain = new BufferByteSource(Buffer.alloc(0x40, 0x41));
		expect(await microsoftCabArchiveFormat.detect(plain, "sample.bin")).toBe(
			false,
		);
	});
});
