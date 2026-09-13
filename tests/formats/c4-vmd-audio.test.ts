import { BufferByteSource } from "@garbro-mcp/core";
import { vmdAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const KEY = 0xe5;
/** An MP3 header survives the key: sync, version/layer bits and a usable bitrate index. */
const HEADER = Buffer.from([0xff, 0xe2, 0x80]);
const BODY = Buffer.alloc(0x30, 0x77);

/** The mask is its own inverse. */
function mask(input: Buffer): Buffer {
	const output: Buffer = Buffer.alloc(input.length);
	for (let i = 0; i < input.length; i += 1) output[i] = (input[i] ?? 0) ^ KEY;
	return output;
}

function buildVmd(): Buffer {
	return mask(Buffer.concat([HEADER, BODY]));
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("c4 vmd audio", () => {
	it("detects a masked mp3 stream", async () => {
		expect(await vmdAudioFormat.detect(sourceOf(buildVmd()), "TRACK.VMD")).toBe(
			true,
		);
	});

	it("unmasks the whole file", async () => {
		const file = buildVmd();
		const source = sourceOf(file);
		const archive = await vmdAudioFormat.open(source, "TRACK.VMD");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["TRACK.mp3"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "mp3", key: KEY });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// The mask preserves the length.
			expect(Number(entry.size)).toBe(file.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.concat([HEADER, BODY]),
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without a frame sync", async () => {
		const file = buildVmd();
		file[0] = 0xfe ^ KEY;
		expect(await vmdAudioFormat.detect(sourceOf(file), "TRACK.VMD")).toBe(
			false,
		);
	});

	it("declines a file with an unusable bitrate index", async () => {
		const file = buildVmd();
		file[2] = 0xf0 ^ KEY;
		expect(await vmdAudioFormat.detect(sourceOf(file), "TRACK.VMD")).toBe(
			false,
		);
	});

	it("declines a file that is too short", async () => {
		expect(
			await vmdAudioFormat.detect(sourceOf(Buffer.alloc(2)), "TRACK.VMD"),
		).toBe(false);
	});
});
