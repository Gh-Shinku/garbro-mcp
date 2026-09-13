import { BufferByteSource } from "@garbro-mcp/core";
import { cswareWavAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x2e;

interface WavOptions {
	channels?: number;
	sampleRate?: number;
	byteRate?: number;
	blockAlign?: number;
	inputSize?: number;
	formatByte?: number;
	formatFlag?: number;
	formatTag?: string;
	dataTag?: string;
	headerSize?: number;
	body?: Buffer;
}

function buildCsWare(options: WavOptions = {}): Buffer {
	const header: Buffer = Buffer.alloc(options.headerSize ?? HEADER_SIZE, 0x00);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(0, 4);
	if (header.length >= 0x2e) {
		header.write(options.formatTag ?? "WAVEfmt ", 8, "latin1");
		header.writeUInt32LE(16, 16);
		header[0x14] = options.formatByte ?? 0x01;
		header[0x15] = options.formatFlag ?? 0xff;
		header.writeUInt16LE(options.channels ?? 1, 0x16);
		header.writeUInt32LE(options.sampleRate ?? 22050, 0x18);
		header.writeUInt32LE(options.byteRate ?? 11025, 0x1c);
		header.writeUInt16LE(options.blockAlign ?? 1, 0x20);
		header.write(options.dataTag ?? "data", 0x26, "latin1");
		header.writeUInt32LE(options.inputSize ?? 4, 0x2a);
	}
	return Buffer.concat([header, options.body ?? Buffer.alloc(0)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "BGM_01.wav"): Promise<Buffer> {
	const archive = await cswareWavAudioFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The samples of a wave file this port wrote. */
function samplesOf(wav: Buffer): Buffer {
	return wav.subarray(44, 44 + wav.readUInt32LE(40));
}

describe("C's ware encoded audio", () => {
	it("needs the whole RIFF shape, not just the marker", async () => {
		const body: Buffer = Buffer.alloc(4, 0x80);
		expect(
			await cswareWavAudioFormat.detect(
				sourceOf(buildCsWare({ body })),
				"A.wav",
			),
		).toBe(true);
		const rejected: WavOptions[] = [
			{ formatByte: 0x00, body },
			{ formatFlag: 0x00, body },
			{ formatTag: "WAVExfmt", body },
			{ dataTag: "DATA", body },
			{ headerSize: 0x2d, body },
		];
		for (const options of rejected) {
			expect(
				await cswareWavAudioFormat.detect(
					sourceOf(buildCsWare(options)),
					"A.wav",
				),
			).toBe(false);
		}
	});

	it("expands bytes through the reference's sample table", async () => {
		// The curve's own values: both extremes, silence, and the first steps above it.
		const body: Buffer = Buffer.from([0x00, 0x80, 0x81, 0x82, 0xff]);
		const output = await extract(buildCsWare({ inputSize: body.length, body }));
		expect(samplesOf(output).toString("hex")).toBe("008000000100020" + "0ff7f");
		// The table mirrors around 128: just below it are the small negatives, all the way to the extremes at
		// both ends, so 0x7F is minus one and 0x81 is plus one.
		const mirrored = Buffer.from([0x7f, 0x81, 0x01, 0xff]);
		expect(
			samplesOf(
				await extract(buildCsWare({ inputSize: 4, body: mirrored })),
			).toString("hex"),
		).toBe("ffff01000180ff7f");
	});

	it("writes a canonical wave header with the file's own format", async () => {
		const body: Buffer = Buffer.alloc(6, 0x80);
		const output = await extract(
			buildCsWare({
				channels: 2,
				sampleRate: 44100,
				byteRate: 22050,
				blockAlign: 2,
				inputSize: 6,
				body,
			}),
		);
		expect(output.length).toBe(44 + 12);
		expect(output.toString("latin1", 0, 4)).toBe("RIFF");
		expect(output.readUInt32LE(4)).toBe(output.length - 8);
		expect(output.toString("latin1", 8, 16)).toBe("WAVEfmt ");
		expect(output.readUInt32LE(16)).toBe(16);
		expect(output.readUInt16LE(20)).toBe(1);
		expect(output.readUInt16LE(22)).toBe(2);
		expect(output.readUInt32LE(24)).toBe(44100);
		// Both of these are doubled from the file's words.
		expect(output.readUInt32LE(28)).toBe(44100);
		expect(output.readUInt16LE(32)).toBe(4);
		expect(output.readUInt16LE(34)).toBe(16);
		expect(output.toString("latin1", 36, 40)).toBe("data");
		expect(output.readUInt32LE(40)).toBe(12);
	});

	it("wraps the two doubled words like the reference does", async () => {
		const output = await extract(
			buildCsWare({
				byteRate: 0x80000000,
				blockAlign: 0x8000,
				inputSize: 1,
				body: Buffer.from([0x80]),
			}),
		);
		expect(output.readUInt32LE(28)).toBe(0);
		expect(output.readUInt16LE(32)).toBe(0);
	});

	it("takes the whole rest of the file as samples", async () => {
		// Two samples declared, four present: the reference would write past its own array.
		await expect(
			extract(buildCsWare({ inputSize: 2, body: Buffer.alloc(4, 0x80) })),
		).rejects.toThrow();
		// Two declared and two present leaves the declaration untouched.
		expect(
			samplesOf(
				await extract(
					buildCsWare({ inputSize: 2, body: Buffer.alloc(2, 0x80) }),
				),
			).length,
		).toBe(4);
		// Nothing declared is an empty but complete wave file.
		const empty = await extract(
			buildCsWare({ inputSize: 0, body: Buffer.alloc(0) }),
		);
		expect(empty.length).toBe(44);
		expect(empty.readUInt32LE(40)).toBe(0);
	});

	it("lists its single audio entry", async () => {
		const file = buildCsWare({ channels: 2, sampleRate: 48000, inputSize: 0 });
		const archive = await cswareWavAudioFormat.open(
			sourceOf(file),
			"sub/BGM_02.wav",
		);
		try {
			const entry = archive.entries[0];
			expect(entry?.path).toBe("BGM_02.wav");
			expect(entry?.sizeKnown).toBe(false);
			expect(archive.metadata).toMatchObject({
				audio: "wav",
				channels: 2,
				sampleRate: 48000,
				bitsPerSample: 16,
			});
		} finally {
			await archive.close();
		}
	});
});
