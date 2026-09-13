import { BufferByteSource } from "@garbro-mcp/core";
import { wstAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("WST2", "latin1");
const EXTRA_DATA_OFFSET = 0x0c;
const DATA_OFFSET = 0x28;
const WAVE_HEADER_SIZE = 0x4e;

function buildWst(
	options: { header?: Buffer; pcm?: Buffer; coefficients?: Buffer } = {},
): Buffer {
	const header = options.header ?? Buffer.alloc(EXTRA_DATA_OFFSET, 0x00);
	const file = Buffer.concat([
		header,
		options.coefficients ??
			Buffer.from([
				0x00, 0x01, 0x00, 0x02, 0x00, 0x03, 0x00, 0x04, 0x00, 0x05, 0x00, 0x06,
				0x00, 0x07, 0x00, 0x08, 0x00, 0x09, 0x00, 0x0a, 0x00, 0x0b, 0x00, 0x0c,
				0x00, 0x0d, 0x00, 0x0e,
			]),
		options.pcm ?? Buffer.from([0x11, 0x22, 0x33, 0x44]),
	]);
	SIGNATURE.copy(file, 0);
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "SOUND.WST"): Promise<Buffer> {
	const archive = await wstAudioFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("ipac wst adpcm audio", () => {
	it("declares the WST2 signature", () => {
		expect(wstAudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("WST2");
	});

	it("writes a fixed fifty byte format chunk and the coefficients", async () => {
		const coefficients = Buffer.from(
			Array.from({ length: 28 }, (_unused, index) => index + 0x40),
		);
		const file = buildWst({ coefficients });
		const source = sourceOf(file);
		expect(await wstAudioFormat.detect(source, "SOUND.WST")).toBe(true);
		const archive = await wstAudioFormat.open(source, "SOUND.WST");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SOUND.wav"]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				audio: "wav",
				formatTag: 2,
				channels: 2,
				sampleRate: 0xac44,
				blockAlign: 0x800,
				bitsPerSample: 4,
			});
			expect(archive.metadata).toMatchObject({ samplesPerBlock: 0x07f4 });
		} finally {
			await archive.close();
		}
		const output = await extract(file);
		expect(output.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(output.readUInt32LE(4)).toBe(0x4e - 8 + 4);
		expect(output.subarray(8, 16).toString("latin1")).toBe("WAVEfmt ");
		expect(output.readUInt32LE(16)).toBe(0x32);
		expect(output.readUInt16LE(20)).toBe(2);
		expect(output.readUInt16LE(22)).toBe(2);
		expect(output.readUInt32LE(24)).toBe(0xac44);
		// The byte rate is the sample rate, which is what the reference writes.
		expect(output.readUInt32LE(28)).toBe(0xac44);
		expect(output.readUInt16LE(32)).toBe(0x800);
		expect(output.readUInt16LE(34)).toBe(4);
		expect(output.readUInt16LE(36)).toBe(0x20);
		expect(output.readUInt16LE(38)).toBe(0x07f4);
		expect(output.readUInt16LE(40)).toBe(7);
		expect(output.subarray(42, 70)).toEqual(coefficients);
		expect(output.subarray(70, 74).toString("latin1")).toBe("data");
		expect(output.readUInt32LE(74)).toBe(4);
		expect(output.subarray(WAVE_HEADER_SIZE)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x44]),
		);
		expect(output.length).toBe(WAVE_HEADER_SIZE + 4);
	});

	it("ignores the twelve bytes before the coefficients", async () => {
		// Only the signature is checked, so the rest of the header is whatever the file has.
		const junk = Buffer.from(
			Array.from(
				{ length: EXTRA_DATA_OFFSET },
				(_unused, index) => 0xff - index,
			),
		);
		const file = buildWst({ header: junk });
		expect(await wstAudioFormat.detect(sourceOf(file), "SOUND.WST")).toBe(true);
		const output = await extract(file);
		expect(output.readUInt16LE(40)).toBe(7);
		expect(output.subarray(42, 70)).toEqual(file.subarray(0x0c, 0x28));
	});

	it("accepts a file with no stream at all", async () => {
		const file = buildWst({ pcm: Buffer.alloc(0) });
		// The reference reads its twenty eight bytes and copies whatever is left, which may be nothing.
		const output = await extract(file);
		expect(output.readUInt32LE(74)).toBe(0);
		expect(output.readUInt32LE(4)).toBe(0x4e - 8);
		expect(output.length).toBe(WAVE_HEADER_SIZE);
	});

	it("declines a file that cannot supply the full coefficient read", async () => {
		// The reference returns null when the twenty eight byte read comes up short, and that is the only
		// validation the format has, so a truncated file is not recognised rather than failing later.
		for (const size of [4, EXTRA_DATA_OFFSET, DATA_OFFSET - 1]) {
			expect(
				await wstAudioFormat.detect(
					sourceOf(buildWst().subarray(0, size)),
					"SOUND.WST",
				),
			).toBe(false);
		}
	});

	it("declines a wrong signature", async () => {
		const file = buildWst();
		file[0] = 0x58;
		expect(await wstAudioFormat.detect(sourceOf(file), "SOUND.WST")).toBe(
			false,
		);
	});
});
