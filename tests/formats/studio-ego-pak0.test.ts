import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { studioEgoPak0Format } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x10;
const DIR_RECORD_SIZE = 8;
const FILE_RECORD_SIZE = 0x10;
const SCRIPT_DATA_OFFSET = 0x14;

/** Builds the key sequence of a script payload, one word at a time. */
function scriptKeys(method: number, key: number, count: number): number[] {
	const keys: number[] = [];
	for (let i = 0; i < count; i += 1) {
		if ((i & 0xff) === 0) key = method === 1 ? (key === 0 ? 1 : 0) : ~key >>> 0;
		key = (key + 0x7654321) >>> 0;
		keys.push(key);
	}
	return keys;
}

/** Builds a script payload that decrypts to the given words under the chosen method. */
function buildScript(
	method: number,
	version: number,
	key: number,
	words: readonly number[],
): Buffer {
	const payload = Buffer.alloc(SCRIPT_DATA_OFFSET + words.length * 4, 0x11);
	payload.write("SCR ", 0, "latin1");
	payload.writeUInt32LE(version, 4);
	payload.writeUInt32LE(method, 8);
	payload.writeUInt32LE(key, 0xc);
	payload.writeInt32LE(words.length * 4, 0x10);
	const keys = scriptKeys(method, key, words.length);
	for (const [i, word] of words.entries())
		payload.writeUInt32LE(
			(word ^ (keys[i] ?? 0)) >>> 0,
			SCRIPT_DATA_OFFSET + i * 4,
		);
	return payload;
}

interface DirSpec {
	parent: number;
	lastIndex: number;
	name?: string;
}

interface FileSpec {
	name: string;
	payload: Buffer;
}

function encodeName(name: string): Buffer {
	const bytes = Buffer.from(encodeCp932(name));
	return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}

function buildPak0(
	dirs: readonly DirSpec[],
	files: readonly FileSpec[],
): Buffer {
	const recordsSize =
		HEADER_SIZE +
		dirs.length * DIR_RECORD_SIZE +
		files.length * FILE_RECORD_SIZE;
	const names: Buffer[] = [];
	for (const dir of dirs)
		if (dir.parent !== -1) names.push(encodeName(dir.name ?? ""));
	for (const file of files) names.push(encodeName(file.name));
	const nameBlock = Buffer.concat(names);
	const dataOffset = recordsSize + nameBlock.length;
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("PAK0", 0, "latin1");
	header.writeUInt32LE(dataOffset, 4);
	header.writeInt32LE(dirs.length, 8);
	header.writeInt32LE(files.length, 0xc);
	const dirBlock = Buffer.alloc(dirs.length * DIR_RECORD_SIZE);
	for (const [i, dir] of dirs.entries()) {
		dirBlock.writeInt32LE(dir.parent, i * DIR_RECORD_SIZE);
		dirBlock.writeInt32LE(dir.lastIndex, i * DIR_RECORD_SIZE + 4);
	}
	const fileBlock = Buffer.alloc(files.length * FILE_RECORD_SIZE);
	let cursor = dataOffset;
	const payloads: Buffer[] = [];
	for (const [i, file] of files.entries()) {
		fileBlock.writeUInt32LE(cursor, i * FILE_RECORD_SIZE);
		fileBlock.writeUInt32LE(file.payload.length, i * FILE_RECORD_SIZE + 4);
		payloads.push(file.payload);
		cursor += file.payload.length;
	}
	return Buffer.concat([header, dirBlock, fileBlock, nameBlock, ...payloads]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	const source = new BufferByteSource(file);
	expect(await studioEgoPak0Format.detect(source, "sample.dat")).toBe(false);
}

describe("Studio e.go! resource archive", () => {
	it("lists files of a flat archive", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: studioEgoPak0Format,
			sourcePath: "sample.dat",
			archive: buildPak0(
				[{ parent: -1, lastIndex: 2 }],
				[
					{ name: "a.txt", payload: first },
					{ name: "b.txt", payload: second },
				],
			),
			entries: [
				{ path: "a.txt", size: first.length, content: first },
				{ path: "b.txt", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("builds nested directory paths from the parent chain", async () => {
		const first = Buffer.from("root");
		const second = Buffer.from("sub");
		const third = Buffer.from("deep");
		await expectArchive({
			format: studioEgoPak0Format,
			sourcePath: "sample.dat",
			archive: buildPak0(
				[
					{ parent: -1, lastIndex: 1 },
					{ parent: 0, lastIndex: 2, name: "sub" },
					{ parent: 1, lastIndex: 3, name: "deep" },
				],
				[
					{ name: "a.txt", payload: first },
					{ name: "b.txt", payload: second },
					{ name: "c.txt", payload: third },
				],
			),
			entries: [
				{ path: "a.txt", size: first.length, content: first },
				{ path: "sub/b.txt", size: second.length, content: second },
				{ path: "sub/deep/c.txt", size: third.length, content: third },
			],
		});
	});

	it("decrypts a script with the first method", async () => {
		const words = [0x12345678, 0x9abcdef0, 0x0f0f0f0f];
		const payload = buildScript(1, 1, 0, words);
		const expected = Buffer.from(payload);
		for (const [i, word] of words.entries())
			expected.writeUInt32LE(word >>> 0, SCRIPT_DATA_OFFSET + i * 4);
		await expectArchive({
			format: studioEgoPak0Format,
			sourcePath: "sample.dat",
			archive: buildPak0(
				[{ parent: -1, lastIndex: 1 }],
				[{ name: "script.scr", payload }],
			),
			entries: [
				{ path: "script.scr", size: payload.length, content: expected },
			],
		});
	});

	it("decrypts a script with the second method", async () => {
		const words = [0x11223344, 0x55667788, 0x99aabbcc, 0xddeeff00];
		const payload = buildScript(2, 7, 0xdeadbeef, words);
		const expected = Buffer.from(payload);
		for (const [i, word] of words.entries())
			expected.writeUInt32LE(word >>> 0, SCRIPT_DATA_OFFSET + i * 4);
		await expectArchive({
			format: studioEgoPak0Format,
			sourcePath: "sample.dat",
			archive: buildPak0(
				[{ parent: -1, lastIndex: 1 }],
				[{ name: "script.scr", payload }],
			),
			entries: [
				{ path: "script.scr", size: payload.length, content: expected },
			],
		});
	});

	it("leaves a script alone when its version is zero", async () => {
		const words = [0x11111111, 0x22222222, 0x33333333];
		const payload = buildScript(1, 0, 1, words);
		await expectArchive({
			format: studioEgoPak0Format,
			sourcePath: "sample.dat",
			archive: buildPak0(
				[{ parent: -1, lastIndex: 1 }],
				[{ name: "script.scr", payload }],
			),
			entries: [{ path: "script.scr", size: payload.length, content: payload }],
		});
	});

	it("leaves a script alone when its method is unknown", async () => {
		const words = [0x11111111, 0x22222222, 0x33333333];
		const payload = buildScript(3, 1, 1, words);
		await expectArchive({
			format: studioEgoPak0Format,
			sourcePath: "sample.dat",
			archive: buildPak0(
				[{ parent: -1, lastIndex: 1 }],
				[{ name: "script.scr", payload }],
			),
			entries: [{ path: "script.scr", size: payload.length, content: payload }],
		});
	});

	it("rejects a directory that is its own parent", async () => {
		await expectDeclined(
			buildPak0(
				[{ parent: 0, lastIndex: 1 }],
				[{ name: "a.txt", payload: Buffer.from("x") }],
			),
		);
	});

	it("rejects a directory whose parent is out of range", async () => {
		await expectDeclined(
			buildPak0(
				[{ parent: 5, lastIndex: 1 }],
				[{ name: "a.txt", payload: Buffer.from("x") }],
			),
		);
	});

	it("rejects a data offset inside the header", async () => {
		const file = buildPak0(
			[{ parent: -1, lastIndex: 1 }],
			[{ name: "a.txt", payload: Buffer.from("x") }],
		);
		file.writeUInt32LE(0x10, 4);
		await expectDeclined(file);
	});

	it("rejects a file without the format signature", async () => {
		const file = buildPak0(
			[{ parent: -1, lastIndex: 1 }],
			[{ name: "a.txt", payload: Buffer.from("x") }],
		);
		file.write("NOPE", 0, "latin1");
		await expectDeclined(file);
	});
});
