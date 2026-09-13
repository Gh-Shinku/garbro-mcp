import { BufferByteSource } from "@garbro-mcp/core";
import { eushullyAogAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const OGG_PAYLOAD = Buffer.concat([
	Buffer.from("OggS"),
	Buffer.alloc(0x20, 0x42),
]);

/** Builds a container: the signature, a filler, then the embedded ogg stream. */
function buildAog(ogg: Buffer = OGG_PAYLOAD): Buffer {
	return Buffer.concat([
		Buffer.from("AOGG", "latin1"),
		Buffer.alloc(0x10, 0x2a),
		ogg,
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("eushully aog audio", () => {
	it("declares the AOGG signature for the registry", () => {
		expect(eushullyAogAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("AOGG", "latin1") },
		]);
	});

	it("wraps the embedded ogg stream as a single entry", async () => {
		const source = sourceOf(buildAog());
		expect(await eushullyAogAudioFormat.detect(source, "GAME.AOG")).toBe(true);
		const archive = await eushullyAogAudioFormat.open(source, "GAME.AOG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["GAME.ogg"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "ogg" });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// The twenty byte header is not part of the payload.
			expect(Number(entry.size)).toBe(OGG_PAYLOAD.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG_PAYLOAD,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a container without an embedded ogg stream", async () => {
		const file = buildAog();
		file.write("XXXX", 0x14, "latin1");
		expect(
			await eushullyAogAudioFormat.detect(sourceOf(file), "GAME.AOG"),
		).toBe(false);
	});

	it("declines a container that is too short", async () => {
		const file = buildAog().subarray(0, 0x10);
		expect(
			await eushullyAogAudioFormat.detect(sourceOf(file), "GAME.AOG"),
		).toBe(false);
	});

	it("declines a file without the signature", async () => {
		const file = buildAog();
		file.write("XXXX", 0, "latin1");
		expect(
			await eushullyAogAudioFormat.detect(sourceOf(file), "GAME.AOG"),
		).toBe(false);
	});
});
