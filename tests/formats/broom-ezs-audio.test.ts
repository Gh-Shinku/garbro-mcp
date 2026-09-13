import { BufferByteSource } from "@garbro-mcp/core";
import { ezsAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x1b;
const PCM_SIZE = 16;

/**
 * Header values for a sixteen bit, two channel, 22050 Hz wave. They are not the values that come out: the port
 * has to undo the reference's chain, so every number below is the inverse image of the expected field. They
 * were worked out by hand from the C# rather than by running the port.
 */
const STORED = {
	formatTag: 0x11, // 17 ^ 16 = 1
	channels: 6, // 6 ^ 4 = 2
	sampleRate: 22048, // 22048 ^ 2 = 22050
	averageBytesPerSecond: 85640, // 0x14E88 ^ 0x1600 = 0x15888 = 88200
	blockAlign: 22668, // 0x588C ^ 0x5888 = 4
	bitsPerSample: 2, // 2 ^ 0x12 = 16
	cbSize: 0x1612, // key is the low byte, 0x12; the field itself becomes 0x1600
};

const EXPECTED = {
	formatTag: 1,
	channels: 2,
	sampleRate: 22050,
	averageBytesPerSecond: 22050 * 4,
	blockAlign: 4,
	bitsPerSample: 16,
};

function buildPcm(size = PCM_SIZE): Buffer {
	const pcm: Buffer = Buffer.alloc(size);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 37 + 3) & 0xff;
	return pcm;
}

function buildEzs(
	options: {
		pcm?: Buffer;
		pcmSize?: number;
		keyByte?: number;
		stored?: Partial<typeof STORED>;
		unused?: number;
	} = {},
): Buffer {
	const pcm = options.pcm ?? buildPcm();
	const stored = { ...STORED, ...options.stored };
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeUInt32LE(options.pcmSize ?? pcm.length, 0);
	header[4] = options.keyByte ?? 0x5a;
	header.writeUInt16LE(stored.formatTag, 5);
	header.writeUInt16LE(stored.channels, 7);
	header.writeUInt32LE(stored.sampleRate, 9);
	header.writeUInt32LE(stored.averageBytesPerSecond, 13);
	header.writeUInt16LE(stored.blockAlign, 17);
	header.writeUInt16LE(stored.bitsPerSample, 19);
	header.writeUInt16LE(stored.cbSize, 21);
	header.writeUInt32LE(options.unused ?? 0x11223344, 23);
	return Buffer.concat([header, pcm]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("broom ezs audio", () => {
	it("declares no signature and no extension", () => {
		expect(ezsAudioFormat.detection?.signatures).toEqual([]);
		expect(ezsAudioFormat.descriptor.extensions).toEqual([]);
	});

	it("walks the stored fields back to a wave format", async () => {
		const pcm = buildPcm();
		const stored = buildEzs({ pcm });
		const source = sourceOf(stored);
		expect(await ezsAudioFormat.detect(source, "SE01.EZS")).toBe(true);
		const archive = await ezsAudioFormat.open(source, "SE01.EZS");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SE01.wav"]);
			expect(archive.metadata).toMatchObject({
				type: "audio",
				format: "wav",
				formatTag: EXPECTED.formatTag,
				channels: EXPECTED.channels,
				sampleRate: EXPECTED.sampleRate,
				bitsPerSample: EXPECTED.bitsPerSample,
				pcmSize: pcm.length,
			});
			// Every stored field differs from the value it decodes to, so the chain really ran.
			expect(stored.readUInt16LE(5)).not.toBe(EXPECTED.formatTag);
			expect(stored.readUInt16LE(19)).not.toBe(EXPECTED.bitsPerSample);
			expect(stored.readUInt32LE(9)).not.toBe(EXPECTED.sampleRate);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// The output is a canonical wave file describing the decoded format and carrying the payload.
			expect(output.toString("latin1", 0, 4)).toBe("RIFF");
			expect(output.toString("latin1", 8, 12)).toBe("WAVE");
			expect(output.readUInt16LE(20)).toBe(EXPECTED.formatTag);
			expect(output.readUInt16LE(22)).toBe(EXPECTED.channels);
			expect(output.readUInt32LE(24)).toBe(EXPECTED.sampleRate);
			expect(output.readUInt32LE(28)).toBe(EXPECTED.averageBytesPerSecond);
			expect(output.readUInt16LE(32)).toBe(EXPECTED.blockAlign);
			expect(output.readUInt16LE(34)).toBe(EXPECTED.bitsPerSample);
			expect(output.subarray(output.length - pcm.length)).toEqual(pcm);
		} finally {
			await archive.close();
		}
	});

	it("ignores the byte at offset four", async () => {
		// The reference reads it into the key variable and overwrites it immediately.
		const first = await ezsAudioFormat.open(
			sourceOf(buildEzs({ keyByte: 0x00 })),
			"SE01.EZS",
		);
		const second = await ezsAudioFormat.open(
			sourceOf(buildEzs({ keyByte: 0xff })),
			"SE01.EZS",
		);
		try {
			const a = first.entries[0];
			const b = second.entries[0];
			if (!a || !b) throw new Error("missing entry");
			expect(await consumeBuffer(await first.openEntry(a.id))).toEqual(
				await consumeBuffer(await second.openEntry(b.id)),
			);
		} finally {
			await first.close();
			await second.close();
		}
	});

	it("declines a declared payload longer than the file", async () => {
		const stored = buildEzs({ pcmSize: PCM_SIZE + 100 });
		expect(await ezsAudioFormat.detect(sourceOf(stored), "SE01.EZS")).toBe(
			false,
		);
	});

	it("declines a decoded bit depth or channel count out of range", async () => {
		// 2 ^ 0x12 = 16; storing 0x0a gives 0x18, which is not 8 or 16.
		const badBits = buildEzs({ stored: { bitsPerSample: 0x12 ^ 0x18 } });
		expect(await ezsAudioFormat.detect(sourceOf(badBits), "SE01.EZS")).toBe(
			false,
		);
		// Channels decode to the stored value exclusive ored with the block alignment, which is four here.
		const badChannels = buildEzs({ stored: { channels: 0x00 } });
		expect(await ezsAudioFormat.detect(sourceOf(badChannels), "SE01.EZS")).toBe(
			false,
		);
	});

	it("requires the ezs extension", async () => {
		const stored = buildEzs();
		expect(await ezsAudioFormat.detect(sourceOf(stored), "SE01.WAV")).toBe(
			false,
		);
		expect(await ezsAudioFormat.detect(sourceOf(stored), "SE01.ezs")).toBe(
			true,
		);
	});

	it("declines a short header and carries a wave header only payload", async () => {
		expect(
			await ezsAudioFormat.detect(
				sourceOf(buildEzs().subarray(0, HEADER_SIZE - 1)),
				"SE01.EZS",
			),
		).toBe(false);
		// A file that is exactly the header declares no payload but still lists.
		const headerOnly = buildEzs({ pcm: Buffer.alloc(0) });
		const archive = await ezsAudioFormat.open(sourceOf(headerOnly), "SE01.EZS");
		try {
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.metadata).toMatchObject({ pcmSize: 0 });
		} finally {
			await archive.close();
		}
	});
});
