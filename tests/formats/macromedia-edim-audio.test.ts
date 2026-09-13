import { BufferByteSource } from "@garbro-mcp/core";
import type { ArchiveEntry } from "@garbro-mcp/core";
import { edimAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** The entry offsets survive at runtime but are not part of the read back type. */
function entryOffset(entry: ArchiveEntry): number {
	return Number((entry as unknown as { offset: bigint }).offset);
}

const MP3 = Buffer.concat([
	Buffer.from([0xff, 0xe2, 0x80]),
	Buffer.alloc(0x30, 0x5a),
]);

/** Builds a container: the big endian offset word, a filler and the mp3 stream. */
function buildEdim(distance = 0x140, stream: Buffer = MP3): Buffer {
	const header = Buffer.alloc(4);
	header.writeUInt32BE(distance, 0);
	return Buffer.concat([header, Buffer.alloc(distance, 0x2a), stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("macromedia edim audio", () => {
	it("declares both stored signature words", () => {
		expect(edimAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x00, 0x00, 0x01, 0x40]) },
			{ bytes: Buffer.from([0x00, 0x00, 0x01, 0x64]) },
		]);
	});

	it("extracts the stream at four bytes past the header word", async () => {
		const source = sourceOf(buildEdim());
		expect(await edimAudioFormat.detect(source, "SOUND.EDIM")).toBe(true);
		const archive = await edimAudioFormat.open(source, "SOUND.EDIM");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SOUND.mp3"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "mp3" });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(4 + 0x140);
			expect(Number(entry.size)).toBe(MP3.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				MP3,
			);
		} finally {
			await archive.close();
		}
	});

	it("accepts the second signature word", async () => {
		// The second signature word carries its own distance, so the filler must match it.
		const file = buildEdim(0x164);
		const source = sourceOf(file);
		expect(await edimAudioFormat.detect(source, "SOUND.EDIM")).toBe(true);
		const archive = await edimAudioFormat.open(source, "SOUND.EDIM");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(4 + 0x164);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				MP3,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines an unknown header word", async () => {
		const file = buildEdim();
		file.writeUInt32BE(0x141, 0);
		expect(await edimAudioFormat.detect(sourceOf(file), "SOUND.EDIM")).toBe(
			false,
		);
	});

	it("declines an offset past the end of the file", async () => {
		const file = buildEdim(0x140, Buffer.alloc(0));
		expect(await edimAudioFormat.detect(sourceOf(file), "SOUND.EDIM")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header word", async () => {
		expect(
			await edimAudioFormat.detect(sourceOf(Buffer.alloc(3)), "SOUND.EDIM"),
		).toBe(false);
	});
});
