import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeKaas,
	kaasAudioFormat,
	readKaasLayout,
} from "../../packages/formats/src/kaas/kaas-audio.js";

/** A sound: the head and a byte a sample behind it. */
function kaasFile(input: {
	samples: number;
	stream: Buffer;
	channels?: number;
	sampleRate?: number;
	mark?: number;
	magic?: number;
	length?: number;
}): Buffer {
	const head = Buffer.alloc(0x10, 0x00);
	head.writeInt32LE(input.length ?? input.samples, 0);
	head.writeUInt16LE(input.mark ?? 0x800, 4);
	head.writeUInt16LE(input.channels ?? 0, 6);
	head.writeUInt32LE(input.sampleRate ?? 44100, 8);
	head.writeUInt32LE(input.magic ?? 0x84be2329, 0x0c);
	return Buffer.concat([head, input.stream]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await kaasAudioFormat.open(
		new BufferByteSource(data),
		"sound.kaas",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("KAAS engine audio", () => {
	it("reads the head as the reference does", () => {
		const data = kaasFile({
			samples: 3,
			stream: Buffer.from([0x00, 0x01, 0x80]),
		});
		expect(readKaasLayout(data)).toEqual({
			samples: 3,
			channels: 1,
			sampleRate: 44100,
		});
		// A word of one at the channel field stands for two channels.
		const stereo = kaasFile({
			samples: 2,
			channels: 1,
			stream: Buffer.from([0x00, 0x01]),
		});
		expect(readKaasLayout(stereo)?.channels).toBe(2);
	});

	it("gates on the mark, the magic, the channels and the count", () => {
		const good = kaasFile({
			samples: 3,
			stream: Buffer.from([0x00, 0x01, 0x02]),
		});
		expect(readKaasLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.writeUInt16LE(0x801, 4);
		expect(readKaasLayout(mark)).toBeUndefined();
		const magic = Buffer.from(good);
		magic.writeUInt32LE(0x12345678, 0x0c);
		expect(readKaasLayout(magic)).toBeUndefined();
		const channels = Buffer.from(good);
		channels.writeUInt16LE(2, 6);
		expect(readKaasLayout(channels)).toBeUndefined();
		// The count has to cover exactly the bytes behind the head.
		const count = Buffer.from(good);
		count.writeInt32LE(4, 0);
		expect(readKaasLayout(count)).toBeUndefined();
	});

	it("hands out a word of its table for every byte", () => {
		const stored = kaasFile({
			samples: 5,
			stream: Buffer.from([0x00, 0x01, 0x7f, 0x80, 0xff]),
		});
		const layout = readKaasLayout(stored);
		if (!layout) throw new Error("no layout");
		// The table climbs to its largest step at the last of its first half, turns over at nothing, and
		// falls to its smallest at the last of its second.
		expect(decodeKaas(stored, layout).toString("hex")).toBe(
			"00000100bf7cffff4083",
		);
	});

	it("writes the sound out as a wave", async () => {
		const out = await extract(
			kaasFile({
				samples: 3,
				stream: Buffer.from([0x00, 0x01, 0x80]),
			}),
		);
		expect(out.toString("latin1", 0, 4)).toBe("RIFF");
		expect(out.readUInt16LE(0x14)).toBe(1);
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(44100);
		expect(out.readUInt16LE(0x22)).toBe(16);
		expect(out.readUInt32LE(0x28)).toBe(6);
		expect(out.subarray(0x2c).toString("hex")).toBe("00000100ffff");
	});

	it("declines a file that does not hold a sound", async () => {
		const data = kaasFile({
			samples: 3,
			stream: Buffer.from([0x00, 0x01, 0x80]),
			magic: 0,
		});
		await expect(
			kaasAudioFormat.open(new BufferByteSource(data), "sound.kaas"),
		).rejects.toThrow(GarbroError);
		await expect(
			kaasAudioFormat.open(new BufferByteSource(data), "sound.kaas"),
		).rejects.toThrow("Not a KAAS sound");
	});
});
