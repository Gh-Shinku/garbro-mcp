import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { flyingShinePd2Format } from "../../packages/formats/src/flying-shine/pd2.js";

const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x30;
const KEY = 0x5a;

interface Pd2Record {
	name: string;
	/** The stored payload, or the plaintext when `script` is set. */
	data: Buffer;
	script?: boolean;
}

/** Builds an archive whose index records are masked with a single byte key. */
function buildPd2(
	records: Pd2Record[],
	options: { key?: number; shift?: number; trailing?: number } = {},
): Buffer {
	const key = options.key ?? KEY;
	const shift = options.shift ?? 0;
	const trailing = options.trailing ?? 0;
	let position = INDEX_OFFSET + records.length * RECORD_SIZE;
	const layout = records.map((record) => {
		const offset = position;
		position += record.data.length + trailing;
		return { offset, size: record.data.length };
	});
	const file = Buffer.alloc(position);
	file.write("Flyi", 0, "latin1");
	file.write("ngShinePDFile\0", 4, "latin1");
	file.writeUInt8(key, 0x14);
	file.writeInt32LE(records.length, 0x1c);
	records.forEach((record, index) => {
		const at = INDEX_OFFSET + index * RECORD_SIZE;
		const recordBytes = Buffer.alloc(RECORD_SIZE);
		recordBytes.write(record.name, 0, "latin1");
		recordBytes.writeUInt32LE(shift, 0x24);
		recordBytes.writeUInt32LE(
			((layout[index]?.offset ?? 0) + shift) >>> 0,
			0x28,
		);
		// The size field stores the size plus the shift, not the end offset.
		recordBytes.writeUInt32LE(((layout[index]?.size ?? 0) + shift) >>> 0, 0x2c);
		for (let i = 0; i < RECORD_SIZE; i += 1)
			file[at + i] = (recordBytes[i] ?? 0) ^ key;
		const payload = record.data;
		for (let i = 0; i < payload.length; i += 1)
			file[(layout[index]?.offset ?? 0) + i] = payload[i] ?? 0;
	});
	return file;
}

/** The script codec derives its key from the trailing bytes, so the plaintext ends with 0x0D 0x0A. */
function storedScript(body: string, key: number): Buffer {
	const plain = Buffer.concat([
		Buffer.from(body, "latin1"),
		Buffer.from([0x0d, 0x0a]),
	]);
	return Buffer.from(plain.map((value) => value ^ key));
}

function oggHeader(): Buffer {
	const header = Buffer.alloc(0x23);
	header.write("OggS", 0, "latin1");
	header[0x1b] = 0x1e;
	header[0x1c] = 0x01;
	header.write("vorbis", 0x1d, "latin1");
	return header;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("flying-shine pd2", () => {
	it("lists entries and extracts them", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload, longer than the first one");
		const file = buildPd2([
			{ name: "IMAGE.PNG", data: first },
			{ name: "DATA.BIN", data: second },
		]);
		const source = sourceOf(file);
		expect(await flyingShinePd2Format.detect(source)).toBe(true);
		const archive = await flyingShinePd2Format.open(source, "game.pd");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"IMAGE.PNG",
				"DATA.BIN",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				first.length,
				second.length,
			]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				first,
			);
		} finally {
			await archive.close();
		}
	});

	it("decodes a keyed script payload", async () => {
		const body = Buffer.from("script body of the entry");
		const stored = storedScript("script body of the entry", KEY);
		const file = buildPd2([{ name: "MAIN.DEF", data: stored, script: true }]);
		const source = sourceOf(file);
		const archive = await flyingShinePd2Format.open(source, "game.pd");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(true);
			// The decoded payload keeps the two trailer bytes the key was derived from.
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.concat([body, Buffer.from([0x0d, 0x0a])]),
			);
		} finally {
			await archive.close();
		}
	});

	it("patches the page flag of an ogg entry", async () => {
		const header = oggHeader();
		const body = Buffer.from("ogg page body");
		const file = buildPd2([
			{ name: "BGM.OGG", data: Buffer.concat([header, body]) },
		]);
		const source = sourceOf(file);
		const archive = await flyingShinePd2Format.open(source, "game.pd");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(header.length + body.length);
			expect(output[0x1a]).toBe(1);
			expect(output.subarray(0x1d, 0x23).toString("latin1")).toBe("vorbis");
			expect(output.subarray(header.length)).toEqual(body);
		} finally {
			await archive.close();
		}
	});

	it("applies the stored shift to offsets and sizes", async () => {
		const data = Buffer.from("shifted payload");
		const file = buildPd2([{ name: "SHIFT.BIN", data }], { shift: 0x40 });
		const source = sourceOf(file);
		const archive = await flyingShinePd2Format.open(source, "game.pd");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the format marker", async () => {
		const file = buildPd2([{ name: "A.BIN", data: Buffer.from("x") }]);
		file.write("NopeShinePDFile\0", 4, "latin1");
		expect(await flyingShinePd2Format.detect(sourceOf(file))).toBe(false);
	});

	it("declines a name outside the field", async () => {
		const file = buildPd2([{ name: "A.BIN", data: Buffer.from("x") }]);
		// A record whose name has no terminator inside the name field.
		for (let i = 0; i < 0x24; i += 1) file[INDEX_OFFSET + i] = 0x41 ^ KEY;
		expect(await flyingShinePd2Format.detect(sourceOf(file))).toBe(false);
	});

	it("declines an index that does not fit in the file", async () => {
		const file = buildPd2([{ name: "A.BIN", data: Buffer.from("x") }]);
		file.writeInt32LE(0x1000, 0x1c);
		expect(await flyingShinePd2Format.detect(sourceOf(file))).toBe(false);
	});

	it("declines an entry outside the file", async () => {
		const file = buildPd2([{ name: "A.BIN", data: Buffer.from("payload") }]);
		file.writeUInt32LE(0x1000, INDEX_OFFSET + 0x28);
		expect(await flyingShinePd2Format.detect(sourceOf(file))).toBe(false);
	});
});
