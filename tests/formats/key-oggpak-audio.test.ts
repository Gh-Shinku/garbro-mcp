import { BufferByteSource } from "@garbro-mcp/core";
import type { ArchiveEntry } from "@garbro-mcp/core";
import { keyOggpakAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** The entry offsets survive at runtime but are not part of the read back type. */
function entryOffset(entry: ArchiveEntry): number {
	return Number((entry as unknown as { offset: bigint }).offset);
}

const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(0x28, 0x22)]);
const HEADER_SIZE = 0xf;
const LENGTH_OFFSET = 0xb;

/** Builds a container: the signature, filler, the length and the embedded ogg stream. */
function buildOggpak(ogg: Buffer = OGG): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	Buffer.from("OGGPAK", "latin1").copy(header, 0);
	header.writeUInt32LE(ogg.length, LENGTH_OFFSET);
	return Buffer.concat([header, ogg]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("key oggpak audio", () => {
	it("declares the OGGP signature for the registry", () => {
		expect(keyOggpakAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("OGGP", "latin1") },
		]);
	});

	it("extracts the embedded ogg stream", async () => {
		const source = sourceOf(buildOggpak());
		expect(await keyOggpakAudioFormat.detect(source, "SE0001.OGGPAK")).toBe(
			true,
		);
		const archive = await keyOggpakAudioFormat.open(source, "SE0001.OGGPAK");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"SE0001.ogg",
			]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "ogg" });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(HEADER_SIZE);
			expect(Number(entry.size)).toBe(OGG.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose signature is truncated", async () => {
		const file = buildOggpak();
		file[5] = 0x58;
		expect(await keyOggpakAudioFormat.detect(sourceOf(file), "SE.OGGPAK")).toBe(
			false,
		);
	});

	it("declines a zero length stream", async () => {
		const file = buildOggpak();
		file.writeUInt32LE(0, LENGTH_OFFSET);
		expect(await keyOggpakAudioFormat.detect(sourceOf(file), "SE.OGGPAK")).toBe(
			false,
		);
	});

	it("declines a stream past the end of the file", async () => {
		const file = buildOggpak();
		file.writeUInt32LE(file.length, LENGTH_OFFSET);
		expect(await keyOggpakAudioFormat.detect(sourceOf(file), "SE.OGGPAK")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(await keyOggpakAudioFormat.detect(sourceOf(OGG), "SE.OGGPAK")).toBe(
			false,
		);
	});
});
