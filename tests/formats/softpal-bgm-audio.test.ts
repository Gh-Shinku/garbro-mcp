import { BufferByteSource } from "@garbro-mcp/core";
import type { ArchiveEntry } from "@garbro-mcp/core";
import {
	softpalBgmAudioDescriptor,
	softpalBgmAudioFormat,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** The entry offsets survive at runtime but are not part of the read back type. */
function entryOffset(entry: ArchiveEntry): number {
	return Number((entry as unknown as { offset: bigint }).offset);
}

const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(0x20, 0x77)]);
const STREAM_OFFSET = 0xc;

/** Builds a container: the loop timing header, then the ogg stream. */
function buildBgm(ogg: Buffer = OGG): Buffer {
	const head = Buffer.alloc(STREAM_OFFSET, 0x2a);
	head.write("BGM ", 0, "latin1");
	// Loop timing fields, ignored by the reference and by the port.
	head.writeUInt32LE(0x1000, 4);
	return Buffer.concat([head, ogg]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("softpal bgm audio", () => {
	it("declares the BGM signature for the registry", () => {
		expect(softpalBgmAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("BGM ", "latin1") },
		]);
	});

	it("declares the ogg extension", () => {
		expect(softpalBgmAudioDescriptor.extensions).toEqual(["ogg"]);
	});

	it("extracts the stream behind the timing header", async () => {
		const source = sourceOf(buildBgm());
		expect(await softpalBgmAudioFormat.detect(source, "BGM01.BGM")).toBe(true);
		const archive = await softpalBgmAudioFormat.open(source, "BGM01.BGM");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.ogg"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "ogg" });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(STREAM_OFFSET);
			expect(Number(entry.size)).toBe(OGG.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the signature", async () => {
		const file = buildBgm();
		file.write("BGX ", 0, "latin1");
		expect(
			await softpalBgmAudioFormat.detect(sourceOf(file), "BGM01.BGM"),
		).toBe(false);
	});

	it("declines a file without an ogg page", async () => {
		const file = buildBgm();
		file.write("OggX", STREAM_OFFSET, "latin1");
		expect(
			await softpalBgmAudioFormat.detect(sourceOf(file), "BGM01.BGM"),
		).toBe(false);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await softpalBgmAudioFormat.detect(
				sourceOf(Buffer.alloc(STREAM_OFFSET)),
				"BGM01.BGM",
			),
		).toBe(false);
	});
});
