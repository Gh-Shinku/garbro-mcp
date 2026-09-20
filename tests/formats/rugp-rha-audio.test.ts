import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	convertRhaToMp3,
	mp3FrameLength,
	readRhaSchema,
	rhaToMp3Header,
	rugpRhaAudioDescriptor,
	rugpRhaAudioFormat,
} from "../../packages/formats/src/rugp/rha-audio.js";

/** An rUGP engine sound of the plain kind: two steps whose heads name the places of a colour of a step of an
 * MPEG Layer 3 sound, worked out with an independent transcription of the reference's own walk. */
const PLAIN = Buffer.from(
	"100400070e151c232a31383f464d545b626970777e858c939aa1a8afb6bdc4cbd2d9e0" +
		"e7eef5fc030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0c7ce" +
		"d5dce3eaf1f8ff060d141b222930373e454c535a61686f767d848b9299a0a7aeb520" +
		"04000b16212c37424d58636e79848f9aa5b0bbc6d1dce7f2fd08131e29343f4a5560" +
		"6b76818c97a2adb8c3ced9e4effa05101b26313c47525d68737e89949faab5c0cbd6" +
		"e1ecf7020d18232e39444f5a65707b86919ca7b2bdc8d3dee9f4ff0a15202b36414c" +
		"57626d78838e99a4afbac5d0dbe6f1fc07121d28333e49545f",
	"hex",
);
const PLAIN_MP3 = Buffer.from(
	"fffb100400070e151c232a31383f464d545b626970777e858c939aa1a8afb6bdc4cbd2" +
		"d9e0e7eef5fc030a11181f262d343b424950575e656c737a81888f969da4abb2b9c0" +
		"c7ced5dce3eaf1f8ff060d141b222930373e454c535a61686f767d848b9299a0a7ae" +
		"b5fffb2004000b16212c37424d58636e79848f9aa5b0bbc6d1dce7f2fd08131e2934" +
		"3f4a55606b76818c97a2adb8c3ced9e4effa05101b26313c47525d68737e89949faa" +
		"b5c0cbd6e1ecf7020d18232e39444f5a65707b86919ca7b2bdc8d3dee9f4ff0a1520" +
		"2b36414c57626d78838e99a4afbac5d0dbe6f1fc07121d28333e49545f",
	"hex",
);

/** An rUGP engine sound whose steps stand behind heads of the engine's own: the places of a colour of the
 * first step stand at nought, and those of the second stand as the places of the highest kind. */
const OWN = Buffer.from(
	"010b12100800000306090c0f1215181b1e2124272a2d303336393c3f4245484b4e5154" +
		"575a5d606366696c6f7275787b7e8184878a8d909396999c9fa2a5a8abaeb1b4b7ba" +
		"bdc0c3c6c9cccfd2d5d8dbdee1e4e7eaedf0f3f6f9fcff0205080b0e111422181000" +
		"00050a0f14191e23282d32373c41464b50555a5f64696e73787d82878c91969ba0a5" +
		"aaafb4b9bec3c8cdd2d7dce1e6ebf0f5faff04090e13181d22272c31363b40454a4f" +
		"54595e63686d72777c81868b90959a9fa4",
	"hex",
);
const OWN_MP3 = Buffer.from(
	"fff34204000306090c0f1215181b1e2124272a2d303336393c3f4245484b4e5154575a" +
		"5d606366696c6f7275787b7e8184878a8d909396999c9fa2a5a8abaeb1b4b7babdc0" +
		"c3c6c9cccfd2d5d8dbdee1e4e7eaedf0f3f6f9fcff0205080b0e1114000000000000" +
		"0000fff3428400050a0f14191e23282d32373c41464b50555a5f64696e73787d8287" +
		"8c91969ba0a5aaafb4b9bec3c8cdd2d7dce1e6ebf0f5faff04090e13181d22272c31" +
		"363b40454a4f54595e63686d72777c81868b90959a9fa4ffffffffffffffffffffffff" +
		"ffffffff",
	"hex",
);

describe("rUGP engine compressed audio", () => {
	it("stands the places of a head of its own as the places of an MPEG Layer 3 head", () => {
		expect(rhaToMp3Header(0x9210)).toBe(0xfff34204);
		expect(rhaToMp3Header(0x0abc)).toBe(0xfffb56c4);
		expect(rhaToMp3Header(0x0004)).toBe(0xfff30044);
	});

	it("counts the places of colour a step of a sound stands as", () => {
		expect(mp3FrameLength(0xfff34204)).toBe(101);
		expect(mp3FrameLength(0xfffb9210)).toBe(414);
		expect(mp3FrameLength(0xfffb56c4)).toBe(189);
		expect(mp3FrameLength(0xfff30044)).toBe(0);
	});

	it("reads the way the places of a sound stand", () => {
		expect(readRhaSchema(PLAIN, PLAIN.length)).toBe(0);
		expect(readRhaSchema(OWN, OWN.length)).toBe(0x10b);
		expect(readRhaSchema(Buffer.from("0100", "hex"), 2)).toBeUndefined();
		expect(readRhaSchema(Buffer.alloc(1), 1)).toBeUndefined();
	});

	it("stands the places of a sound of the plain kind as a sound of its own", () => {
		expect(convertRhaToMp3(PLAIN, PLAIN.length)).toEqual(PLAIN_MP3);
	});

	it("stands the places of a sound whose steps carry heads of their own", () => {
		expect(convertRhaToMp3(OWN, OWN.length)).toEqual(OWN_MP3);
	});

	it("turns away a sound whose places are not those of a sound", () => {
		expect(convertRhaToMp3(Buffer.from("0100", "hex"), 2)).toBeUndefined();
		// A head whose places of a colour name none of a step of the sound.
		expect(convertRhaToMp3(Buffer.from("00040000", "hex"), 4)).toBeUndefined();
		// A sound whose places stand short of a whole step.
		expect(
			convertRhaToMp3(Buffer.from("1004000000", "hex"), 5),
		).toBeUndefined();
	});

	it("hands out the places of a sound as a sound of its own", async () => {
		const handle = await rugpRhaAudioFormat.open(
			new BufferByteSource(OWN),
			"sound.rha",
		);
		expect(handle.entries[0]?.path).toBe("sound.mp3");
		expect(handle.entries[0]?.metadata).toMatchObject({ type: "audio" });
		expect(handle.metadata).toMatchObject({ audio: "mp3" });
		const body = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(body).toEqual(OWN_MP3);
	});

	it("stands after every kind of sound that is told by a word of its own", () => {
		expect(rugpRhaAudioDescriptor.id).toBe("rugp-rha-audio");
		expect(rugpRhaAudioFormat.detection).toEqual({
			signatures: [],
			priority: -1,
		});
	});

	it("finds a sound of its own kind", async () => {
		await expect(
			rugpRhaAudioFormat.detect(new BufferByteSource(PLAIN)),
		).resolves.toBe(true);
		await expect(
			rugpRhaAudioFormat.detect(
				new BufferByteSource(Buffer.from("not a sound at all")),
			),
		).resolves.toBe(false);
	});
});
