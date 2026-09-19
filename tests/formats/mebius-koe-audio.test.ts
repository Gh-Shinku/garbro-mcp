import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decryptKoe,
	mebiusKoeAudioFormat,
	mebiusKind,
	readKoeLayout,
} from "../../packages/formats/src/mebius/koe-audio.js";
import { writeWave } from "../../packages/formats/src/shared/wav.js";

/** The key of a kind, which the port keeps to itself: the same key scrambles and unscrambles. */
async function scramble(
	stored: Buffer,
	kind: string,
	sourcePath?: string,
): Promise<Buffer> {
	const layout = readKoeLayout(stored, sourcePath ?? `voice.${kind}`);
	if (!layout) throw new Error("no layout");
	return decryptKoe(stored, layout);
}

/** A wave file whose stream stands scrambled, with the name it is found by. */
function koeFile(input: {
	payload: Buffer;
	kind: string;
	magic?: string;
	rate?: number;
	channels?: number;
	bits?: number;
	mark?: string;
	dataMark?: string;
}): Buffer {
	const wave = writeWave(
		{
			formatTag: 1,
			channels: input.channels ?? 1,
			sampleRate: input.rate ?? 22050,
			averageBytesPerSecond: (input.rate ?? 22050) * 2,
			blockAlign: 2,
			bitsPerSample: input.bits ?? 16,
		},
		input.payload,
	);
	const scrambled = Buffer.from(wave);
	const start = 0x2c; // the head, the format chunk and the header of the stream
	const key = readKoeLayout(wave, `voice.${input.kind}`);
	if (!key) throw new Error("no key");
	for (let at = start; at < scrambled.length; at += 1) {
		scrambled[at] =
			(scrambled[at] ?? 0) ^ (key.key[(at - start) % key.key.length] ?? 0);
	}
	if (input.mark) scrambled.write(input.mark, 0, "latin1");
	if (input.magic) scrambled.write(input.magic, 0, "latin1");
	if (input.dataMark) scrambled.write(input.dataMark, 0x24, "latin1");
	return scrambled;
}

async function extract(data: Buffer, sourcePath: string): Promise<Buffer> {
	const handle = await mebiusKoeAudioFormat.open(
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

describe("Mebius engine encrypted wave file", () => {
	it("reads the head of a wave file as the reference does", () => {
		const payload = Buffer.alloc(16, 0x11);
		const data = koeFile({ payload, kind: "koe" });
		expect(readKoeLayout(data, "voice.koe")).toEqual({
			kind: "koe",
			key: expect.any(Buffer),
			dataOffset: 0x2c,
			channels: 1,
			sampleRate: 22050,
			bitsPerSample: 16,
			formatTag: 1,
		});
	});

	it("takes the kind of a file from its name", () => {
		expect(mebiusKind("voice.koe")).toBe("koe");
		expect(mebiusKind("a/b/VOICE_MSE.MSE")).toBe("mse");
		expect(mebiusKind("no-extension")).toBe("");
		// Only the three kinds the engine scrambles carry a key.
		const data = koeFile({ payload: Buffer.alloc(4, 0x00), kind: "koe" });
		expect(readKoeLayout(data, "voice.koe")).toBeDefined();
		expect(readKoeLayout(data, "voice.wav")).toBeUndefined();
	});

	it("gates on the shape of the wave file", () => {
		const good = koeFile({ payload: Buffer.alloc(4, 0x00), kind: "koe" });
		expect(readKoeLayout(good, "voice.koe")).toBeDefined();
		expect(
			readKoeLayout(
				koeFile({ payload: Buffer.alloc(4, 0x00), kind: "koe", mark: "RIFX" }),
				"voice.koe",
			),
		).toBeUndefined();
		expect(
			readKoeLayout(
				koeFile({ payload: Buffer.alloc(4, 0x00), kind: "koe", magic: "AVI " }),
				"voice.koe",
			),
		).toBeUndefined();
		// The stream has to stand behind the header of a chunk named for what it holds.
		expect(
			readKoeLayout(
				koeFile({
					payload: Buffer.alloc(4, 0x00),
					kind: "koe",
					dataMark: "DATA",
				}),
				"voice.koe",
			),
		).toBeUndefined();
	});

	it("unscrambles the stream of a wave file", async () => {
		const payload = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
		]);
		const clear = writeWave(
			{
				formatTag: 1,
				channels: 1,
				sampleRate: 22050,
				averageBytesPerSecond: 22050 * 2,
				blockAlign: 2,
				bitsPerSample: 16,
			},
			payload,
		);
		const scrambled = koeFile({ payload, kind: "koe" });
		// What the file holds is not what the engine wrote.
		expect(scrambled.subarray(0x2c).equals(clear.subarray(0x2c))).toBe(false);
		expect((await scramble(scrambled, "koe")).toString("hex")).toBe(
			clear.toString("hex"),
		);
		const out = await extract(scrambled, "voice.koe");
		expect(out.toString("hex")).toBe(clear.toString("hex"));
		expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(out.readUInt16LE(0x14)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(22050);
		expect(out.subarray(0x2c).toString("hex")).toBe(payload.toString("hex"));
	});

	it("unscrambles a stream of every kind of file the engine writes", async () => {
		const payload = Buffer.from([0x10, 0x20, 0x30, 0x40]);
		for (const kind of ["koe", "mse", "bgm"]) {
			const scrambled = koeFile({ payload, kind });
			const out = await extract(scrambled, `voice.${kind}`);
			expect(out.subarray(0x2c).toString("hex")).toBe(payload.toString("hex"));
		}
		// The keys of the three kinds are not the same, so one kind does not read the stream of another.
		const scrambled = koeFile({ payload, kind: "koe" });
		const asMse = await extract(scrambled, "voice.mse");
		expect(asMse.subarray(0x2c).toString("hex")).not.toBe(
			payload.toString("hex"),
		);
	});

	it("finds a scrambled wave file by its name", async () => {
		const data = koeFile({ payload: Buffer.alloc(4, 0x00), kind: "bgm" });
		expect(
			await mebiusKoeAudioFormat.detect(
				new BufferByteSource(data),
				"voice.bgm",
			),
		).toBe(true);
		expect(
			await mebiusKoeAudioFormat.detect(
				new BufferByteSource(data),
				"voice.wav",
			),
		).toBe(false);
	});

	it("declines a file that does not hold a scrambled wave file", async () => {
		const data = koeFile({
			payload: Buffer.alloc(4, 0x00),
			kind: "koe",
			mark: "RIFX",
		});
		await expect(
			mebiusKoeAudioFormat.open(new BufferByteSource(data), "voice.koe"),
		).rejects.toThrow(GarbroError);
		await expect(
			mebiusKoeAudioFormat.open(new BufferByteSource(data), "voice.koe"),
		).rejects.toThrow("Not a Mebius engine wave file");
	});
});
