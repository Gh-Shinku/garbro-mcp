import { BufferByteSource } from "@garbro-mcp/core";
import { realliveOwpAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const KEY = 0x39;
const OGG = Buffer.concat([Buffer.from("OggS"), Buffer.alloc(0x30, 0x31)]);

/** The mask is its own inverse. */
function mask(input: Buffer): Buffer {
	const output: Buffer = Buffer.alloc(input.length);
	for (let i = 0; i < input.length; i += 1) output[i] = (input[i] ?? 0) ^ KEY;
	return output;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("reallive owp audio", () => {
	it("declares the masked OggS signature", () => {
		expect(realliveOwpAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x76, 0x5e, 0x5e, 0x6a]) },
		]);
	});

	it("unmasks the whole stream", async () => {
		const file = mask(OGG);
		const source = sourceOf(file);
		expect(await realliveOwpAudioFormat.detect(source, "BGM01.OWP")).toBe(true);
		const archive = await realliveOwpAudioFormat.open(source, "BGM01.OWP");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.ogg"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "ogg", key: KEY });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// The mask preserves the length.
			expect(Number(entry.size)).toBe(file.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				OGG,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the signature", async () => {
		const file = mask(OGG);
		file[0] = 0x77;
		expect(
			await realliveOwpAudioFormat.detect(sourceOf(file), "BGM01.OWP"),
		).toBe(false);
	});

	it("declines a file that is too short", async () => {
		expect(
			await realliveOwpAudioFormat.detect(
				sourceOf(Buffer.alloc(3)),
				"BGM01.OWP",
			),
		).toBe(false);
	});
});
