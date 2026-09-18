import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	crossNetAdpAudioFormat,
	decodeCrossNetAdp,
	readCrossNetAdpLayout,
} from "../../packages/formats/src/crossnet/adp-audio.js";

/** A wave of the engine's own codec: the head and then the sections. */
function adpFile(input: {
	channels: number;
	sampleRate?: number;
	payload: Buffer;
	shift?: number;
	codec?: number;
}): Buffer {
	const head = Buffer.alloc(0x24, 0x00);
	Buffer.from("RIFF", "latin1").copy(head, 0);
	Buffer.from("WAVEfmt ", "latin1").copy(head, 8);
	head.writeUInt32LE(16, 0x10);
	head.writeUInt16LE(input.codec ?? 0xffff, 0x14);
	head.writeUInt16LE(input.channels, 0x16);
	head.writeUInt32LE(input.sampleRate ?? 44100, 0x18);
	const sections: Buffer[] = [];
	if (input.shift !== undefined) {
		const shift = Buffer.alloc(12, 0x00);
		Buffer.from("shft", "latin1").copy(shift, 0);
		shift.writeUInt32LE(4, 4);
		shift.writeInt32LE(input.shift, 8);
		sections.push(shift);
	}
	const data = Buffer.alloc(8, 0x00);
	Buffer.from("data", "latin1").copy(data, 0);
	data.writeUInt32LE(input.payload.length, 4);
	sections.push(data, input.payload);
	return Buffer.concat([head, ...sections]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await crossNetAdpAudioFormat.open(
		new BufferByteSource(data),
		"sound.adp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("CrossNet audio", () => {
	it("reads the head and the sections as the reference does", () => {
		const data = adpFile({
			channels: 1,
			payload: Buffer.from([0x53]),
		});
		expect(readCrossNetAdpLayout(data)).toEqual({
			sampleRate: 44100,
			channels: 1,
			shift: 2,
			samples: 2,
			dataOffset: 0x2c,
			dataSize: 1,
			dataLength: 1,
		});
		// The `shft` section stands before the data and changes the step of the walk.
		const shifted = adpFile({
			channels: 1,
			payload: Buffer.from([0x53]),
			shift: 3,
		});
		expect(readCrossNetAdpLayout(shifted)).toMatchObject({
			shift: 3,
			dataOffset: 0x38,
		});
	});

	it("gates on the wave marks, the codec, the channels and the sections", () => {
		const good = adpFile({ channels: 1, payload: Buffer.from([0x53]) });
		expect(readCrossNetAdpLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("RIFG", 0, "latin1");
		expect(readCrossNetAdpLayout(mark)).toBeUndefined();
		const wave = Buffer.from(good);
		wave.write("WAVGfmt ", 8, "latin1");
		expect(readCrossNetAdpLayout(wave)).toBeUndefined();
		const codec = Buffer.from(good);
		codec.writeUInt16LE(1, 0x14);
		expect(readCrossNetAdpLayout(codec)).toBeUndefined();
		const channels = Buffer.from(good);
		channels.writeUInt16LE(3, 0x16);
		expect(readCrossNetAdpLayout(channels)).toBeUndefined();
	});

	it("asks for the name to end in `adp` as well", async () => {
		const data = adpFile({ channels: 1, payload: Buffer.from([0x53]) });
		expect(
			await crossNetAdpAudioFormat.detect(
				new BufferByteSource(data),
				"sound.adp",
			),
		).toBe(true);
		expect(
			await crossNetAdpAudioFormat.detect(
				new BufferByteSource(data),
				"sound.wav",
			),
		).toBe(false);
	});

	it("decodes the lower nibble of a byte before the higher one", () => {
		const stored = Buffer.from([0x53]);
		const layout = {
			sampleRate: 44100,
			channels: 1,
			shift: 2,
			samples: 2,
			dataOffset: 0,
			dataSize: 1,
			dataLength: 1,
		};
		expect(decodeCrossNetAdp(stored, layout).toString("hex")).toBe("c0018004");
	});

	it("writes a sound of one channel out again", async () => {
		const out = await extract(
			adpFile({ channels: 1, payload: Buffer.from([0x53]) }),
		);
		expect(out.toString("latin1", 0, 4)).toBe("RIFF");
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(44100);
		expect(out.readUInt16LE(0x22)).toBe(16);
		expect(out.readUInt32LE(0x28)).toBe(4);
		expect(out.subarray(0x2c).toString("hex")).toBe("c0018004");
	});

	it("gives a whole byte to each walk of a sound of two channels", async () => {
		const out = await extract(
			adpFile({ channels: 2, payload: Buffer.from([0x53, 0x10]) }),
		);
		expect(out.readUInt16LE(0x16)).toBe(2);
		expect(out.readUInt32LE(0x28)).toBe(8);
		// The two samples of a frame stand in the order left, right.
		expect(out.subarray(0x2c).toString("hex")).toBe("c001400080040001");
	});

	it("takes the step of the walk from the `shft` section", async () => {
		const out = await extract(
			adpFile({
				channels: 1,
				payload: Buffer.from([0x53]),
				shift: 3,
			}),
		);
		expect(out.subarray(0x2c).toString("hex")).toBe("80030009");
	});

	it("declines a file that does not hold a sound", async () => {
		const data = adpFile({
			channels: 1,
			payload: Buffer.from([0x53]),
			codec: 1,
		});
		await expect(
			crossNetAdpAudioFormat.open(new BufferByteSource(data), "sound.adp"),
		).rejects.toThrow(GarbroError);
		await expect(
			crossNetAdpAudioFormat.open(new BufferByteSource(data), "sound.adp"),
		).rejects.toThrow("Not a CrossNet sound");
	});
});
