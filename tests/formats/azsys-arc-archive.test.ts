import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { crc32 } from "@garbro-mcp/codecs";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	azArcFormat,
	copyOverlapped,
	readAzArcLayout,
	unpackAzAsbEntry,
	unpackAzIndex,
} from "../../packages/formats/src/azsys/arc-archive.js";

const HEAD_SIZE = 0x30;
const RECORD_SIZE = 0x40;
const CONTROL_AT = 0x14;

function packIndex(records: Buffer[], backs: boolean[] = []): Buffer {
	const output = Buffer.concat(records);
	const control: number[] = [];
	const one: number[] = [];
	const two: number[] = [];
	for (let i = 0; i < records.length; i += 1) {
		const body = records[i] ?? Buffer.alloc(0);
		const back = backs[i] ?? false;
		if (back) {
			control.push(i % 8 === 0 ? 0x80 : 0x80 >> (i % 8));
			const offset = 1;
			const length = body.length - 3;
			one.push(((length - 3) << 13) | (offset - 1));
		} else {
			control.push(0x00);
			two.push((body.length - 1) & 0xff);
			for (const byte of body) {
				two.push(byte);
			}
		}
	}
	const controlBytes = Buffer.alloc(Math.ceil(records.length / 8), 0x00);
	for (let i = 0; i < records.length; i += 1)
		controlBytes[i >> 3] =
			(controlBytes[i >> 3] ?? 0) | (backs[i] ? 0x80 >> (i % 8) : 0);
	void control;
	const oneBytes = Buffer.alloc(one.length * 2, 0x00);
	for (const [i, value] of one.entries()) {
		oneBytes.writeUInt16LE(value & 0xffff, i * 2);
	}
	const packed = Buffer.concat([
		Buffer.alloc(CONTROL_AT, 0x00),
		controlBytes,
		oneBytes,
		Buffer.from(two),
	]);
	packed.writeInt32LE(controlBytes.length, 4);
	packed.writeInt32LE(oneBytes.length, 8);
	packed.writeInt32LE(two.length, 0x0c);
	packed.writeInt32LE(output.length, 0x10);
	packed.writeUInt32LE(crc32(packed.subarray(CONTROL_AT)), 0);
	return packed;
}

function record(
	offset: number,
	size: number,
	name: string,
	nameSize = 0x30,
): Buffer {
	const out = Buffer.alloc(RECORD_SIZE, 0x00);
	out.writeUInt32LE(offset, 0);
	out.writeUInt32LE(size, 4);
	Buffer.from(name, "latin1").copy(
		out,
		0x10,
		0,
		Math.min(name.length, nameSize - 1),
	);
	return out;
}

function buildArchive(entries: { name: string; body: Buffer }[]): Buffer {
	const records = entries.map((entry, i) =>
		record(
			entries.slice(0, i).reduce((sum, one) => sum + one.body.length, 0),
			entry.body.length,
			entry.name,
		),
	);
	const index = packIndex(records);
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("ARC\x1a", 0, "latin1");
	head.writeInt32LE(1, 4);
	head.writeInt32LE(entries.length, 8);
	head.writeUInt32LE(index.length, 0x0c);
	return Buffer.concat([head, index, ...entries.map((entry) => entry.body)]);
}

describe("AZ system resource archive", () => {
	it("copies a range and repeats it when source and target overlap", () => {
		const out = Buffer.alloc(9, 0x00);
		Buffer.from("abc", "latin1").copy(out, 0);
		copyOverlapped(out, 0, 3, 6);
		expect(out.toString("latin1")).toBe("abcabcabc");
		// A literal run of 0x20 bytes followed by four back references of eight bytes each at offset 0x20: every copy
		const plain = Buffer.alloc(4, 0x00);
		Buffer.from("wxyz", "latin1").copy(plain, 0);
		copyOverlapped(plain, 0, 2, 2);
		expect(plain.toString("latin1")).toBe("wxwx");
	});

	it("unpacks an index built entirely from literal runs", () => {
		const first = record(0x100, 0x10, "one.dat");
		const packed = packIndex([first]);
		const index = unpackAzIndex(packed, 1);
		if (!index) throw new Error("no index");
		expect(index.length).toBe(RECORD_SIZE);
		expect(index.readUInt32LE(0)).toBe(0x100);
		expect(index.readUInt32LE(4)).toBe(0x10);
		expect(index.subarray(0x10, 0x18).toString("latin1")).toBe("one.dat\u0000");
	});

	it("unpacks an index that mixes literals with back references", () => {
		// reads the literal that was just written.
		const literal = Buffer.alloc(0x20, 0x00);
		for (let i = 0; i < literal.length; i += 1) literal[i] = (0x41 + i) & 0xff;
		const backs: number[] = [];
		for (let i = 0; i < 4; i += 1) backs.push(((8 - 3) << 13) | (0x20 - 1));
		const backBytes = Buffer.alloc(backs.length * 2, 0x00);
		for (const [i, value] of backs.entries()) {
			backBytes.writeUInt16LE(value & 0xffff, i * 2);
		}
		const packed = Buffer.concat([
			Buffer.alloc(CONTROL_AT, 0x00),
			Buffer.from([0x78]),
			backBytes,
			Buffer.concat([Buffer.from([literal.length - 1]), literal]),
		]);
		packed.writeInt32LE(1, 4);
		packed.writeInt32LE(backBytes.length, 8);
		packed.writeInt32LE(literal.length + 1, 0x0c);
		packed.writeInt32LE(RECORD_SIZE, 0x10);
		packed.writeUInt32LE(crc32(packed.subarray(CONTROL_AT)), 0);
		const index = unpackAzIndex(packed, 1);
		if (!index) throw new Error("no index");
		expect(index.subarray(0, 0x20).equals(literal)).toBe(true);
		expect(index.subarray(0x20, 0x40).equals(literal.subarray(0, 0x20))).toBe(
			true,
		);
	});

	it("walks the head and the records", () => {
		const formed = buildArchive([
			{ name: "one.dat", body: Buffer.from("hello", "latin1") },
			{ name: "two.asb", body: Buffer.from("world!", "latin1") },
		]);
		const layout = readAzArcLayout(formed);
		if (!layout) throw new Error("no layout");
		expect(layout.entries.length).toBe(2);
		expect(layout.entries[0]?.path).toBe("one.dat");
		expect(layout.entries[0]?.offset).toBeGreaterThan(HEAD_SIZE);
		expect(layout.entries[0]?.size).toBe(5);
		expect(layout.entries[1]?.path).toBe("two.asb");
		expect(layout.entries[1]?.asb).toBe(true);
		expect(layout.containsScripts).toBe(true);
	});

	it("rejects a truncated head, a bad magic and a mismatched index checksum", () => {
		expect(readAzArcLayout(Buffer.alloc(HEAD_SIZE, 0x00))).toBeUndefined();
		expect(readAzArcLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
		const formed = buildArchive([
			{ name: "one.dat", body: Buffer.from("hello", "latin1") },
		]);
		const broken = Buffer.from(formed);
		broken.writeUInt32LE(0xdeadbeef, HEAD_SIZE);
		expect(() => readAzArcLayout(broken)).toThrow(GarbroError);
	});

	it("decrypts an ASB entry when a key is supplied", async () => {
		const asbKey = 0x12345678;
		const payload = Buffer.from("script body", "latin1");
		// zlib level 9 emits the `78 DA` header, which is exactly the entry's 0x10 marker seen through the key.
		const compressed = deflateSync(payload, { level: 9 });
		const body = Buffer.alloc(4 + compressed.length, 0x00);
		body.writeUInt32LE(crc32(compressed), 0);
		compressed.copy(body, 4);
		const unpacked = 0x40;
		let key = (asbKey ^ unpacked) >>> 0;
		key = (key ^ (((key << 12) | key) << 11)) >>> 0;
		const entryBody = Buffer.alloc(12 + body.length, 0x00);
		entryBody.write("ASB\x1a", 0, "latin1");
		entryBody.writeUInt32LE(body.length, 4);
		entryBody.writeUInt32LE(unpacked, 8);
		body.copy(entryBody, 12);
		for (let at = 0; at + 4 <= (body.length & ~3); at += 4)
			entryBody.writeUInt32LE((body.readUInt32LE(at) + key) >>> 0, 12 + at);
		const formed = buildArchive([{ name: "one.asb", body: entryBody }]);
		const layout = readAzArcLayout(formed);
		if (!layout) throw new Error("no layout");
		expect(
			await unpackAzAsbEntry(formed, layout.entries[0] as never, 0),
		).toBeUndefined();
		const unpackedBody = await unpackAzAsbEntry(
			formed,
			layout.entries[0] as never,
			asbKey,
		);
		expect(unpackedBody?.toString("latin1")).toBe("script body");
	});

	it("detects and extracts through the registered format", async () => {
		const formed = buildArchive([
			{ name: "one.dat", body: Buffer.from("hello", "latin1") },
		]);
		const archive = await azArcFormat.open(
			new BufferByteSource(formed),
			"data.arc",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("one.dat");
		expect(
			(await consumeBuffer(await archive.openEntry(entry.id))).toString(
				"latin1",
			),
		).toBe("hello");
		await expect(
			azArcFormat.detect(new BufferByteSource(formed)),
		).resolves.toBe(true);
		await expect(
			azArcFormat.detect(new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x33))),
		).resolves.toBe(false);
		await expect(
			azArcFormat.open(
				new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x33)),
				"data.arc",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
