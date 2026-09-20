import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { Isaac64 } from "@garbro-mcp/codecs";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	azIsaacArchiveFormat,
	decryptAsb,
	parseAzIndex,
	readAzIsaacLayout,
	unpackAzIsaacEntry,
} from "../../packages/formats/src/azsys/isaac-archive.js";

const HEAD_SIZE = 0x30;
const KEY_WORDS = 0x100;
const KEY_XOR = 0x1000193;
const ARC_MARK = "ARC\0";

function rotateLeft(value: number, count: number): number {
	const at = count & 0x1f;
	return ((value << at) | (value >>> (32 - at))) >>> 0;
}

function applyCipher(data: Buffer, seed: number, offset: number): Buffer {
	const isaac = new Isaac64(seed);
	const key = new Uint32Array(KEY_WORDS);
	for (let i = 0; i < KEY_WORDS; i += 1) key[i] = isaac.nextUint32();
	const out = Buffer.from(data);
	for (let i = 0; i < out.length; i += 1) {
		const at = (offset + i) & 0xffff;
		const word = ((key[at & 0xff] ?? 0) ^ KEY_XOR) >>> 0;
		out[i] = (out[i] ?? 0) ^ (rotateLeft(word, at >> 8) & 0xff);
	}
	return out;
}

function buildArchive(entries: { name: string; body: Buffer }[]): Buffer {
	let relative = 0;
	const index = Buffer.alloc(entries.length * 0x30, 0x00);
	entries.forEach((entry, i) => {
		index.writeUInt32LE(relative, i * 0x30);
		index.writeUInt32LE(entry.body.length, i * 0x30 + 4);
		index.writeUInt32LE(0, i * 0x30 + 8);
		index.writeInt32LE(0, i * 0x30 + 0x0c);
		Buffer.from(entry.name, "latin1").copy(index, i * 0x30 + 0x10);
		relative += entry.body.length;
	});
	const compressed = deflateSync(index);
	const totalLength = HEAD_SIZE + compressed.length + relative;
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write(ARC_MARK, 0, "latin1");
	head.writeInt32LE(1, 4);
	head.writeInt32LE(entries.length, 8);
	head.writeUInt32LE(compressed.length, 0x0c);
	return Buffer.concat([
		applyCipher(head, totalLength, 0),
		applyCipher(compressed, totalLength, HEAD_SIZE),
		...entries.map((entry) => applyCipher(entry.body, entry.body.length, 0)),
	]);
}

describe("AZ system encrypted resource archive (ISAAC)", () => {
	it("stands the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the places of the picture of the walk of the places of the picture", () => {
		const first = new Isaac64(0);
		const second = new Isaac64(0);
		const values = Array.from({ length: 300 }, () => first.nextUint32());
		expect(values.every((value) => value === second.nextUint32())).toBe(true);
		expect(values.length).toBe(300);
		const other = new Isaac64(1);
		expect(other.nextUint32()).not.toBe(values[0]);
	});

	it("stands the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture", () => {
		const key = (0x01020304 ^ 0x9e370001) >>> 0;
		const word = (0x55555555 + key) >>> 0;
		const copy = Buffer.alloc(0x20, 0x00);
		copy.writeInt32LE(0x10, 4);
		copy.writeUInt32LE(0x01020304, 8);
		for (let at = 0x10; at < 0x20; at += 4) copy.writeUInt32LE(word, at);
		expect(decryptAsb(copy)).toBe(true);
		for (let at = 0x10; at < 0x20; at += 4)
			expect(copy.readUInt32LE(at)).toBe(0x55555555);
		expect(decryptAsb(Buffer.alloc(8, 0x00))).toBe(false);
		expect(decryptAsb(Buffer.alloc(0x20, 0x00))).toBe(false);
	});

	it("reads the places of the picture of the walk of the places of the picture of the words of the walk of them of the places of the picture of the walk of the places of the picture", () => {
		const index = Buffer.alloc(2 * 0x30, 0x00);
		index.writeUInt32LE(0x10, 0);
		index.writeUInt32LE(0x20, 4);
		Buffer.from("one.dat", "latin1").copy(index, 0x10);
		index.writeUInt32LE(0x30, 0x30);
		index.writeUInt32LE(0x40, 0x30 + 4);
		Buffer.from("two.dat", "latin1").copy(index, 0x30 + 0x10);
		const entries = parseAzIndex(index, 2, 0x100, 0x1000);
		if (!entries) throw new Error("no entries");
		expect(entries[0]).toEqual({ path: "one.dat", offset: 0x110, size: 0x20 });
		expect(entries[1]).toEqual({ path: "two.dat", offset: 0x130, size: 0x40 });
		expect(parseAzIndex(Buffer.alloc(4, 0x00), 1, 0, 0x10)).toBeUndefined();
	});

	it("reads the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of a picture of this kind", async () => {
		const payload = Buffer.from("plain bytes here", "latin1");
		const formed = buildArchive([
			{ name: "one.dat", body: payload },
			{ name: "two.dat", body: Buffer.from("second", "latin1") },
		]);
		const layout = await readAzIsaacLayout(formed);
		if (!layout) throw new Error("no layout");
		expect(layout.entries.length).toBe(2);
		expect(layout.entries[0]?.path).toBe("one.dat");
		expect(
			(await unpackAzIsaacEntry(formed, layout.entries[0] as never)).toString(
				"latin1",
			),
		).toBe("plain bytes here");
	});

	it("turns away the places of the picture of the walk of the places of the picture of the words of the walk of the picture that stand of no places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them of the engine", async () => {
		expect(
			await readAzIsaacLayout(Buffer.alloc(HEAD_SIZE, 0x00)),
		).toBeUndefined();
		expect(await readAzIsaacLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
		expect(azIsaacArchiveFormat.descriptor.id).toBe("azsys-isaac-archive");
		await expect(
			azIsaacArchiveFormat.detect(
				new BufferByteSource(Buffer.alloc(0x80, 0x11)),
			),
		).resolves.toBe(false);
		await expect(
			azIsaacArchiveFormat.open(
				new BufferByteSource(Buffer.alloc(0x80, 0x11)),
				"data.arc",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});

	it("stands the places of the picture of the walk of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture out", async () => {
		const formed = buildArchive([
			{ name: "one.dat", body: Buffer.from("hi", "latin1") },
		]);
		const archive = await azIsaacArchiveFormat.open(
			new BufferByteSource(formed),
			"data.arc",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("one.dat");
		const packed = await consumeBuffer(await archive.openEntry(entry.id));
		expect(packed.toString("latin1")).toBe("hi");
		await expect(
			azIsaacArchiveFormat.detect(new BufferByteSource(formed)),
		).resolves.toBe(true);
	});
});
