import { BufferByteSource } from "@garbro-mcp/core";
import type { ArchiveEntry } from "@garbro-mcp/core";
import { ogvAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** The entry offsets survive at runtime but are not part of the read back type. */
function entryOffset(entry: ArchiveEntry): number {
	return Number((entry as unknown as { offset: bigint }).offset);
}

const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(0x30, 0x21)]);
const FMT_OFFSET = 0xc;
const CHUNK_HEADER_SIZE = 8;

/** Builds a container: the signature, the fmt chunk, its distance and the data chunk. */
function buildOgv(distance = 0x10, stream: Buffer = OGG): Buffer {
	// The fmt chunk lives inside the header area, right after the signature.
	const head = Buffer.alloc(FMT_OFFSET + CHUNK_HEADER_SIZE, 0x2a);
	head.write("OGV", 0, "latin1");
	head.write("fmt ", FMT_OFFSET, "latin1");
	head.writeUInt32LE(distance, FMT_OFFSET + 4);
	const data = Buffer.alloc(CHUNK_HEADER_SIZE);
	data.write("data", 0, "latin1");
	data.writeUInt32LE(stream.length, 4);
	// The distance is measured from the end of the fmt chunk, so the filler comes before
	// the data chunk header.
	return Buffer.concat([head, Buffer.alloc(distance, 0x2b), data, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("shiina rio ogv audio", () => {
	it("declares the OGV signature for the registry", () => {
		expect(ogvAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x4f, 0x47, 0x56, 0x00]) },
		]);
	});

	it("walks the chunks to the embedded stream", async () => {
		const source = sourceOf(buildOgv());
		expect(await ogvAudioFormat.detect(source, "BGM01.OGV")).toBe(true);
		const archive = await ogvAudioFormat.open(source, "BGM01.OGV");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.ogg"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "ogg" });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// The distance is relative to the end of the fmt chunk header.
			// The distance is measured from the end of the fmt chunk, and the stream follows
			// the eight byte data chunk header.
			expect(entryOffset(entry)).toBe(
				FMT_OFFSET + 2 * CHUNK_HEADER_SIZE + 0x10,
			);
			expect(Number(entry.size)).toBe(OGG.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("honours a different distance", async () => {
		const source = sourceOf(buildOgv(0x28));
		const archive = await ogvAudioFormat.open(source, "BGM02.OGV");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(
				FMT_OFFSET + 2 * CHUNK_HEADER_SIZE + 0x28,
			);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the fmt chunk", async () => {
		const file = buildOgv();
		file.write("fmx ", FMT_OFFSET, "latin1");
		expect(await ogvAudioFormat.detect(sourceOf(file), "BGM01.OGV")).toBe(
			false,
		);
	});

	it("declines a file whose data chunk is elsewhere", async () => {
		// With a zero distance the data chunk sits right after the fmt chunk.
		const file = buildOgv(0);
		file.write("datx", FMT_OFFSET + CHUNK_HEADER_SIZE, "latin1");
		expect(await ogvAudioFormat.detect(sourceOf(file), "BGM01.OGV")).toBe(
			false,
		);
	});

	it("declines a distance past the end of the file", async () => {
		// Growing the fixture with the distance would keep the chunk in range, so the field is
		// patched instead.
		const file = buildOgv(0);
		file.writeUInt32LE(0x10000, FMT_OFFSET + 4);
		expect(await ogvAudioFormat.detect(sourceOf(file), "BGM01.OGV")).toBe(
			false,
		);
	});

	it("declines a file that is too short", async () => {
		expect(
			await ogvAudioFormat.detect(sourceOf(Buffer.alloc(0x10)), "BGM01.OGV"),
		).toBe(false);
	});
});
