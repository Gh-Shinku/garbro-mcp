import { BufferByteSource } from "@garbro-mcp/core";
import type { ArchiveEntry } from "@garbro-mcp/core";
import { eogAudioDescriptor, eogAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** The entry offsets survive at runtime but are not part of the read back type. */
function entryOffset(entry: ArchiveEntry): number {
	return Number((entry as unknown as { offset: bigint }).offset);
}

const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(0x28, 0x44)]);
const HEADER_SIZE = 8;

/** Builds a container: the CRM signature, a filler and the embedded ogg stream. */
function buildEog(ogg: Buffer = OGG): Buffer {
	return Buffer.concat([
		Buffer.from([0x43, 0x52, 0x4d, 0x00]),
		Buffer.alloc(HEADER_SIZE - 4, 0x2a),
		ogg,
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("crowd eog audio", () => {
	it("declares the CRM signature for the registry", () => {
		expect(eogAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x43, 0x52, 0x4d, 0x00]) },
		]);
	});

	it("extracts the stream behind the header", async () => {
		const source = sourceOf(buildEog());
		expect(await eogAudioFormat.detect(source, "BGM01.EOG")).toBe(true);
		const archive = await eogAudioFormat.open(source, "BGM01.EOG");
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

	it("declares the eog and amb extensions", () => {
		expect(eogAudioDescriptor.extensions).toEqual(["eog", "amb"]);
	});

	it("declines a file without the signature", async () => {
		const file = buildEog();
		file[0] = 0x44;
		expect(await eogAudioFormat.detect(sourceOf(file), "BGM01.EOG")).toBe(
			false,
		);
	});

	it("declines a file without room for a stream", async () => {
		expect(
			await eogAudioFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE)),
				"BGM01.EOG",
			),
		).toBe(false);
	});
});
