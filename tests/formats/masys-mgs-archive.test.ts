import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodeMgsSamples,
	mgsFormat,
	readMgsIndex,
} from "../../packages/formats/src/masys/mgs-archive.js";

const COUNT_OFFSET = 0x20;
const INDEX_OFFSET = 0x22;
/** `MgdOpener.Key`, which `MgsOpener` XORs over its names. */
const NAME_KEY = Buffer.from("Powerd by Masys", "ascii");
// The payloads start at 0x100, so the file has to hold the index and every payload.
const FILE_SIZE = 0x200;

interface Record {
	format: number;
	name: string;
	channels?: number;
	sampleRate?: number;
	bitsPerSample?: number;
	data: Buffer;
}

/** Writes the index and the payloads of a Masys audio archive. */
function buildArchive(records: Record[], flag = 0): Buffer {
	const data = Buffer.alloc(FILE_SIZE, 0x00);
	data.write("MGS", 0, "latin1");
	data.writeUInt16LE(flag, 3);
	data.writeInt16LE(records.length, COUNT_OFFSET);
	let at = INDEX_OFFSET;
	let payloadAt = 0x100;
	for (const record of records) {
		const nameBytes = Buffer.from(record.name, "latin1");
		if (100 === flag) {
			for (let i = 0; i < nameBytes.length; i += 1)
				nameBytes[i] = (nameBytes[i] ?? 0) ^ (NAME_KEY[i % 0x0f] ?? 0);
		}
		data.writeUInt8(record.format, at);
		data.writeUInt16LE(record.channels ?? 0, at + 1);
		data.writeUInt32LE(record.sampleRate ?? 0, at + 3);
		data.writeUInt16LE(record.bitsPerSample ?? 0, at + 7);
		data.writeUInt8(nameBytes.length, at + 9);
		nameBytes.copy(data, at + 10);
		at += 10 + nameBytes.length;
		data.writeUInt32LE(record.data.length, at);
		data.writeUInt32LE(payloadAt, at + 4);
		at += 8;
		record.data.copy(data, payloadAt);
		payloadAt += record.data.length;
	}
	return data;
}

describe("Masys MGS audio resources archive", () => {
	it("rejects files that are not layouts of this kind", async () => {
		const source = new BufferByteSource(Buffer.alloc(FILE_SIZE, 0x00));
		expect(await readMgsIndex(source)).toBeUndefined();
		const noCount = buildArchive([]);
		noCount.writeInt16LE(0, COUNT_OFFSET);
		expect(await readMgsIndex(new BufferByteSource(noCount))).toBeUndefined();
		const negative = buildArchive([]);
		negative.writeInt16LE(-1, COUNT_OFFSET);
		expect(await readMgsIndex(new BufferByteSource(negative))).toBeUndefined();
		const empty = buildArchive([
			{ format: 0, name: "", data: Buffer.alloc(4) },
		]);
		expect(await readMgsIndex(new BufferByteSource(empty))).toBeUndefined();
		const outside = buildArchive([
			{ format: 0, name: "a", data: Buffer.alloc(4) },
		]);
		outside.writeUInt32LE(FILE_SIZE, INDEX_OFFSET + 10 + 1);
		expect(await readMgsIndex(new BufferByteSource(outside))).toBeUndefined();
	});

	it("walks the records and renames them after their format", async () => {
		const data = buildArchive([
			{
				format: 0,
				name: "music.dat",
				channels: 2,
				sampleRate: 22050,
				bitsPerSample: 16,
				data: Buffer.alloc(0x20, 0x11),
			},
			{ format: 1, name: "theme", data: Buffer.alloc(0x10, 0x22) },
			{ format: 2, name: "blob.xyz", data: Buffer.alloc(0x08, 0x33) },
		]);
		const plans = await readMgsIndex(new BufferByteSource(data));
		if (!plans) throw new Error("no plans");
		expect(plans.map((plan) => plan.name)).toEqual([
			"music.wav",
			"theme.mid",
			"blob",
		]);
		expect(plans.map((plan) => plan.format)).toEqual([0, 1, 2]);
		expect(plans[0]?.channels).toBe(2);
		expect(plans[0]?.sampleRate).toBe(22050);
		expect(plans[0]?.bitsPerSample).toBe(16);
		expect(plans[0]?.size).toBe(0x20n);
		expect(plans[1]?.channels).toBeUndefined();
		expect(plans[0]?.offset).toBe(0x100n);
		expect(plans[1]?.offset).toBe(0x120n);
	});

	it("reads a name that was XORed with the key of the engine", async () => {
		const data = buildArchive(
			[{ format: 2, name: "blob.xyz", data: Buffer.alloc(8, 0x33) }],
			100,
		);
		// The stored name is not the plain one, and XORing with the same key gives it back.
		expect(
			data.subarray(INDEX_OFFSET + 10, INDEX_OFFSET + 18).toString(),
		).not.toBe("blob.xyz");
		const plans = await readMgsIndex(new BufferByteSource(data));
		if (!plans) throw new Error("no plans");
		expect(plans[0]?.name).toBe("blob");
	});

	it("decodes a packed chunk low nibble first", () => {
		// One channel, a chunk of four header bytes and one octet: the seed sample, then the low nibble
		// and the high nibble of that octet. The quantiser is handed to the decoder as zero, where the
		// table holds 0x0007, so the low nibble of fifteen steps down by ((2 * 7 + 1) * 7) >> 3, i.e.
		// thirteen, and moves the quantiser by eight, where the table holds 0x0010; the high nibble of
		// zero then steps up by 0x10 >> 3, i.e. two.
		const payload = Buffer.alloc(5, 0x00);
		payload.writeInt16LE(1000, 0);
		payload.writeUInt16LE(0, 2);
		payload.writeUInt8(0x0f, 4);
		const pcm = decodeMgsSamples(payload, 1, 5);
		expect(pcm).toHaveLength(6);
		expect(pcm.readInt16LE(0)).toBe(1000);
		expect(pcm.readInt16LE(2)).toBe(1000 - 13);
		expect(pcm.readInt16LE(4)).toBe(1000 - 13 + 2);
	});

	it("alternates the channels of a packed chunk", () => {
		// Two channels, a chunk of eight header bytes and one packed word per channel. Both quantisers
		// are zero and every nibble is zero, so both channels stay on their seed sample.
		const payload = Buffer.alloc(16, 0x00);
		payload.writeInt16LE(300, 0);
		payload.writeInt16LE(-300, 4);
		const pcm = decodeMgsSamples(payload, 2, 16);
		expect(pcm).toHaveLength(36);
		expect(pcm.readInt16LE(0)).toBe(300);
		expect(pcm.readInt16LE(2)).toBe(-300);
		for (let at = 0; at < 36; at += 4) {
			expect(pcm.readInt16LE(at)).toBe(300);
			expect(pcm.readInt16LE(at + 2)).toBe(-300);
		}
	});

	it("wraps a wave payload in a RIFF header and leaves the rest alone", async () => {
		const pcm = Buffer.alloc(0x20, 0x44);
		const data = buildArchive([
			{
				format: 0,
				name: "music.dat",
				channels: 2,
				sampleRate: 44100,
				bitsPerSample: 16,
				data: pcm,
			},
			{
				format: 2,
				name: "blob.xyz",
				data: Buffer.from("raw payload!", "latin1"),
			},
		]);
		await expect(mgsFormat.detect(new BufferByteSource(data))).resolves.toBe(
			true,
		);
		await expect(
			mgsFormat.detect(new BufferByteSource(Buffer.alloc(FILE_SIZE, 0x00))),
		).resolves.toBe(false);
		const archive = await mgsFormat.open(
			new BufferByteSource(data),
			"sound.mgs",
		);
		expect(archive.entries.map((entry) => entry.path)).toEqual([
			"music.wav",
			"blob",
		]);
		const wave = await consumeBuffer(
			await archive.openEntry(archive.entries[0]?.id ?? ""),
		);
		expect(wave.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(wave.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(wave.readUInt16LE(0x14)).toBe(1);
		expect(wave.readUInt16LE(0x16)).toBe(2);
		expect(wave.readUInt32LE(0x18)).toBe(44100);
		expect(wave.readUInt32LE(0x1c)).toBe(44100 * 4);
		expect(wave.readUInt16LE(0x20)).toBe(4);
		expect(wave.readUInt16LE(0x22)).toBe(16);
		expect(wave.subarray(0x2c).equals(pcm)).toBe(true);
		const raw = await consumeBuffer(
			await archive.openEntry(archive.entries[1]?.id ?? ""),
		);
		expect(raw.toString("latin1")).toBe("raw payload!");
	});

	it("decodes a packed wave before it wraps it", async () => {
		// The channel word carries the high bit, and the stored bits per sample doubles as the chunk
		// size: sixteen bytes hold a four byte seed and twelve packed octets.
		const packed = Buffer.alloc(16, 0x00);
		packed.writeInt16LE(500, 0);
		const data = buildArchive([
			{
				format: 0,
				name: "packed",
				channels: 0x8001,
				sampleRate: 8000,
				bitsPerSample: 16,
				data: packed,
			},
		]);
		const archive = await mgsFormat.open(
			new BufferByteSource(data),
			"sound.mgs",
		);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		const wave = await consumeBuffer(await archive.openEntry(entry.id));
		// `(16 - 4) * 4 + 2` bytes of PCM, all of them the seed, because every nibble is zero and the
		// quantiser starts at zero.
		expect(wave.readUInt32LE(0x28)).toBe(50);
		expect(wave.readUInt16LE(0x22)).toBe(16);
		const pcm = wave.subarray(0x2c);
		expect(pcm).toHaveLength(50);
		for (let at = 0; at + 2 <= pcm.length; at += 2)
			expect(pcm.readInt16LE(at)).toBe(500);
	});

	it("refuses an archive whose records do not fit", async () => {
		const data = buildArchive([
			{ format: 2, name: "blob", data: Buffer.alloc(4) },
		]);
		await expect(
			mgsFormat.open(new BufferByteSource(data.subarray(0, 0x30)), "sound.mgs"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
