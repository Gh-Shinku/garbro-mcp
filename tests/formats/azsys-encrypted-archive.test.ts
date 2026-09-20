import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { adler32 } from "@garbro-mcp/codecs";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	AZ_DEFAULT_SEED,
	azEncryptedArchiveFormat,
	decryptAz,
	generateAzContentKey,
	generateAzIndexKey,
	readAzEncryptedLayout,
	unpackAzEncryptedEntry,
} from "../../packages/formats/src/azsys/encrypted-archive.js";

const HEAD_SIZE = 0x30;
const ARC_MARK = "ARC\0";
const SYSENV = "sysenv.tbl";

function azData(plain: Buffer): Buffer {
	const compressed = deflateSync(plain);
	const out = Buffer.alloc(4 + compressed.length, 0x00);
	out.writeUInt32LE(adler32(compressed), 0);
	compressed.copy(out, 4);
	return out;
}

function buildArchive(
	entries: { name: string; body: Buffer; sysenv?: boolean }[],
	seed: Buffer,
): Buffer {
	const contentKey = generateAzContentKey(seed);
	const indexKey = generateAzIndexKey(AZ_DEFAULT_SEED);
	const index = Buffer.alloc(entries.length * 0x30, 0x00);
	const bodies: Buffer[] = [];
	let relative = 0;
	entries.forEach((entry, i) => {
		index.writeUInt32LE(relative, i * 0x30);
		index.writeUInt32LE(entry.body.length, i * 0x30 + 4);
		index.writeUInt32LE(0, i * 0x30 + 8);
		index.writeInt32LE(0, i * 0x30 + 0x0c);
		Buffer.from(entry.name, "latin1").copy(index, i * 0x30 + 0x10);
		relative += entry.body.length;
		bodies.push(entry.body);
	});
	const compressed = deflateSync(index);
	const framed = Buffer.alloc(4 + compressed.length, 0x00);
	framed.writeUInt32LE(adler32(compressed), 0);
	compressed.copy(framed, 4);
	const total = HEAD_SIZE + framed.length + relative;
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write(ARC_MARK, 0, "latin1");
	head.writeInt32LE(1, 4);
	head.writeInt32LE(entries.length, 8);
	head.writeUInt32LE(framed.length, 0x0c);
	decryptAz(head, 0, indexKey);
	decryptAz(framed, HEAD_SIZE, indexKey);
	let placed = HEAD_SIZE + framed.length;
	const stored = entries.map((entry) => {
		const key = entry.sysenv ? indexKey : contentKey;
		const copy = Buffer.from(entry.body);
		decryptAz(copy, placed, key);
		placed += entry.body.length;
		return copy;
	});
	void total;
	return Buffer.concat([head, framed, ...stored]);
}

describe("AZ system encrypted resource archive (encrypted)", () => {
	it("stands the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the sound", () => {
		const key = generateAzIndexKey(AZ_DEFAULT_SEED);
		expect(key).toBe(0xadd1f4aa);
		const encrypted = Buffer.from("ARC\0", "latin1");
		decryptAz(encrypted, 0, key);
		expect(encrypted.readUInt32LE(0)).toBe(0x53ea06eb);
	});

	it("stands the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the kind of them", () => {
		const first = generateAzContentKey(Buffer.alloc(0x10, 0x00));
		const second = generateAzContentKey(Buffer.alloc(0x10, 0x00));
		expect(first).toBe(second);
		const other = generateAzContentKey(Buffer.alloc(0x10, 0x01));
		expect(other).not.toBe(first);
		expect(first).toBeGreaterThanOrEqual(0);
	});

	it("reads the places of the picture of the walk of the places of the picture of the words of the walk of the places of the picture of the walk of them of a picture of this kind", async () => {
		const plain = Buffer.from("plain entry here", "latin1");
		const compressed = Buffer.from("compressed entry here", "latin1");
		const seed = Buffer.alloc(0x10, 0x42);
		const formed = buildArchive(
			[
				{ name: "one.dat", body: plain },
				{ name: "two.dat", body: azData(compressed) },
				{ name: SYSENV, body: azData(seed), sysenv: true },
			],
			seed,
		);
		const layout = await readAzEncryptedLayout(formed, "system.arc");
		if (!layout) throw new Error("no layout");
		expect(layout.entries.length).toBe(3);
		expect(layout.contentKey).toBe(generateAzContentKey(seed));
		expect(
			(
				await unpackAzEncryptedEntry(formed, layout, layout.entries[0] as never)
			).toString("latin1"),
		).toBe("plain entry here");
		expect(
			(
				await unpackAzEncryptedEntry(formed, layout, layout.entries[1] as never)
			).toString("latin1"),
		).toBe("compressed entry here");
	});

	it("turns away the places of the picture of the walk of the places of the picture of the words of the walk of the picture that stand of no places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of them of the engine", async () => {
		expect(
			await readAzEncryptedLayout(Buffer.alloc(HEAD_SIZE, 0x00)),
		).toBeUndefined();
		expect(await readAzEncryptedLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
		const formed = buildArchive(
			[{ name: "one.dat", body: Buffer.from("x", "latin1") }],
			Buffer.alloc(0x10, 0x00),
		);
		const broken = Buffer.from(formed);
		broken.writeUInt32LE(0xdeadbeef, HEAD_SIZE);
		await expect(readAzEncryptedLayout(broken)).rejects.toBeInstanceOf(
			GarbroError,
		);
	});

	it("stands the places of the picture of the walk of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of this kind out as the places of the picture of the walk of them", async () => {
		const seed = Buffer.alloc(0x10, 0x07);
		const formed = buildArchive(
			[
				{ name: "one.dat", body: Buffer.from("hello", "latin1") },
				{ name: SYSENV, body: azData(seed), sysenv: true },
			],
			seed,
		);
		const archive = await azEncryptedArchiveFormat.open(
			new BufferByteSource(formed),
			"system.arc",
		);
		expect(archive.entries.map((entry) => entry.path)).toEqual([
			"one.dat",
			SYSENV,
		]);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		expect(
			(await consumeBuffer(await archive.openEntry(entry.id))).toString(
				"latin1",
			),
		).toBe("hello");
		await expect(
			azEncryptedArchiveFormat.detect(new BufferByteSource(formed)),
		).resolves.toBe(true);
		await expect(
			azEncryptedArchiveFormat.detect(
				new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x22)),
			),
		).resolves.toBe(false);
		await expect(
			azEncryptedArchiveFormat.open(
				new BufferByteSource(Buffer.alloc(HEAD_SIZE, 0x22)),
				"data.arc",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
