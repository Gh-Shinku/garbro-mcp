import { BufferByteSource } from "@garbro-mcp/core";
import type { ArchiveEntry } from "@garbro-mcp/core";
import { bgiAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** The entry offsets survive at runtime but are not part of the read back type. */
function entryOffset(entry: ArchiveEntry): number {
	return Number((entry as unknown as { offset: bigint }).offset);
}

const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(0x28, 0x12)]);

/** Builds a container: the offset word, the marker, filler and the stream. */
function buildBw(offset = 0x40, stream: Buffer = OGG): Buffer {
	const head = Buffer.alloc(offset, 0x2a);
	head.writeUInt32LE(offset, 0);
	head.write("bw  ", 4, "latin1");
	return Buffer.concat([head, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("ethornell bw audio", () => {
	it("declares both accepted header words", () => {
		expect(bgiAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x40, 0, 0, 0]) },
			{ bytes: Buffer.alloc(4) },
		]);
	});

	it("extracts the stream at the declared offset", async () => {
		const source = sourceOf(buildBw());
		expect(await bgiAudioFormat.detect(source, "BGM01.BW")).toBe(true);
		const archive = await bgiAudioFormat.open(source, "BGM01.BW");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.ogg"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "ogg" });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(0x40);
			expect(Number(entry.size)).toBe(OGG.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("accepts a zero offset, which keeps the whole file", async () => {
		const file = Buffer.concat([
			Buffer.alloc(4),
			Buffer.from("bw  ", "latin1"),
			OGG,
		]);
		const source = sourceOf(file);
		expect(await bgiAudioFormat.detect(source, "BGM02.BW")).toBe(true);
		const archive = await bgiAudioFormat.open(source, "BGM02.BW");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(0);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				file,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the marker", async () => {
		const file = buildBw();
		file.write("bwXX", 4, "latin1");
		expect(await bgiAudioFormat.detect(sourceOf(file), "BGM01.BW")).toBe(false);
	});

	it("declines a file whose offset is past the end", async () => {
		const file = buildBw(0x40, Buffer.alloc(0));
		expect(await bgiAudioFormat.detect(sourceOf(file), "BGM01.BW")).toBe(false);
	});

	it("declines a file without an accepted header word", async () => {
		const file = buildBw();
		file.writeUInt32LE(0x30, 0);
		expect(await bgiAudioFormat.detect(sourceOf(file), "BGM01.BW")).toBe(false);
	});

	it("declines a file shorter than the header", async () => {
		expect(await bgiAudioFormat.detect(sourceOf(OGG), "BGM01.BW")).toBe(false);
	});
});
