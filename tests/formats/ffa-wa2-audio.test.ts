import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeWa2,
	ffaWa2AudioFormat,
	readWa2Layout,
} from "../../packages/formats/src/ffa/wa2-audio.js";

/** The bytes of a sound, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}

/** A sound: the head of forty four bytes and the walk of its samples behind it. */
function wa2File(input: {
	pcmSize: number;
	body: Buffer;
	rate?: number;
	channels?: number;
	bits?: number;
	formatTag?: number;
	mark?: string;
	shape?: string;
}): Buffer {
	const head = Buffer.alloc(0x2c, 0x00);
	Buffer.from(input.mark ?? "APCM", "latin1").copy(head, 0);
	Buffer.from(input.shape ?? "WAVEfmt ", "latin1").copy(head, 8);
	head.writeUInt16LE(input.formatTag ?? 1, 0x14);
	head.writeUInt16LE(input.channels ?? 1, 0x16);
	head.writeUInt32LE(input.rate ?? 22050, 0x18);
	head.writeUInt32LE((input.rate ?? 22050) * 2, 0x1c);
	head.writeUInt16LE(2, 0x20);
	head.writeUInt16LE(input.bits ?? 16, 0x22);
	head.writeUInt32LE(input.pcmSize, 0x28);
	return Buffer.concat([head, input.body]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await ffaWa2AudioFormat.open(
		new BufferByteSource(data),
		"sound.wa2",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("FFA System PCM audio", () => {
	it("reads the head as the reference does", () => {
		const data = wa2File({ pcmSize: 4, body: Buffer.from([0x00, 0x00]) });
		expect(readWa2Layout(data)).toEqual({
			pcmSize: 4,
			formatTag: 1,
			channels: 1,
			sampleRate: 22050,
			averageBytesPerSecond: 44100,
			blockAlign: 2,
			bitsPerSample: 16,
			dataOffset: 0x2c,
		});
	});

	it("gates on the word, the shape and the sizes", () => {
		const good = wa2File({ pcmSize: 4, body: Buffer.from([0x00, 0x00]) });
		expect(readWa2Layout(good)).toBeDefined();
		expect(
			readWa2Layout(
				wa2File({ pcmSize: 4, body: Buffer.from([0x00, 0x00]), mark: "APCX" }),
			),
		).toBeUndefined();
		// The head has to carry the shape of a wave file.
		expect(
			readWa2Layout(
				wa2File({
					pcmSize: 4,
					body: Buffer.from([0x00, 0x00]),
					shape: "WAVefmt ",
				}),
			),
		).toBeUndefined();
		expect(
			readWa2Layout(wa2File({ pcmSize: 0, body: Buffer.alloc(0) })),
		).toBeUndefined();
	});

	it("walks the samples a nibble at a time", () => {
		// Every byte holds two places, the higher one first. The first place of the first byte stands at
		// nought, so the sample climbs by the step the walk stands at, and the walk itself moves along where
		// the table of the two walks says it stands above a hundred and twenty seven.
		const data = wa2File({
			pcmSize: 12,
			body: Buffer.from([0x00, 0x80, 0x40]),
		});
		const layout = readWa2Layout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeWa2(data, layout).toString("hex")).toBe(
			hex([15, 0, 30, 0, 15, 0, 30, 0, 172, 0, 191, 0]),
		);
	});

	it("makes a sample fall where the highest place of a code stands", () => {
		// Every byte of the walk holds two places and every place of this walk stands at fifteen, the whole
		// of its four bits, so the sample falls by the step the walk stands at every time — and the step
		// itself climbs with every fall. The four samples are worked out place by place: 238, 568, 1357 and
		// 3243, every one of them falling from the one before.
		const data = wa2File({
			pcmSize: 8,
			body: Buffer.from([0xff, 0xff, 0xff, 0xff]),
		});
		const layout = readWa2Layout(data);
		if (!layout) throw new Error("no layout");
		const out = decodeWa2(data, layout);
		expect(
			Array.from({ length: 4 }, (_, index) => out.readInt16LE(index * 2)),
		).toEqual([-238, -806, -2163, -5406]);
	});

	it("stops where the file does", () => {
		// A sound of four samples whose walk gives only one byte: the rest of it stands as nought.
		const data = wa2File({ pcmSize: 8, body: Buffer.from([0x00]) });
		const layout = readWa2Layout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeWa2(data, layout).toString("hex")).toBe(
			hex([15, 0, 30, 0, 0, 0, 0, 0]),
		);
	});

	it("writes a sound out as a wave", async () => {
		const data = wa2File({
			pcmSize: 12,
			body: Buffer.from([0x00, 0x80, 0x40]),
			rate: 44100,
			channels: 2,
		});
		const out = await extract(data);
		expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(out.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(out.readUInt16LE(0x14)).toBe(1);
		expect(out.readUInt16LE(0x16)).toBe(2);
		expect(out.readUInt32LE(0x18)).toBe(44100);
		expect(out.readUInt16LE(0x22)).toBe(16);
		expect(out.readUInt32LE(0x28)).toBe(12);
		expect(out.subarray(0x2c).toString("hex")).toBe(
			hex([15, 0, 30, 0, 15, 0, 30, 0, 172, 0, 191, 0]),
		);
	});

	it("declines a file that does not hold a sound", async () => {
		const data = wa2File({
			pcmSize: 4,
			body: Buffer.from([0x00, 0x00]),
			mark: "APCX",
		});
		await expect(
			ffaWa2AudioFormat.open(new BufferByteSource(data), "sound.wa2"),
		).rejects.toThrow(GarbroError);
		await expect(
			ffaWa2AudioFormat.open(new BufferByteSource(data), "sound.wa2"),
		).rejects.toThrow("Not an FFA System sound");
	});
});
