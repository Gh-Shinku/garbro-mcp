import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { mokoProOggAudioFormat } from "../../packages/formats/src/moko-pro/ogg-audio.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { buildNnnn } from "../helpers/moko.js";

/** A sound of the Ogg kind, as far as its word goes. */
function oggSound(): Buffer {
	return Buffer.concat([
		Buffer.from("OggS", "latin1"),
		Buffer.alloc(0x40, 0x00),
	]);
}

describe("Mokopro compressed audio", () => {
	it("unwraps the sound behind the walk of runs", async () => {
		const ogg = oggSound();
		const data = buildNnnn(literalLzssStream(ogg), ogg.length);
		const handle = await mokoProOggAudioFormat.open(
			new BufferByteSource(data),
			"sound.dat",
		);
		expect(handle.entries).toHaveLength(1);
		expect(handle.entries[0]).toMatchObject({
			path: "sound.ogg",
			size: BigInt(ogg.length),
			packedSize: BigInt(data.length),
			compressed: true,
			encrypted: true,
			metadata: { type: "audio" },
		});
		expect(handle.metadata).toEqual({ audio: "ogg", codec: "vorbis" });
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const content = await consumeBuffer(await handle.openEntry(entry.id));
		expect(content.equals(ogg)).toBe(true);
	});

	it("declines a payload that is not a sound of the Ogg kind", async () => {
		const payload = Buffer.from("not a sound at all");
		const data = buildNnnn(literalLzssStream(payload), payload.length);
		expect(
			await mokoProOggAudioFormat.detect(
				new BufferByteSource(data),
				"sound.dat",
			),
		).toBe(false);
		await expect(
			mokoProOggAudioFormat.open(new BufferByteSource(data), "sound.dat"),
		).rejects.toThrow(GarbroError);
		await expect(
			mokoProOggAudioFormat.open(new BufferByteSource(data), "sound.dat"),
		).rejects.toThrow("Not a Mokopro sound");
	});

	it("declines a file without the head of the container", async () => {
		const ogg = oggSound();
		const data = buildNnnn(literalLzssStream(ogg), ogg.length);
		data.write("NOPE", 0, "latin1");
		expect(
			await mokoProOggAudioFormat.detect(
				new BufferByteSource(data),
				"sound.dat",
			),
		).toBe(false);
	});
});
