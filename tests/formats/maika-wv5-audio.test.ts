import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodeWv5,
	maikaWv5AudioDescriptor,
	maikaWv5AudioFormat,
	readWv5Layout,
} from "../../packages/formats/src/maika/wv5-audio.js";

function wv5File(input: {
	channels?: number;
	sampleRate?: number;
	sampleCount?: number;
	chunkCount?: number;
	walk?: Buffer;
	word?: string;
}): Buffer {
	const head = Buffer.alloc(0x12, 0x00);
	head.write(input.word ?? "WV5A", 0, "latin1");
	head.writeUInt16LE(input.channels ?? 1, 4);
	head.writeUInt32LE(input.sampleRate ?? 22050, 6);
	head.writeInt32LE(input.sampleCount ?? 7, 0x0a);
	head.writeInt32LE(input.chunkCount ?? 3, 0x0e);
	return Buffer.concat([head, input.walk ?? Buffer.alloc(0)]);
}

/** The walk of the sound of the tests: three places that stand as they stand, two that stand the same way,
 * and two more that stand the same way. */
const WALK = Buffer.from([
	0x00, 0x03, 0x00, 0x01, 0x81, 0x02, 0x02, 0x03, 0x02, 0x00, 0x03,
]);

describe("Maika sound format", () => {
	it("reads the head of a sound", () => {
		expect(readWv5Layout(wv5File({}), 0x12)).toEqual({
			channels: 1,
			sampleRate: 22050,
			sampleCount: 7,
			chunkCount: 3,
		});
	});

	it("turns away a file whose head does not hold its own words", () => {
		expect(readWv5Layout(wv5File({ word: "WV5B" }), 0x12)).toBeUndefined();
		expect(readWv5Layout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("turns away a sound of no places of its own", () => {
		expect(readWv5Layout(wv5File({ channels: 0 }), 0x12)).toBeUndefined();
		expect(readWv5Layout(wv5File({ channels: 3 }), 0x12)).toBeUndefined();
		expect(readWv5Layout(wv5File({ sampleCount: 0 }), 0x12)).toBeUndefined();
		expect(readWv5Layout(wv5File({ chunkCount: 0 }), 0x12)).toBeUndefined();
		expect(readWv5Layout(wv5File({ sampleRate: 0 }), 0x12)).toBeUndefined();
	});

	it("stands the places of a sound beside the places before them", () => {
		// The three steps of the walk name three places that stand as they stand, two that stand the same
		// way, and two more that stand the same way.
		const file = wv5File({ walk: WALK });
		const layout = readWv5Layout(file, file.length);
		if (!layout) throw new Error("the sound stands in the file");
		const pcm = decodeWv5(file, layout);
		expect([...pcm]).toEqual([
			0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x04, 0x00, 0x07, 0x00,
			0x0a, 0x00,
		]);
	});

	it("stands the places of the colours of a sound one after the other", () => {
		const walk = Buffer.from([0x00, 0x04, 0x01, 0x01, 0x02, 0x01]);
		const file = wv5File({
			channels: 2,
			sampleCount: 2,
			chunkCount: 1,
			walk,
		});
		const layout = readWv5Layout(file, file.length);
		if (!layout) throw new Error("the sound stands in the file");
		expect([...decodeWv5(file, layout)]).toEqual([
			0x01, 0x00, 0x01, 0x00, 0x03, 0x00, 0x02, 0x00,
		]);
	});

	it("turns away a walk that stands outside the sound", () => {
		const short = wv5File({ walk: Buffer.from([0x00, 0x03, 0x00, 0x01]) });
		const layout = readWv5Layout(short, short.length);
		if (!layout) throw new Error("the sound stands in the file");
		expect(() => decodeWv5(short, layout)).toThrow();
		// A walk that names more places than the sound holds.
		const long = wv5File({ walk: Buffer.from([0x00, 0x02, 0x03, 0x04]) });
		const longLayout = readWv5Layout(long, long.length);
		if (!longLayout) throw new Error("the sound stands in the file");
		expect(() => decodeWv5(long, longLayout)).toThrow();
	});

	it("hands out the places of a sound as a wave", async () => {
		const file = wv5File({ walk: WALK });
		const handle = await maikaWv5AudioFormat.open(
			new BufferByteSource(file),
			"sound.wv5",
		);
		expect(handle.entries[0]?.path).toBe("sound.wav");
		expect(handle.metadata).toMatchObject({
			audio: "wav",
			channels: 1,
			sampleRate: 22050,
		});
		const wav = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(wav.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(wav.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(wav.readUInt16LE(0x16)).toBe(1);
		expect(wav.readUInt32LE(0x18)).toBe(22050);
		expect(wav.readUInt32LE(0x28)).toBe(14);
		expect([...wav.subarray(0x2c, 0x3a)]).toEqual([
			0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x02, 0x00, 0x04, 0x00, 0x07, 0x00,
			0x0a, 0x00,
		]);
	});

	it("finds a sound of its own kind", async () => {
		expect(maikaWv5AudioDescriptor.id).toBe("maika-wv5-audio");
		expect(maikaWv5AudioDescriptor.extensions).toEqual(["wv5"]);
		await expect(
			maikaWv5AudioFormat.detect(new BufferByteSource(wv5File({}))),
		).resolves.toBe(true);
		await expect(
			maikaWv5AudioFormat.detect(
				new BufferByteSource(Buffer.from("not a sound at all")),
			),
		).resolves.toBe(false);
	});
});
