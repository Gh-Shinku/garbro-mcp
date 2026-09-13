import { BufferByteSource } from "@garbro-mcp/core";
import type { ArchiveEntry } from "@garbro-mcp/core";
import { kogAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** The entry offsets survive at runtime but are not part of the read back type. */
function entryOffset(entry: ArchiveEntry): number {
	return Number((entry as unknown as { offset: bigint }).offset);
}

const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(0x20, 0x55)]);
const HEADER_SIZE = 8;
const HEADER_SIZE_FIELD = 4;

/** Builds a container: a zero signature, the header size, filler and the ogg stream. */
function buildKog(headerSize = 0x10, ogg: Buffer = OGG): Buffer {
	const head = Buffer.alloc(headerSize, 0x2a);
	head.writeUInt32LE(0, 0);
	head.writeInt32LE(headerSize, HEADER_SIZE_FIELD);
	return Buffer.concat([head, ogg]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("sviu kog audio", () => {
	it("extracts the stream at the declared header size", async () => {
		const source = sourceOf(buildKog());
		expect(await kogAudioFormat.detect(source, "BGM01.KOG")).toBe(true);
		const archive = await kogAudioFormat.open(source, "BGM01.KOG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.ogg"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "ogg" });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(0x10);
			expect(Number(entry.size)).toBe(OGG.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("honours a larger header size", async () => {
		const source = sourceOf(buildKog(0x40));
		expect(await kogAudioFormat.detect(source, "BGM01.KOG")).toBe(true);
		const archive = await kogAudioFormat.open(source, "BGM01.KOG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(0x40);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the zero signature", async () => {
		const file = buildKog();
		file[0] = 1;
		expect(await kogAudioFormat.detect(sourceOf(file), "BGM01.KOG")).toBe(
			false,
		);
	});

	it("declines a non positive header size", async () => {
		const file = buildKog();
		file.writeInt32LE(0, HEADER_SIZE_FIELD);
		expect(await kogAudioFormat.detect(sourceOf(file), "BGM01.KOG")).toBe(
			false,
		);
	});

	it("declines a header size past the end of the file", async () => {
		const file = buildKog();
		file.writeInt32LE(file.length + 0x10, HEADER_SIZE_FIELD);
		expect(await kogAudioFormat.detect(sourceOf(file), "BGM01.KOG")).toBe(
			false,
		);
	});

	it("declines a header size without an ogg page", async () => {
		const file = buildKog();
		file.writeInt32LE(HEADER_SIZE, HEADER_SIZE_FIELD);
		expect(await kogAudioFormat.detect(sourceOf(file), "BGM01.KOG")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await kogAudioFormat.detect(sourceOf(Buffer.alloc(4)), "BGM01.KOG"),
		).toBe(false);
	});
});
