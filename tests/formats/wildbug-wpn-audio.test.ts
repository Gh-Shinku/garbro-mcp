import { BufferByteSource } from "@garbro-mcp/core";
import { wpnAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x57, 0x42, 0x44, 0x1a]);
const HEADER_SIZE = 0x24;
const WAVE_HEADER_SIZE = 44;
const PCM_SIZE = 20;

function buildPcm(size = PCM_SIZE): Buffer {
	const pcm: Buffer = Buffer.alloc(size);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 53 + 7) & 0xff;
	return pcm;
}

/** A sixteen byte format chunk body describing a signed sixteen bit stereo wave. */
function buildFormat(): Buffer {
	const format: Buffer = Buffer.alloc(16, 0x00);
	format.writeUInt16LE(1, 0);
	format.writeUInt16LE(2, 2);
	format.writeUInt32LE(44100, 4);
	format.writeUInt32LE(44100 * 4, 8);
	format.writeUInt16LE(4, 12);
	format.writeUInt16LE(16, 14);
	return format;
}

/** Lays the format chunk and the payload out in the order the arguments name. */
function buildWpn(
	options: {
		formatFirst?: boolean;
		version?: number;
		waveMarker?: string;
		pcm?: Buffer;
		dataSize?: number;
		formatSize?: number;
		extra?: number;
	} = {},
): Buffer {
	const pcm = options.pcm ?? buildPcm();
	const format = buildFormat();
	const formatSize = options.formatSize ?? format.length;
	const dataSize = options.dataSize ?? pcm.length;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.write(options.waveMarker ?? "WAV", 4, "latin1");
	header.writeInt32LE(options.version ?? 2, 8);
	const formatFirst = options.formatFirst ?? true;
	const formatOffset = HEADER_SIZE;
	const dataOffset = formatFirst ? formatOffset + format.length : formatOffset;
	const actualFormatOffset = formatFirst
		? formatOffset
		: formatOffset + pcm.length;
	header.writeInt32LE(actualFormatOffset, 0x10);
	header.writeInt32LE(formatSize, 0x14);
	header.writeInt32LE(formatFirst ? dataOffset : formatOffset, 0x1c);
	header.writeInt32LE(dataSize, 0x20);
	const body = formatFirst
		? Buffer.concat([format, pcm])
		: Buffer.concat([pcm, format]);
	return Buffer.concat([header, body, Buffer.alloc(options.extra ?? 0, 0x99)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("wildbug wpn audio", () => {
	it("declares the WBD signature and no extension", () => {
		expect(wpnAudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(wpnAudioFormat.descriptor.extensions).toEqual([]);
		expect(SIGNATURE.subarray(0, 3).toString("latin1")).toBe("WBD");
	});

	it("reassembles a wave file from declared offsets", async () => {
		const stored = buildWpn();
		const source = sourceOf(stored);
		expect(await wpnAudioFormat.detect(source, "SE01.WPN")).toBe(true);
		const archive = await wpnAudioFormat.open(source, "SE01.WPN");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SE01.wav"]);
			expect(archive.metadata).toMatchObject({
				type: "audio",
				format: "wav",
				formatTag: 1,
				channels: 2,
				sampleRate: 44100,
				bitsPerSample: 16,
				pcmSize: PCM_SIZE,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.toString("latin1", 0, 4)).toBe("RIFF");
			expect(output.toString("latin1", 8, 12)).toBe("WAVE");
			expect(output.readUInt32LE(16)).toBe(16);
			expect(output.readUInt16LE(22)).toBe(2);
			expect(output.readUInt32LE(24)).toBe(44100);
			expect(output.readUInt16LE(34)).toBe(16);
			expect(output.readUInt32LE(40)).toBe(PCM_SIZE);
			expect(output.subarray(WAVE_HEADER_SIZE)).toEqual(buildPcm());
		} finally {
			await archive.close();
		}
	});

	it("follows the offsets when the chunks are reversed", async () => {
		// The payload comes first and the format chunk after it; nothing requires the usual order.
		const stored = buildWpn({ formatFirst: false });
		const archive = await wpnAudioFormat.open(sourceOf(stored), "SE01.WPN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt32LE(24)).toBe(44100);
			expect(output.subarray(WAVE_HEADER_SIZE)).toEqual(buildPcm());
		} finally {
			await archive.close();
		}
	});

	it("takes exactly the declared payload", async () => {
		// Sixteen bytes follow the payload and are not part of it.
		const stored = buildWpn({ extra: 16 });
		const archive = await wpnAudioFormat.open(sourceOf(stored), "SE01.WPN");
		try {
			expect(archive.metadata).toMatchObject({ pcmSize: PCM_SIZE });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt32LE(40)).toBe(PCM_SIZE);
			expect(output.length).toBe(WAVE_HEADER_SIZE + PCM_SIZE);
		} finally {
			await archive.close();
		}
	});

	it("requires the WAV marker and the version", async () => {
		expect(
			await wpnAudioFormat.detect(
				sourceOf(buildWpn({ waveMarker: "wav" })),
				"SE01.WPN",
			),
		).toBe(false);
		expect(
			await wpnAudioFormat.detect(
				sourceOf(buildWpn({ version: 1 })),
				"SE01.WPN",
			),
		).toBe(false);
		expect(
			await wpnAudioFormat.detect(
				sourceOf(buildWpn({ version: 2 })),
				"SE01.WPN",
			),
		).toBe(true);
	});

	it("declines ranges that run past the file", async () => {
		const past = buildWpn();
		past.writeInt32LE(0x1000, 0x1c);
		expect(await wpnAudioFormat.detect(sourceOf(past), "SE01.WPN")).toBe(false);
		const negative = buildWpn();
		negative.writeInt32LE(-1, 0x10);
		expect(await wpnAudioFormat.detect(sourceOf(negative), "SE01.WPN")).toBe(
			false,
		);
		const small = buildWpn();
		small.writeInt32LE(8, 0x14);
		expect(await wpnAudioFormat.detect(sourceOf(small), "SE01.WPN")).toBe(
			false,
		);
	});

	it("declines a short header and a wrong signature", async () => {
		expect(
			await wpnAudioFormat.detect(
				sourceOf(buildWpn().subarray(0, HEADER_SIZE - 1)),
				"SE01.WPN",
			),
		).toBe(false);
		const wrong = buildWpn();
		wrong[3] = 0x1b;
		expect(await wpnAudioFormat.detect(sourceOf(wrong), "SE01.WPN")).toBe(
			false,
		);
	});
});
