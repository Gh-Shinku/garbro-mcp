import { BufferByteSource } from "@garbro-mcp/core";
import type { ArchiveEntry } from "@garbro-mcp/core";
import { voiAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** The entry offsets survive at runtime but are not part of the read back type. */
function entryOffset(entry: ArchiveEntry): number {
	return Number((entry as unknown as { offset: bigint }).offset);
}

const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(0x24, 0x33)]);
const OFFSET_FIELD = 0x1e;
const STREAM_BASE = 0x20;

/** Builds a container: a fixed header, `offset` filler bytes and then the stream. */
function buildVoi(ogg: Buffer = OGG, offset = 0x08): Buffer {
	const head = Buffer.alloc(STREAM_BASE + offset, 0x2a);
	head[OFFSET_FIELD] = offset;
	return Buffer.concat([head, ogg]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("slg voi audio", () => {
	it("finds the embedded stream through the offset byte", async () => {
		const source = sourceOf(buildVoi());
		expect(await voiAudioFormat.detect(source, "VOICE.VOI")).toBe(true);
		const archive = await voiAudioFormat.open(source, "VOICE.VOI");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["VOICE.ogg"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "ogg" });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(STREAM_BASE + 0x08);
			expect(Number(entry.size)).toBe(OGG.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("honours a different offset", async () => {
		const source = sourceOf(buildVoi(OGG, 0x40));
		const archive = await voiAudioFormat.open(source, "VOICE.VOI");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(STREAM_BASE + 0x40);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a zero offset", async () => {
		const file = buildVoi();
		file[OFFSET_FIELD] = 0;
		expect(await voiAudioFormat.detect(sourceOf(file), "VOICE.VOI")).toBe(
			false,
		);
	});

	it("declines a stream without an ogg page", async () => {
		const file = buildVoi();
		file.write("OggX", STREAM_BASE + 0x08, "latin1");
		expect(await voiAudioFormat.detect(sourceOf(file), "VOICE.VOI")).toBe(
			false,
		);
	});

	it("declines an offset past the end of the file", async () => {
		const file = buildVoi();
		file[OFFSET_FIELD] = 0x7f;
		expect(await voiAudioFormat.detect(sourceOf(file), "VOICE.VOI")).toBe(
			false,
		);
	});

	it("declines a file without room for a stream", async () => {
		expect(
			await voiAudioFormat.detect(
				sourceOf(Buffer.alloc(STREAM_BASE)),
				"VOICE.VOI",
			),
		).toBe(false);
	});
});
