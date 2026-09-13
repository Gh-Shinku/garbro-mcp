import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { ritsSafFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const RECORD5_SIZE = 0x20;
const RECORD6_SIZE = 16;
const NAME_FIELD = 0x14;
/** Payload offsets are stored in units of 0x800 bytes. */
const OFFSET_UNIT = 0x800;

type Record =
	| {
			kind: "file";
			name: string;
			payload: Buffer;
			/** Unpacked size; a non zero value marks a packed entry. */
			unpacked?: number;
	  }
	| { kind: "dir"; name: string; index: number; count: number };

function expand(records: readonly Record[]): {
	units: number[];
	payloads: Buffer[];
} {
	const units: number[] = [];
	const payloads: Buffer[] = [];
	let unit = 1;
	for (const record of records) {
		if (record.kind === "file") {
			units.push(unit);
			payloads.push(record.payload);
			unit += 1;
		} else {
			units.push(0);
		}
	}
	return { units, payloads };
}

/** Places payloads at absolute multiples of 0x800, as the record offsets require. */
function joinPayloads(payloads: readonly Buffer[], baseLength: number): Buffer {
	const chunks: Buffer[] = [];
	let current = baseLength;
	payloads.forEach((payload, index) => {
		const start = (index + 1) * OFFSET_UNIT;
		chunks.push(Buffer.alloc(Math.max(0, start - current)), payload);
		current = start + payload.length;
	});
	return Buffer.concat(chunks);
}

/** Lays out a Rits version 5 archive: a fixed size index and 0x800 aligned payloads. */
function buildSaf5(records: readonly Record[], id = 0x500): Buffer {
	const { units, payloads } = expand(records);
	const index = Buffer.alloc(records.length * RECORD5_SIZE);
	records.forEach((record, position) => {
		const base = position * RECORD5_SIZE;
		const name = encodeCp932(record.name);
		index.fill(0x20, base, base + NAME_FIELD);
		index.set(name.subarray(0, NAME_FIELD), base);
		if (record.kind === "dir") {
			index[base] = (index[base] ?? 0) | 0x80;
			index.writeInt32LE(record.index, base + 0x14);
			index.writeInt32LE(record.count, base + 0x1c);
		} else {
			index.writeUInt32LE(units[position] ?? 0, base + 0x14);
			index.writeUInt32LE(record.payload.length, base + 0x18);
			index.writeUInt32LE(record.unpacked ?? 0, base + 0x1c);
		}
	});
	if (id === 0x501) encryptCounting(index, 0x20, 0xdf);
	const header = Buffer.alloc(4);
	header.writeUInt16LE(id, 0);
	header.writeInt16LE(records.length, 2);
	return Buffer.concat([
		header,
		index,
		joinPayloads(payloads, header.length + index.length),
	]);
}

/** Lays out a Rits version 6 archive: a compact index plus a name blob. */
function buildSaf6(
	records: readonly Record[],
	id = 0x600,
	options?: { namesLength?: number },
): Buffer {
	const { units, payloads } = expand(records);
	const nameOffsets: number[] = [];
	const nameChunks: Buffer[] = [];
	let nameLength = 0;
	for (const record of records) {
		nameOffsets.push(nameLength);
		const chunk = Buffer.concat([encodeCp932(record.name), Buffer.from([0])]);
		nameChunks.push(chunk);
		nameLength += chunk.length;
	}
	const namesBlob = Buffer.concat(nameChunks, nameLength);
	const index = Buffer.alloc(records.length * RECORD6_SIZE);
	records.forEach((record, position) => {
		const base = position * RECORD6_SIZE;
		index.writeUInt32LE(
			((nameOffsets[position] ?? 0) |
				(record.kind === "dir" ? 0x80000000 : 0)) >>>
				0,
			base,
		);
		if (record.kind === "dir") {
			index.writeUInt32LE(record.index, base + 4);
			index.writeUInt32LE(record.count, base + 12);
		} else {
			index.writeUInt32LE(units[position] ?? 0, base + 4);
			index.writeUInt32LE(record.payload.length, base + 8);
			index.writeUInt32LE(record.unpacked ?? 0, base + 12);
		}
	});
	if ((id & 1) !== 0) {
		encryptCounting(index, 16, 0xef);
		encryptDescending(namesBlob);
	}
	const namesLength = options?.namesLength ?? namesBlob.length;
	const names = namesBlob.subarray(0, namesLength);
	const header = Buffer.alloc(8);
	header.writeUInt16LE(id, 0);
	header.writeInt16LE(records.length, 2);
	header.writeInt32LE(namesLength, 4);
	return Buffer.concat([
		header,
		index,
		names,
		joinPayloads(payloads, header.length + index.length + names.length),
	]);
}

/** The index obfuscation is its own inverse: a per record XOR with a counting key. */
function encryptCounting(
	data: Buffer,
	entrySize: number,
	startKey: number,
): void {
	let offset = 0;
	for (let record = 0; record * entrySize < data.length; record += 1) {
		let key = startKey;
		for (let i = 0; i < entrySize && offset < data.length; i += 1) {
			data[offset] = (data[offset] ?? 0) ^ key;
			offset += 1;
			key = (key + 1) & 0xff;
		}
	}
}

function encryptDescending(data: Buffer): void {
	let key = 0xff;
	for (let i = 0; i < data.length; i += 1) {
		data[i] = (data[i] ?? 0) ^ key;
		key = (key - 1) & 0xff;
	}
}

const flatPayload = Buffer.from("flat saf payload");
const subPayload = Buffer.from("nested saf payload");

describe("Rit's resource archive", () => {
	it("reads a flat version 5 index", async () => {
		const file = buildSaf5([
			{ kind: "file", name: "first.dat", payload: flatPayload },
			{ kind: "file", name: "second.dat", payload: subPayload },
		]);
		await expectArchive({
			format: ritsSafFormat,
			archive: file,
			entries: [
				{
					path: "first.dat",
					size: flatPayload.length,
					content: flatPayload,
				},
				{
					path: "second.dat",
					size: subPayload.length,
					content: subPayload,
				},
			],
			metadata: { entryCount: 2, lzss: false },
		});
	});

	it("reads a root directory tree", async () => {
		const file = buildSaf5([
			{ kind: "dir", name: "root", index: 1, count: 2 },
			{ kind: "file", name: "top.dat", payload: flatPayload },
			{ kind: "dir", name: "sub", index: 3, count: 1 },
			{ kind: "file", name: "deep.dat", payload: subPayload },
		]);
		const archive = await ritsSafFormat.open(
			new BufferByteSource(file),
			"game.saf",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"top.dat",
				"sub/deep.dat",
			]);
		} finally {
			await archive.close();
		}
	});

	it("keeps a non root directory name", async () => {
		const file = buildSaf5([
			{ kind: "dir", name: "data", index: 1, count: 1 },
			{ kind: "file", name: "top.dat", payload: flatPayload },
		]);
		const archive = await ritsSafFormat.open(
			new BufferByteSource(file),
			"game.saf",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"data/top.dat",
			]);
		} finally {
			await archive.close();
		}
	});

	it("trims padded names", async () => {
		const file = buildSaf5([
			{ kind: "file", name: "padded.dat", payload: flatPayload },
		]);
		const archive = await ritsSafFormat.open(
			new BufferByteSource(file),
			"game.saf",
		);
		try {
			expect(archive.entries[0]?.path).toBe("padded.dat");
		} finally {
			await archive.close();
		}
	});

	it("reads a version 6 index", async () => {
		const file = buildSaf6([
			{ kind: "file", name: "one.dat", payload: flatPayload },
			{ kind: "file", name: "two.dat", payload: subPayload },
		]);
		await expectArchive({
			format: ritsSafFormat,
			archive: file,
			entries: [
				{ path: "one.dat", size: flatPayload.length, content: flatPayload },
				{ path: "two.dat", size: subPayload.length, content: subPayload },
			],
		});
	});

	it("reads a version 6 directory tree", async () => {
		const file = buildSaf6([
			{ kind: "dir", name: "root", index: 1, count: 2 },
			{ kind: "file", name: "top.dat", payload: flatPayload },
			{ kind: "dir", name: "sub", index: 3, count: 1 },
			{ kind: "file", name: "deep.dat", payload: subPayload },
		]);
		const archive = await ritsSafFormat.open(
			new BufferByteSource(file),
			"game.saf",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"top.dat",
				"sub/deep.dat",
			]);
		} finally {
			await archive.close();
		}
	});

	it("decrypts an encrypted version 5 index", async () => {
		const file = buildSaf5(
			[{ kind: "file", name: "secret.dat", payload: flatPayload }],
			0x501,
		);
		await expectArchive({
			format: ritsSafFormat,
			archive: file,
			entries: [
				{ path: "secret.dat", size: flatPayload.length, content: flatPayload },
			],
		});
	});

	it("decrypts an encrypted version 6 index", async () => {
		const file = buildSaf6(
			[{ kind: "file", name: "secret.dat", payload: flatPayload }],
			0x601,
		);
		await expectArchive({
			format: ritsSafFormat,
			archive: file,
			entries: [
				{ path: "secret.dat", size: flatPayload.length, content: flatPayload },
			],
		});
	});

	it("unpacks zlib entries", async () => {
		const packed = deflateSync(flatPayload);
		const file = buildSaf5([
			{
				kind: "file",
				name: "packed.dat",
				payload: packed,
				unpacked: flatPayload.length,
			},
		]);
		await expectArchive({
			format: ritsSafFormat,
			archive: file,
			entries: [
				{ path: "packed.dat", size: packed.length, content: flatPayload },
			],
		});
	});

	it("unpacks lzss entries when the version bit is set", async () => {
		const packed = literalLzssStream(flatPayload);
		const file = buildSaf6(
			[
				{
					kind: "file",
					name: "packed.dat",
					payload: packed,
					unpacked: flatPayload.length,
				},
			],
			0x602,
		);
		await expectArchive({
			format: ritsSafFormat,
			archive: file,
			entries: [
				{ path: "packed.dat", size: packed.length, content: flatPayload },
			],
			metadata: { lzss: true },
		});
	});

	it("treats the lzss bit as a version flag", async () => {
		const packed = literalLzssStream(flatPayload);
		const file = buildSaf5(
			[
				{
					kind: "file",
					name: "packed.dat",
					payload: packed,
					unpacked: flatPayload.length,
				},
			],
			0x502,
		);
		const archive = await ritsSafFormat.open(
			new BufferByteSource(file),
			"game.saf",
		);
		try {
			expect(archive.metadata?.lzss).toBe(true);
		} finally {
			await archive.close();
		}
	});

	it("rejects an unknown version", async () => {
		const file = buildSaf5([
			{ kind: "file", name: "a.dat", payload: flatPayload },
		]);
		file.writeUInt16LE(0x700, 0);
		expect(
			await ritsSafFormat.detect(new BufferByteSource(file), "a.saf"),
		).toBe(false);
	});

	it("rejects an empty index", async () => {
		const file = buildSaf5([]);
		expect(
			await ritsSafFormat.detect(new BufferByteSource(file), "a.saf"),
		).toBe(false);
	});

	it("rejects a truncated version 5 index", async () => {
		const file = buildSaf5([
			{ kind: "file", name: "a.dat", payload: flatPayload },
			{ kind: "file", name: "b.dat", payload: subPayload },
		]).subarray(0, 0x24);
		expect(
			await ritsSafFormat.detect(new BufferByteSource(file), "a.saf"),
		).toBe(false);
	});

	it("rejects a payload outside the file", async () => {
		const file = buildSaf5([
			{ kind: "file", name: "a.dat", payload: flatPayload },
		]);
		file.writeUInt32LE(0x100, 4 + 0x14);
		expect(
			await ritsSafFormat.detect(new BufferByteSource(file), "a.saf"),
		).toBe(false);
	});

	it("rejects a directory cycle", async () => {
		// A subdirectory that points at itself is skipped, so nothing is left to list.
		const file = buildSaf5([
			{ kind: "dir", name: "root", index: 1, count: 1 },
			{ kind: "dir", name: "sub", index: 1, count: 1 },
		]);
		expect(
			await ritsSafFormat.detect(new BufferByteSource(file), "a.saf"),
		).toBe(false);
	});

	it("lists a root record that points at itself as a file", async () => {
		// Reading the root name clears its high bit, so the second visit sees a plain file record.
		const file = buildSaf5([{ kind: "dir", name: "root", index: 0, count: 1 }]);
		const archive = await ritsSafFormat.open(
			new BufferByteSource(file),
			"game.saf",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["root"]);
		} finally {
			await archive.close();
		}
	});

	it("rejects an empty name blob", async () => {
		const file = buildSaf6([
			{ kind: "file", name: "a.dat", payload: flatPayload },
		]);
		file.writeInt32LE(0, 4);
		expect(
			await ritsSafFormat.detect(new BufferByteSource(file), "a.saf"),
		).toBe(false);
	});

	it("rejects a name blob past the file", async () => {
		const file = buildSaf6([
			{ kind: "file", name: "a.dat", payload: flatPayload },
		]);
		file.writeInt32LE(0x1000, 4);
		expect(
			await ritsSafFormat.detect(new BufferByteSource(file), "a.saf"),
		).toBe(false);
	});
});
