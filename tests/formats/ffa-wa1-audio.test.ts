import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeWa1,
	ffaWa1AudioFormat,
	readWa1ContainerLayout,
	readWa1Layout,
	readWa1Sound,
} from "../../packages/formats/src/ffa/wa1-audio.js";

/** The head of a wave file of forty four bytes, which a sound of this engine carries behind its kind. */
function waveHead(dataSize: number, channels = 1): Buffer {
	const head = Buffer.alloc(0x2c, 0x00);
	head.write("RIFF", 0, "latin1");
	head.writeUInt32LE(0x24 + dataSize, 4);
	head.write("WAVE", 8, "latin1");
	head.write("fmt ", 0x0c, "latin1");
	head.writeUInt16LE(1, 0x10);
	head.writeUInt16LE(channels, 0x12);
	head.writeUInt32LE(22050, 0x14);
	head.writeUInt32LE(22050 * 2, 0x18);
	head.writeUInt16LE(2, 0x1c);
	head.writeUInt16LE(16, 0x1e);
	head.write("data", 0x24, "latin1");
	head.writeUInt32LE(dataSize, 0x28);
	return head;
}

/** A plain sound: its kind, the head of the wave file and the walk of its samples. */
function wa1File(input: {
	kind: number;
	dataSize: number;
	body: Buffer;
	channels?: number;
	shape?: string;
}): Buffer {
	const kind = Buffer.alloc(4, 0x00);
	kind.writeInt32LE(input.kind, 0);
	const head = waveHead(input.dataSize, input.channels ?? 1);
	if (input.shape) head.write(input.shape, 0, "latin1");
	return Buffer.concat([kind, head, input.body]);
}

/** A walk of runs that stands as they are: a control byte of eight places and then eight bytes each. */
function literals(bytes: Buffer): Buffer {
	const out: Buffer[] = [];
	for (let at = 0; at < bytes.length; at += 8) {
		out.push(Buffer.from([0xff]), bytes.subarray(at, at + 8));
	}
	return Buffer.concat(out);
}

/** A sound whose samples stand wrapped up in a walk of runs. */
function packedFile(unpacked: Buffer): Buffer {
	const packed = literals(unpacked);
	const head = Buffer.alloc(8, 0x00);
	head.writeInt32LE(packed.length, 0);
	head.writeInt32LE(unpacked.length, 4);
	return Buffer.concat([head, packed]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await ffaWa1AudioFormat.open(
		new BufferByteSource(data),
		"sound.wa1",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("FFA System wave audio", () => {
	it("reads a plain sound of every kind", () => {
		for (const kind of [0, 4, 8, 12]) {
			const data = wa1File({
				kind,
				dataSize: 8,
				body: Buffer.alloc(2, 0x00),
			});
			expect(readWa1Layout(data)).toEqual({ kind, dataSize: 8 });
		}
		// Only the four kinds the engine writes are read.
		expect(
			readWa1Layout(
				wa1File({ kind: 2, dataSize: 8, body: Buffer.alloc(2, 0x00) }),
			),
		).toBeUndefined();
		expect(
			readWa1Layout(
				wa1File({
					kind: 0,
					dataSize: 8,
					body: Buffer.alloc(2, 0x00),
					shape: "RIFX",
				}),
			),
		).toBeUndefined();
	});

	it("walks the samples of the first kind a nibble at a time", () => {
		// The higher nibble of a byte first and the lower one behind it, so the four codes of the two bytes
		// `0x08` and `0x5D` are nought, eight, five and thirteen. The walk stands at a step of a hundred and
		// twenty seven, which the codes nought and eight leave where it is; the code five climbs the sample
		// by a hundred and seventy four and moves the step to two hundred and two, and the code thirteen
		// falls from there by two hundred and seventy seven.
		const data = wa1File({
			kind: 0,
			dataSize: 8,
			body: Buffer.from([0x08, 0x5d]),
		});
		const layout = readWa1Layout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeWa1(data, layout).toString("hex")).toBe(
			hex([15, 0, 0, 0, 174, 0, 0x99, 0xff]),
		);
	});

	it("walks the samples of the second kind a code at a time", () => {
		// A code stands in two to eight places, the lowest place of the walk first. The three bytes `0xF2`,
		// `0xFD` and `0x00` hold the same four codes as the walk of the first kind: the places `10`, `00`,
		// `1011111` and `0011111`.
		const data = wa1File({
			kind: 4,
			dataSize: 8,
			body: Buffer.from([0xf2, 0xfd, 0x00]),
		});
		const layout = readWa1Layout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeWa1(data, layout).toString("hex")).toBe(
			hex([15, 0, 0, 0, 174, 0, 0x99, 0xff]),
		);
	});

	it("walks the samples of the two channels of the third kind", () => {
		// Two channels: the first half of the codes are the left channel and the second half the right, and
		// the two stand side by side in the sound. The left channel takes the codes nought and eight — 15 and
		// nought — and the right the codes five and thirteen — 174 and minus 103.
		const data = wa1File({
			kind: 8,
			dataSize: 8,
			body: Buffer.from([0x08, 0x5d]),
			channels: 2,
		});
		const layout = readWa1Layout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeWa1(data, layout).toString("hex")).toBe(
			hex([15, 0, 174, 0, 0, 0, 0x99, 0xff]),
		);
	});

	it("walks the samples of the two channels of the fourth kind", () => {
		const data = wa1File({
			kind: 12,
			dataSize: 8,
			body: Buffer.from([0xf2, 0xfd, 0x00]),
			channels: 2,
		});
		const layout = readWa1Layout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeWa1(data, layout).toString("hex")).toBe(
			hex([15, 0, 174, 0, 0, 0, 0x99, 0xff]),
		);
	});

	it("writes a sound out as a wave file", async () => {
		const data = wa1File({
			kind: 0,
			dataSize: 8,
			body: Buffer.from([0x08, 0x5d]),
		});
		const out = await extract(data);
		expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(out.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(out.subarray(0x24, 0x28).toString("latin1")).toBe("data");
		// The head of the wave file stands as it was and the size of the file is written behind the word.
		expect(out.readUInt32LE(4)).toBe(out.length - 8);
		expect(out.readUInt32LE(0x28)).toBe(8);
		expect(out.subarray(0x2c).toString("hex")).toBe(
			hex([15, 0, 0, 0, 174, 0, 0x99, 0xff]),
		);
	});

	it("unwraps the samples where they stand behind a walk of runs", async () => {
		const plain = wa1File({
			kind: 0,
			dataSize: 8,
			body: Buffer.from([0x08, 0x5d]),
		});
		const data = packedFile(plain);
		expect(readWa1ContainerLayout(data)).toEqual({
			packedSize: data.length - 8,
			unpackedSize: plain.length,
		});
		const out = await extract(data);
		expect(out.subarray(0x2c).toString("hex")).toBe(
			hex([15, 0, 0, 0, 174, 0, 0x99, 0xff]),
		);
	});

	it("hands out a wave file the walk of runs already holds", async () => {
		// What the walk gives begins with the word of a wave file, so it is handed out as it stands.
		const wave = Buffer.concat([
			waveHead(4, 1),
			Buffer.from([0x01, 0x02, 0x03, 0x04]),
		]);
		const data = packedFile(wave);
		const out = await readWa1Sound(data, data.length);
		if (!out) throw new Error("no sound");
		expect(out.toString("hex")).toBe(wave.toString("hex"));
	});

	it("declines a file that does not hold a sound", async () => {
		const data = Buffer.alloc(16, 0x00);
		await expect(
			ffaWa1AudioFormat.open(new BufferByteSource(data), "sound.wa1"),
		).rejects.toThrow(GarbroError);
		await expect(
			ffaWa1AudioFormat.open(new BufferByteSource(data), "sound.wa1"),
		).rejects.toThrow("Not an FFA System sound");
	});

	it("stops where the walk runs out of the file", () => {
		// A sound of sixty four bytes of samples whose walk gives only one byte: the walk needs sixteen
		// bytes of nibbles, so it runs out of the file.
		const data = wa1File({
			kind: 0,
			dataSize: 64,
			body: Buffer.from([0x08]),
		});
		const layout = readWa1Layout(data);
		if (!layout) throw new Error("no layout");
		expect(() => decodeWa1(data, layout)).toThrow(
			"FFA System sound is cut short of its walk",
		);
	});
});

/** The bytes of a sound, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
