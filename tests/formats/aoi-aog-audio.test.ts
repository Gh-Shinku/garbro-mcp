import { BufferByteSource } from "@garbro-mcp/core";
import type { ArchiveEntry } from "@garbro-mcp/core";
import { aoiAogAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** The entry offsets survive at runtime but are not part of the read back type. */
function entryOffset(entry: ArchiveEntry): number {
	return Number((entry as unknown as { offset: bigint }).offset);
}

const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(0x24, 0x66)]);
const PLAIN_OFFSET = 0x2c;
const DECODE_OFFSET = 0x38;

/** Builds either the plain layout or the one that carries a Decode marker. */
function buildAog(layout: "plain" | "decode", ogg: Buffer = OGG): Buffer {
	const size = layout === "plain" ? PLAIN_OFFSET : DECODE_OFFSET;
	const head = Buffer.alloc(size, 0x2a);
	head.write("AoiOgg", 0, "latin1");
	if (layout === "decode") head.write("Decode", 0x0c, "latin1");
	return Buffer.concat([head, ogg]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("aoi aog audio", () => {
	it("declares the AoiO signature for the registry", () => {
		expect(aoiAogAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("AoiO", "latin1") },
		]);
	});

	it("extracts the stream of the plain layout", async () => {
		const source = sourceOf(buildAog("plain"));
		expect(await aoiAogAudioFormat.detect(source, "BGM01.AOG")).toBe(true);
		const archive = await aoiAogAudioFormat.open(source, "BGM01.AOG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.ogg"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(PLAIN_OFFSET);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("extracts the stream of the decoded layout", async () => {
		const source = sourceOf(buildAog("decode"));
		expect(await aoiAogAudioFormat.detect(source, "BGM02.AOG")).toBe(true);
		const archive = await aoiAogAudioFormat.open(source, "BGM02.AOG");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(DECODE_OFFSET);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the full signature", async () => {
		const file = buildAog("plain");
		file.write("AoiXXX", 0, "latin1");
		expect(await aoiAogAudioFormat.detect(sourceOf(file), "BGM01.AOG")).toBe(
			false,
		);
	});

	it("declines a decoded layout without the marker", async () => {
		const file = buildAog("decode");
		file.write("XXXXXX", 0x0c, "latin1");
		expect(await aoiAogAudioFormat.detect(sourceOf(file), "BGM01.AOG")).toBe(
			false,
		);
	});

	it("declines a decoded layout whose stream is elsewhere", async () => {
		const file = buildAog("decode");
		file.write("XXXX", DECODE_OFFSET, "latin1");
		expect(await aoiAogAudioFormat.detect(sourceOf(file), "BGM01.AOG")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await aoiAogAudioFormat.detect(sourceOf(Buffer.alloc(0x20)), "BGM01.AOG"),
		).toBe(false);
	});
});
