import { ailDatFormat, lnk2Format } from "@garbro-mcp/formats";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, expect, it } from "vitest";

interface AilFixtureEntry {
	content: Buffer;
	packed?: boolean;
	headerPrefix?: Buffer;
}

function buildAil(entries: AilFixtureEntry[]): Buffer {
	const dataParts: Buffer[] = [];
	const sizes: number[] = [];
	for (const entry of entries) {
		let part: Buffer;
		if (entry.packed) {
			const header = Buffer.alloc(6);
			header.writeUInt16LE(1, 0);
			header.writeUInt32LE(entry.content.length, 2);
			part = Buffer.concat([header, literalLzssStream(entry.content, 0)]);
		} else {
			part = Buffer.concat([
				entry.headerPrefix ?? Buffer.alloc(4),
				entry.content,
			]);
		}
		dataParts.push(part);
		sizes.push(part.length);
	}
	const index = Buffer.alloc(sizes.length * 4);
	sizes.forEach((size, id) => {
		index.writeUInt32LE(size, id * 4);
	});
	const header = Buffer.alloc(4);
	header.writeInt32LE(sizes.length, 0);
	return Buffer.concat([header, index, ...dataParts]);
}

describe("Ail resource archive", () => {
	it("reads unpacked and packed entries with the reversed LZSS variant", async () => {
		const packedContent = Buffer.concat([
			Buffer.from("OggS"),
			Buffer.from("payload"),
		]);
		const archive = buildAil([
			{ content: Buffer.from("plain") },
			{ content: packedContent, packed: true },
		]);
		const format = ailDatFormat;
		const source = new BufferByteSource(archive);
		expect(await format.detect(source, "data.dat")).toBe(true);
		const handle = await format.open(source, "data.dat");
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"data#00000",
				"data#00001.ogg",
			]);
			expect(handle.entries[1]).toMatchObject({
				size: BigInt(literalLzssStream(packedContent, 0).length),
				compressed: true,
				metadata: { packed: true, unpackedSize: "11" },
			});
			expect(await consumeBuffer(await handle.openEntry("0"))).toEqual(
				Buffer.from("plain"),
			);
			expect(await consumeBuffer(await handle.openEntry("1"))).toEqual(
				packedContent,
			);
		} finally {
			await handle.close();
		}
	});

	it("rejects archives with more than 0x80000 trailing bytes", async () => {
		const archive = Buffer.concat([
			buildAil([{ content: Buffer.from("x") }]),
			Buffer.alloc(0x80001),
		]);
		await expect(
			ailDatFormat.open(new BufferByteSource(archive), "data.dat"),
		).rejects.toThrow(/Ail/);
	});
});

function buildLnk2(entries: AilFixtureEntry[]): Buffer {
	const dataParts: Buffer[] = [];
	const sizes: number[] = [];
	for (const entry of entries) {
		const part = Buffer.concat([
			entry.headerPrefix ?? Buffer.alloc(4),
			entry.content,
		]);
		dataParts.push(part);
		sizes.push(part.length);
	}
	const index = Buffer.alloc(sizes.length * 2 * 4);
	sizes.forEach((size, id) => {
		index.writeUInt32LE(size, id * 4);
	});
	const header = Buffer.alloc(8);
	header.write("LNK2", 0, "ascii");
	header.writeInt32LE(sizes.length, 4);
	return Buffer.concat([header, index, ...dataParts]);
}

describe("Ail LNK2 archive", () => {
	it("reads a count that is stored as half the index entry count", async () => {
		const archive = buildLnk2([
			{ content: Buffer.from("a") },
			{ content: Buffer.from("bb") },
		]);
		expect(await lnk2Format.detect(new BufferByteSource(archive))).toBe(true);
		const handle = await lnk2Format.open(
			new BufferByteSource(archive),
			"data.dat",
		);
		try {
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"data#00000",
				"data#00001",
			]);
		} finally {
			await handle.close();
		}
	});
});
