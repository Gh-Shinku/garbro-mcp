import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { vafsFormat } from "../../packages/formats/src/softpal/vafs.js";

const INDEX_OFFSET = 0x10;

/**
 * Builds a `VAFS` archive: the header, the offset table of the later payloads and the payloads. The
 * table holds one word per payload (the start of the next one, the last entry carrying the file size).
 */
function buildVafs(payloads: Buffer[]): Buffer {
	// The table carries one word per payload and one unused word in front of the payload area.
	const dataOffset = INDEX_OFFSET + 4 * (payloads.length + 1);
	let position = dataOffset;
	const offsets = payloads.map((payload) => {
		const offset = position;
		position += payload.length;
		return offset;
	});
	const total = position;
	const file = Buffer.alloc(total);
	file.write("VAFS", 0, "latin1");
	file.writeUInt8(0x48, 4);
	file.writeUInt32LE(dataOffset, INDEX_OFFSET);
	offsets.forEach((offset, index) => {
		// Each table word points at the payload after the current one.
		const target =
			index + 1 < offsets.length ? (offsets[index + 1] ?? 0) : total;
		file.writeUInt32LE(target, INDEX_OFFSET + 4 + index * 4);
		payloads[index]?.copy(file, offset);
	});
	return file;
}

/**
 * Builds a `TP` slot archive: the slot table behind the header and the payloads behind the table. The
 * walk stops at the first non-zero word, which also holds the first payload offset.
 */
function buildTp(slots: { field: number }[], payloads: Buffer[]): Buffer {
	const dataOffset = 0x20 + slots.length * 0x10;
	let position = dataOffset;
	const offsets = payloads.map((payload) => {
		const offset = position;
		position += payload.length;
		return offset;
	});
	const file = Buffer.alloc(position);
	file.write("VAFS", 0, "latin1");
	file.writeUInt8(0x48, 4);
	// A zero data offset at 0x10 selects the slot layout.
	file.writeUInt32LE(0, INDEX_OFFSET);
	slots.forEach((slot, index) => {
		const at = 0x20 + index * 0x10;
		file.writeUInt32LE(offsets[index] ?? 0, at);
		file.writeInt32LE(slot.field, at + 4);
	});
	for (const [index, payload] of payloads.entries())
		payload.copy(file, offsets[index] ?? 0);
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("softpal vafs", () => {
	it("lists payloads with generated names", async () => {
		const payloads = [
			Buffer.from("first payload"),
			Buffer.from("second payload, longer"),
			Buffer.from("third"),
		];
		const file = buildVafs(payloads);
		const source = sourceOf(file);
		expect(await vafsFormat.detect(source, "DATA.052")).toBe(true);
		const archive = await vafsFormat.open(source, "DATA.052");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"DATA#00000",
				"DATA#00001",
				"DATA#00002",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual(
				payloads.map((payload) => payload.length),
			);
			expect(archive.metadata).toMatchObject({ layout: "vafs", entryCount: 3 });
			for (const [index, entry] of archive.entries.entries()) {
				expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
					payloads[index],
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("marks bgm payloads as audio and pic payloads as images", async () => {
		const payloads = [Buffer.from("bgm payload one"), Buffer.from("bgm two")];
		const bgm = await vafsFormat.open(sourceOf(buildVafs(payloads)), "BGM.052");
		try {
			expect(bgm.entries.map((entry) => entry.path)).toEqual([
				"BGM#00000.wav",
				"BGM#00001.wav",
			]);
			expect(bgm.entries[0]?.metadata).toMatchObject({ type: "audio" });
		} finally {
			await bgm.close();
		}
		const pic = await vafsFormat.open(sourceOf(buildVafs(payloads)), "PIC.052");
		try {
			expect(pic.entries.map((entry) => entry.path)).toEqual([
				"PIC#00000",
				"PIC#00001",
			]);
			expect(pic.entries[0]?.metadata).toMatchObject({ type: "image" });
		} finally {
			await pic.close();
		}
	});

	it("detects the type of an unnamed archive from the payload", async () => {
		// A short signature in the picture range and a chunk scaled audio payload.
		const picture = Buffer.alloc(0x40);
		picture.writeUInt32LE(3, 0);
		const audio = Buffer.alloc(0x600);
		audio.writeUInt32LE(0x600, 0);
		const file = buildVafs([picture, audio]);
		const archive = await vafsFormat.open(sourceOf(file), "DATA.056");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "image" });
			expect(archive.entries[1]?.metadata).toMatchObject({ type: "audio" });
		} finally {
			await archive.close();
		}
	});

	it("skips payloads shorter than four bytes", async () => {
		const file = buildVafs([Buffer.from("kept payload"), Buffer.from([1, 2])]);
		const source = sourceOf(file);
		const archive = await vafsFormat.open(source, "DATA.052");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"DATA#00000",
			]);
		} finally {
			await archive.close();
		}
	});

	it("declines a data offset inside the header", async () => {
		const file = buildVafs([Buffer.from("payload")]);
		file.writeUInt32LE(4, INDEX_OFFSET);
		expect(await vafsFormat.detect(sourceOf(file), "DATA.052")).toBe(false);
	});

	it("declines a file whose signature byte is missing", async () => {
		const file = buildVafs([Buffer.from("payload")]);
		file.writeUInt8(0x41, 4);
		expect(await vafsFormat.detect(sourceOf(file), "DATA.052")).toBe(false);
	});

	it("lists tp slot archives", async () => {
		const payloads = [Buffer.alloc(0x402), Buffer.alloc(0x804)];
		const file = buildTp([{ field: 1 }, { field: 2 }], payloads);
		const source = sourceOf(file);
		expect(await vafsFormat.detect(source, "TP.052")).toBe(true);
		const archive = await vafsFormat.open(source, "TP.052");
		try {
			expect(archive.metadata).toMatchObject({ layout: "tp" });
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"TP#00001.wav",
				"TP#00002.wav",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				0x402, 0x804,
			]);
		} finally {
			await archive.close();
		}
	});

	it("derives tp version 55 sizes from the neighbouring offsets", async () => {
		const payloads = [
			Buffer.alloc(0x100),
			Buffer.alloc(0x200),
			Buffer.alloc(0x80),
		];
		const file = buildTp([{ field: 2 }, { field: 4 }, { field: 1 }], payloads);
		const source = sourceOf(file);
		const archive = await vafsFormat.open(source, "TP.055");
		try {
			expect(archive.metadata).toMatchObject({ layout: "tp055" });
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"TP#000001.wav",
				"TP#000002.wav",
				"TP#000003.wav",
			]);
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				0x100, 0x200, 0x80,
			]);
			expect(archive.entries[0]?.metadata).toMatchObject({ chunkCount: 2 });
		} finally {
			await archive.close();
		}
	});
});
