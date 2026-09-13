import { BufferByteSource } from "@garbro-mcp/core";
import type { ArchiveEntry } from "@garbro-mcp/core";
import { ikmAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** The entry offsets survive at runtime but are not part of the read back type. */
function entryOffset(entry: ArchiveEntry): number {
	return Number((entry as unknown as { offset: bigint }).offset);
}

const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(0x30, 0x11)]);
const HEADER_SIZE = 0x40;
const LENGTH_OFFSET = 0x24;

/** Builds a container whose embedded stream is the last `length` bytes. */
function buildIkm(ogg: Buffer = OGG): Buffer {
	const header = Buffer.alloc(HEADER_SIZE, 0x2a);
	Buffer.from([0x49, 0x4b, 0x4d, 0x00]).copy(header, 0);
	header.writeUInt32LE(ogg.length, LENGTH_OFFSET);
	return Buffer.concat([header, ogg]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("microvision ikm audio", () => {
	it("declares the IKM signature for the registry", () => {
		expect(ikmAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x49, 0x4b, 0x4d, 0x00]) },
		]);
	});

	it("extracts the trailing ogg stream", async () => {
		const source = sourceOf(buildIkm());
		expect(await ikmAudioFormat.detect(source, "BGM01.IKM")).toBe(true);
		const archive = await ikmAudioFormat.open(source, "BGM01.IKM");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.ogg"]);
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

	it("declines a file without the signature", async () => {
		const file = buildIkm();
		file[3] = 0x2a;
		expect(await ikmAudioFormat.detect(sourceOf(file), "BGM01.IKM")).toBe(
			false,
		);
	});

	it("declines a zero length stream", async () => {
		const file = buildIkm();
		file.writeUInt32LE(0, LENGTH_OFFSET);
		expect(await ikmAudioFormat.detect(sourceOf(file), "BGM01.IKM")).toBe(
			false,
		);
	});

	it("declines a stream longer than the file", async () => {
		const file = buildIkm();
		file.writeUInt32LE(file.length + 0x10, LENGTH_OFFSET);
		expect(await ikmAudioFormat.detect(sourceOf(file), "BGM01.IKM")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(await ikmAudioFormat.detect(sourceOf(OGG), "BGM01.IKM")).toBe(false);
	});
});
