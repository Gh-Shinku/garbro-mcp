import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	adp4Kind,
	decodeAdp4,
	gameSystemAdp4AudioFormat,
	readAdp4Layout,
} from "../../packages/formats/src/gamesystem/adp4-audio.js";

/** The bytes of a sound, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}

/** A sound of the first kind: the count of its steps and then the walk of its samples. */
function adp4File(input: {
	sampleCount: number;
	body: Buffer;
	kind?: string;
}): Buffer {
	const head = Buffer.alloc(4, 0x00);
	head.writeInt32LE(input.sampleCount, 0);
	void input.kind;
	return Buffer.concat([head, input.body]);
}

/** A sound of the second kind: the place of its second word, that word, and then the walk of its samples. */
function adpsFile(input: { sampleCount: number; body: Buffer }): Buffer {
	const head = Buffer.alloc(8, 0x00);
	// The first word is where the second one stands, which is what the walk of this kind begins behind.
	head.writeInt32LE(0, 0);
	const count = Buffer.alloc(4, 0x00);
	count.writeInt32LE(input.sampleCount, 0);
	return Buffer.concat([head, count, input.body]);
}

async function extract(data: Buffer, sourcePath: string): Promise<Buffer> {
	const handle = await gameSystemAdp4AudioFormat.open(
		new BufferByteSource(data),
		sourcePath,
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("'GameSystem' compressed audio", () => {
	it("reads the head of both kinds", () => {
		const first = adp4File({ sampleCount: 4, body: Buffer.alloc(8, 0x00) });
		expect(readAdp4Layout(first, "sound.adp4")).toEqual({
			kind: "adp4",
			sampleCount: 4,
			dataOffset: 4,
		});
		// The first word of the second kind is where its second word stands, and the walk begins behind it.
		const second = adpsFile({ sampleCount: 2, body: Buffer.alloc(4, 0x00) });
		expect(readAdp4Layout(second, "sound.adps")).toEqual({
			kind: "adps",
			sampleCount: 2,
			dataOffset: 12,
		});
	});

	it("takes the kind of a sound from its name", () => {
		expect(adp4Kind("sound.adp4")).toBe("adp4");
		expect(adp4Kind("a/b/SOUND_ADPS.ADPS")).toBe("adps");
		expect(adp4Kind("sound.wav")).toBe("wav");
		const data = adp4File({ sampleCount: 2, body: Buffer.alloc(4, 0x00) });
		expect(readAdp4Layout(data, "sound.adp4")).toBeDefined();
		expect(readAdp4Layout(data, "sound.wav")).toBeUndefined();
		// A file of four bytes or less holds nothing at all.
		expect(readAdp4Layout(Buffer.alloc(4, 0x00), "sound.adp4")).toBeUndefined();
	});

	it("walks the samples of the first kind", () => {
		// A control whose lowest place does not stand is a run of steps: the count stands in one byte where
		// its highest place stands, and every step is a byte of the walk exclusive ored with a key that
		// climbs with every byte read.
		const data = adp4File({
			sampleCount: 2,
			body: Buffer.from([0x00, 0x81, 0x11, 0x22]),
		});
		const layout = readAdp4Layout(data, "sound.adp4");
		if (!layout) throw new Error("no layout");
		// Two steps of a byte and two bytes: the first byte holds the four places of two steps and the
		// second the same again, so the samples climb by two, four, ten and fourteen.
		expect(decodeAdp4(data, layout).toString("hex")).toBe(
			hex([
				0x02, 0x00, 0x02, 0x00, 0x04, 0x00, 0x04, 0x00, 0x0a, 0x00, 0x0a, 0x00,
				0x0e, 0x00, 0x0e, 0x00,
			]),
		);
	});

	it("passes over a run of silence", () => {
		// A control whose lowest place stands is a run of silence: the steps it names stand as nought.
		const data = adp4File({
			sampleCount: 2,
			body: Buffer.from([0x01, 0x81]),
		});
		const layout = readAdp4Layout(data, "sound.adp4");
		if (!layout) throw new Error("no layout");
		expect(decodeAdp4(data, layout).toString("hex")).toBe(
			hex(new Array(16).fill(0x00)),
		);
	});

	it("walks the samples of the second kind, both channels at once", () => {
		// Every word holds two steps and both channels of each: the left channel in the four lower places
		// of the first step and the right in the four above them, and then the same again.
		const data = adpsFile({
			sampleCount: 2,
			body: Buffer.from([0x11, 0x01]),
		});
		const layout = readAdp4Layout(data, "sound.adps");
		if (!layout) throw new Error("no layout");
		// The word holds the four lower places of a step for the left channel and the four above them for
		// the right, and then the same two again in the places above those: with the word `0x0111` the left
		// channel climbs by two and then by four and the right by two and then by two, the two channels
		// standing together in one word of four bytes, the left first and the right behind it.
		expect(decodeAdp4(data, layout).toString("hex")).toBe(
			hex([
				0x02, 0x00, 0x02, 0x00, 0x04, 0x00, 0x02, 0x00, 0x00, 0x00, 0x00, 0x00,
				0x00, 0x00, 0x00, 0x00,
			]),
		);
	});

	it("writes a sound out as a wave", async () => {
		const data = adp4File({
			sampleCount: 2,
			body: Buffer.from([0x00, 0x81, 0x11, 0x22]),
		});
		const out = await extract(data, "sound.adp4");
		expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(out.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(out.readUInt16LE(0x14)).toBe(1);
		expect(out.readUInt16LE(0x16)).toBe(2);
		expect(out.readUInt32LE(0x18)).toBe(44100);
		expect(out.readUInt16LE(0x20)).toBe(4);
		expect(out.readUInt16LE(0x22)).toBe(16);
		expect(out.readUInt32LE(0x28)).toBe(16);
		expect(out.subarray(0x2c).toString("hex")).toBe(
			hex([
				0x02, 0x00, 0x02, 0x00, 0x04, 0x00, 0x04, 0x00, 0x0a, 0x00, 0x0a, 0x00,
				0x0e, 0x00, 0x0e, 0x00,
			]),
		);
	});

	it("turns a walk that runs out of the sound away", () => {
		const data = adp4File({ sampleCount: 4, body: Buffer.from([0x00]) });
		const layout = readAdp4Layout(data, "sound.adp4");
		if (!layout) throw new Error("no layout");
		expect(() => decodeAdp4(data, layout)).toThrow(GarbroError);
		expect(() => decodeAdp4(data, layout)).toThrow(
			"'GameSystem' sound is cut short of its walk",
		);
	});

	it("declines a file that does not hold a sound", async () => {
		const data = Buffer.alloc(4, 0x00);
		await expect(
			gameSystemAdp4AudioFormat.open(new BufferByteSource(data), "sound.adp4"),
		).rejects.toThrow(GarbroError);
		await expect(
			gameSystemAdp4AudioFormat.open(new BufferByteSource(data), "sound.adp4"),
		).rejects.toThrow("Not a 'GameSystem' sound");
	});
});
