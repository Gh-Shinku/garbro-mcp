import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	blackCycVawAudioDescriptor,
	blackCycVawAudioFormat,
	decodeVaw,
	readVawHeader,
	readVawSound,
} from "../../packages/formats/src/black-cyc/vaw-audio.js";

function vawHead(input: { kind?: string }): Buffer {
	const head = Buffer.alloc(0x40, 0x00);
	head.write(
		(input.kind ?? "PACKTYPE=1").padEnd(0x10).slice(0, 0x10),
		0x30,
		"latin1",
	);
	return head;
}

const OWN = Buffer.from(
	"0000000000000000000000000000000000000000000000000000000000000000" +
		"000000000000000000000000000000005041434b545950453d31202020202020" +
		"524946463000000057415645666d742018000000010001002256000044ac0000" +
		"02001000646174610c00000040432f61e010",
	"hex",
);
const PCM = Buffer.from("00000b000300060008ff01ff", "hex");

describe("Black Cyc audio format", () => {
	it("reads the head of a file", () => {
		expect(readVawHeader(OWN, OWN.length)).toEqual({
			packType: 1,
			hasOwnPlaces: false,
		});
		const marked = vawHead({ kind: "PACKTYPE=2A" });
		expect(readVawHeader(marked, 0x40)).toEqual({
			packType: 2,
			hasOwnPlaces: true,
		});
	});

	it("turns away a file whose head names no kind of its own", () => {
		expect(readVawHeader(Buffer.alloc(0x40), 0x40)).toBeUndefined();
		expect(
			readVawHeader(vawHead({ kind: "PACKTYPE=  " }), 0x40),
		).toBeUndefined();
		expect(readVawHeader(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("reads where the places of a sound stand", () => {
		const header = readVawHeader(OWN, OWN.length);
		if (!header) throw new Error("the head stands in the file");
		expect(readVawSound(OWN, header, OWN.length)).toEqual({
			kind: 1,
			offset: 0x40,
		});
	});

	it("turns away a sound of a kind the reference does not read", () => {
		for (const kind of ["PACKTYPE=3", "PACKTYPE=5", "PACKTYPE=99"]) {
			const head = vawHead({ kind });
			const header = readVawHeader(head, 0x40);
			if (!header) throw new Error("the head stands in the file");
			expect(readVawSound(head, header, 0x40)).toBeUndefined();
		}
	});

	it("turns away a sound whose places do not stand where its kind names them", () => {
		// A wave of the first kind stands behind the head as a wave of the plain kind.
		const plain = vawHead({ kind: "PACKTYPE=0" });
		const plainHeader = readVawHeader(plain, 0x40);
		if (!plainHeader) throw new Error("the head stands in the file");
		expect(readVawSound(plain, plainHeader, 0x40)).toBeUndefined();
		// A sound of the kind behind a word of its own stands behind the word `OGG `.
		const ogg = vawHead({ kind: "PACKTYPE=6" });
		const oggHeader = readVawHeader(ogg, 0x40);
		if (!oggHeader) throw new Error("the head stands in the file");
		expect(readVawSound(ogg, oggHeader, 0x40)).toBeUndefined();
	});

	it("stands the places of a sound beside the places before them", () => {
		expect(decodeVaw(OWN, 0x40, OWN.length).subarray(0x2c)).toEqual(PCM);
	});

	it("stands the places of a walk that stops behind the sound as the places before them", () => {
		// The reference reads no places at the end of its own walk and stands the place before every place
		// that names none, so a walk that stops behind the sound stands a sound of its own.
		const short = Buffer.from(OWN.subarray(0, 0x40 + 0x2c + 2));
		const pcm = decodeVaw(short, 0x40, short.length);
		expect([...pcm.subarray(0x2c)]).toEqual([
			0x00, 0x00, 0x0b, 0x00, 0x03, 0x00, 0x03, 0x00, 0x03, 0x00, 0x03, 0x00,
		]);
	});

	it("hands out the places of a sound as a wave", async () => {
		const handle = await blackCycVawAudioFormat.open(
			new BufferByteSource(OWN),
			"sound.vaw",
		);
		expect(handle.entries[0]?.path).toBe("sound.wav");
		expect(handle.metadata).toMatchObject({ audio: "wav", packType: 1 });
		const wav = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(wav.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(wav.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(wav.readUInt16LE(0x16)).toBe(1);
		expect(wav.readUInt32LE(0x18)).toBe(22050);
		expect(wav.subarray(0x2c)).toEqual(PCM);
	});

	it("hands out a sound of the kinds that stand as a sound of their own", async () => {
		const body = Buffer.concat([Buffer.alloc(0x6c, 0x00), Buffer.from("OggS")]);
		body.write("PACKTYPE=2      ", 0x30, "latin1");
		const handle = await blackCycVawAudioFormat.open(
			new BufferByteSource(body),
			"sound.vaw",
		);
		expect(handle.entries[0]?.path).toBe("sound.ogg");
		expect(handle.metadata).toMatchObject({ audio: "ogg", packType: 2 });
		const ogg = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(ogg.subarray(0, 4).toString("latin1")).toBe("OggS");
	});

	it("stands after every kind of sound that is told by a word of its own", async () => {
		expect(blackCycVawAudioDescriptor.id).toBe("black-cyc-vaw-audio");
		expect(blackCycVawAudioDescriptor.extensions).toEqual(["vaw", "wgq"]);
		await expect(
			blackCycVawAudioFormat.detect(new BufferByteSource(OWN)),
		).resolves.toBe(true);
		await expect(
			blackCycVawAudioFormat.detect(new BufferByteSource(Buffer.alloc(0x40))),
		).resolves.toBe(false);
		expect(blackCycVawAudioFormat.detection).toEqual({
			signatures: [],
			priority: -1,
		});
	});
});
