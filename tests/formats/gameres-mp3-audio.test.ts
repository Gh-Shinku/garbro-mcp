import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	gameresMp3AudioFormat,
	looksLikeMp3,
	skipId3Tag,
} from "../../packages/formats/src/gameres/mp3-audio.js";

/** A frame of the stream: the sync word, two of whose bits the reference tests, and a nibble it refuses. */
const FRAME = Buffer.from([0xff, 0xe2, 0x90, 0x00]);

function id3Tag(size: number, version = 3, flags = 0x00): Buffer {
	const tag: Buffer = Buffer.alloc(10, 0);
	tag.write("ID3", 0, "latin1");
	tag[3] = version;
	tag[5] = flags;
	tag[6] = (size >> 21) & 0x7f;
	tag[7] = (size >> 14) & 0x7f;
	tag[8] = (size >> 7) & 0x7f;
	tag[9] = size & 0x7f;
	return tag;
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.mp3"): Promise<Buffer> {
	const handle = await gameresMp3AudioFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("MPEG Layer 3 audio format", () => {
	it("finds a stream that starts with a frame", async () => {
		const data: Buffer = Buffer.concat([FRAME, Buffer.alloc(64, 0x11)]);
		expect(await gameresMp3AudioFormat.detect(sourceOf(data), "cg.mp3")).toBe(
			true,
		);
	});

	it("walks over the tag the stream may carry in front of it", async () => {
		const tag = id3Tag(0x100);
		const data: Buffer = Buffer.concat([tag, Buffer.alloc(0x100, 0), FRAME]);
		expect(await gameresMp3AudioFormat.detect(sourceOf(data))).toBe(true);
		// A tag of a version past the third with its footer flag set is ten bytes longer than it says.
		const withFooter = id3Tag(0x100, 4, 0x10);
		expect(skipId3Tag(withFooter)).toBe(10 + 0x100 + 10);
		const footed: Buffer = Buffer.concat([
			withFooter,
			Buffer.alloc(0x100 + 10, 0),
			FRAME,
		]);
		expect(await gameresMp3AudioFormat.detect(sourceOf(footed))).toBe(true);
		// And one whose length does not reach a frame is not a stream this format claims.
		const short: Buffer = Buffer.concat([id3Tag(0x100), Buffer.alloc(0x40, 0)]);
		expect(await gameresMp3AudioFormat.detect(sourceOf(short))).toBe(false);
	});

	it("looks for the sync word of a frame a little way in", async () => {
		const data: Buffer = Buffer.concat([
			Buffer.alloc(5, 0x00),
			FRAME,
			Buffer.alloc(0x300, 0x11),
		]);
		expect(await gameresMp3AudioFormat.detect(sourceOf(data))).toBe(true);
		// Past the window the reference looks in — one byte short of its end and four more — the frame of the
		// stream is not found.
		const late: Buffer = Buffer.concat([
			Buffer.alloc(0x300, 0x00),
			FRAME,
			Buffer.alloc(0x100, 0x11),
		]);
		expect(await gameresMp3AudioFormat.detect(sourceOf(late))).toBe(false);
		// The last byte of the window is still looked at.
		const last: Buffer = Buffer.concat([
			Buffer.alloc(0x2fb, 0x00),
			FRAME,
			Buffer.alloc(0x100, 0x11),
		]);
		expect(await gameresMp3AudioFormat.detect(sourceOf(last))).toBe(true);
	});

	it("declines a file whose bytes do not read as a frame", async () => {
		for (const bad of [
			Buffer.alloc(64, 0x41),
			// The second byte must carry the two bits the reference asks for.
			Buffer.from([0xff, 0xe0, 0x90, 0x00]),
			// And the third must not carry the reserved nibble.
			Buffer.from([0xff, 0xe2, 0xf0, 0x00]),
		]) {
			expect(looksLikeMp3(bad)).toBe(false);
			expect(await gameresMp3AudioFormat.detect(sourceOf(bad))).toBe(false);
		}
	});

	it("declines a file too short to hold a frame", async () => {
		expect(
			await gameresMp3AudioFormat.detect(sourceOf(Buffer.alloc(9, 0))),
		).toBe(false);
		expect(
			await gameresMp3AudioFormat.detect(sourceOf(Buffer.from([0x00, 0xff]))),
		).toBe(false);
	});

	it("hands the stream out as it stands", async () => {
		const data: Buffer = Buffer.concat([
			id3Tag(0x20),
			Buffer.alloc(0x20, 0),
			FRAME,
			Buffer.alloc(32, 0x5a),
		]);
		const handle = await gameresMp3AudioFormat.open(
			sourceOf(data),
			"dir/cg.dat",
		);
		expect(handle.entries[0]?.path).toBe("cg.mp3");
		expect(handle.entries[0]?.metadata).toMatchObject({ type: "audio" });
		expect(await extract(data)).toEqual(data);
	});
});
