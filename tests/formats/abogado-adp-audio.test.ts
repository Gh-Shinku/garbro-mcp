import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	abogadoAdpAudioFormat,
	decodeAbogadoAdp,
	readAbogadoAdpLayout,
} from "../../packages/formats/src/abogado/adp-audio.js";

/** A sound: the head and the stream of nibbles. */
function adpFile(input: {
	channels: number;
	samples: number;
	sampleRate?: number;
	stream: Buffer;
	start?: number;
	headSize?: number;
}): Buffer {
	const head = Buffer.alloc(input.headSize ?? 0xc4, 0x00);
	head.writeUInt32LE(input.sampleRate ?? 44100, 0x00);
	head.writeUInt16LE(input.channels, 0x04);
	head.writeInt32LE(input.samples, 0xbc);
	head.writeInt32LE(input.start ?? head.length, 0xc0);
	return Buffer.concat([head, input.stream]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await abogadoAdpAudioFormat.open(
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

describe("AbogadoPowers audio", () => {
	it("reads the head as the reference does", () => {
		const data = adpFile({
			channels: 2,
			samples: 2,
			stream: Buffer.from([0x53, 0x00]),
		});
		// The count of the head already covers both channels, so the stream is half of it in bytes.
		expect(readAbogadoAdpLayout(data)).toEqual({
			sampleRate: 44100,
			channels: 2,
			samples: 4,
			startOffset: 0xc4,
			dataLength: 2,
		});
	});

	it("gates on the rate, the channels, the samples and the place", () => {
		const good = adpFile({
			channels: 1,
			samples: 2,
			stream: Buffer.from([0x53]),
		});
		expect(readAbogadoAdpLayout(good)).toBeDefined();
		const rate = Buffer.from(good);
		rate.writeUInt32LE(1000, 0x00);
		expect(readAbogadoAdpLayout(rate)).toBeUndefined();
		const channels = Buffer.from(good);
		channels.writeUInt16LE(3, 0x04);
		expect(readAbogadoAdpLayout(channels)).toBeUndefined();
		const none = Buffer.from(good);
		none.writeInt32LE(0, 0xbc);
		expect(readAbogadoAdpLayout(none)).toBeUndefined();
		const far = Buffer.from(good);
		far.writeInt32LE(0x1000, 0xc0);
		expect(readAbogadoAdpLayout(far)).toBeUndefined();
	});

	it("decodes one step of the engine's own ADPCM", () => {
		// The first nibble leaves the quantiser where the table puts it, and the second takes its turn from
		// the quantiser the first left behind.
		const geometry = {
			sampleRate: 44100,
			channels: 1,
			samples: 2,
			startOffset: 0,
			dataLength: 1,
		};
		expect(
			decodeAbogadoAdp(Buffer.from([0x53]), geometry).toString("hex"),
		).toBe("09001200");
	});

	it("writes a sound of one channel out again", async () => {
		const out = await extract(
			adpFile({ channels: 1, samples: 2, stream: Buffer.from([0x53]) }),
		);
		expect(out.toString("latin1", 0, 4)).toBe("RIFF");
		expect(out.readUInt16LE(0x14)).toBe(1);
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(44100);
		expect(out.readUInt16LE(0x22)).toBe(16);
		expect(out.readUInt32LE(0x28)).toBe(4);
		expect(out.subarray(0x2c).toString("hex")).toBe("09001200");
	});

	it("decodes the two channels of a sound with a walk of its own each", async () => {
		const out = await extract(
			adpFile({
				channels: 2,
				samples: 2,
				stream: Buffer.from([0x53, 0x00]),
			}),
		);
		expect(out.readUInt16LE(0x16)).toBe(2);
		expect(out.readUInt32LE(0x28)).toBe(8);
		expect(out.subarray(0x2c).toString("hex")).toBe("090006000a000600");
	});

	it("declines a file that does not hold a sound", async () => {
		const data = adpFile({
			channels: 1,
			samples: 2,
			stream: Buffer.from([0x53]),
		});
		data.writeUInt32LE(1000, 0x00);
		await expect(
			abogadoAdpAudioFormat.open(new BufferByteSource(data), "sound.adp"),
		).rejects.toThrow(GarbroError);
		await expect(
			abogadoAdpAudioFormat.open(new BufferByteSource(data), "sound.adp"),
		).rejects.toThrow("Not an Abogado sound");
	});
});
