import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeWape,
	readWapeLayout,
	technoBrainWapeAudioFormat,
} from "../../packages/formats/src/techno-brain/wape-audio.js";

/**
 * The bits of a walk of commands, packed from the highest bit of a byte down. The reader hands a count of
 * bits back with the first of them standing in the **highest** bit of the byte, so a code of two is `0xC0`
 * or `0x40` while a single bit of nothing is nought and a single bit of one is `0x80`.
 */
class BitWriter {
	readonly bits: number[] = [];

	/** A single bit, as it stands. */
	bit(value: number): void {
		this.bits.push(value & 1);
	}

	/** A count of bits the way the reader hands them back. */
	value(value: number, count: number): void {
		for (let index = 0; index < count; index += 1) {
			this.bits.push((value >> (7 - index)) & 1);
		}
	}

	pack(): Buffer {
		const packed = Buffer.alloc(Math.ceil(this.bits.length / 8), 0x00);
		this.bits.forEach((bit, index) => {
			if (bit !== 0) {
				packed[index >> 3] =
					(packed[index >> 3] ?? 0) | (1 << (7 - (index & 7)));
			}
		});
		return packed;
	}
}

/** A sound: the head, the format fields and the walk of bits. */
function wapeFile(input: { pcmSize: number; stream: Buffer }): Buffer {
	const head = Buffer.alloc(0x30, 0x00);
	Buffer.from("RIFF", "latin1").copy(head, 0);
	Buffer.from("WAPEfmt ", "latin1").copy(head, 8);
	head.writeUInt16LE(1, 0x14);
	head.writeUInt16LE(1, 0x16);
	head.writeUInt32LE(22050, 0x18);
	head.writeUInt32LE(22050, 0x1c);
	head.writeUInt16LE(1, 0x20);
	head.writeUInt16LE(8, 0x22);
	Buffer.from("data", "latin1").copy(head, 0x24);
	head.writeInt32LE(input.pcmSize, 0x2c);
	return Buffer.concat([head, input.stream]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await technoBrainWapeAudioFormat.open(
		new BufferByteSource(data),
		"sound.wav",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("TechnoBrain's compressed audio", () => {
	it("reads the head as the reference does", () => {
		const data = wapeFile({ pcmSize: 3, stream: Buffer.alloc(2) });
		expect(readWapeLayout(data)).toEqual({
			formatTag: 1,
			channels: 1,
			sampleRate: 22050,
			averageBytesPerSecond: 22050,
			blockAlign: 1,
			bitsPerSample: 8,
			pcmSize: 3,
			dataLength: 2,
		});
	});

	it("gates on the marks, the size and the channels", () => {
		const good = wapeFile({ pcmSize: 3, stream: Buffer.alloc(2) });
		expect(readWapeLayout(good)).toBeDefined();
		const riff = Buffer.from(good);
		riff.write("RIFG", 0, "latin1");
		expect(readWapeLayout(riff)).toBeUndefined();
		const format = Buffer.from(good);
		format.write("WAPGfmt ", 8, "latin1");
		expect(readWapeLayout(format)).toBeUndefined();
		const mark = Buffer.from(good);
		mark.write("datb", 0x24, "latin1");
		expect(readWapeLayout(mark)).toBeUndefined();
		const size = Buffer.from(good);
		size.writeInt32LE(0, 0x2c);
		expect(readWapeLayout(size)).toBeUndefined();
		const channels = Buffer.from(good);
		channels.writeUInt16LE(0, 0x16);
		expect(readWapeLayout(channels)).toBeUndefined();
	});

	it("walks a literal, a small step and a larger one", () => {
		const writer = new BitWriter();
		// A literal of seven bits, which is always even.
		writer.bit(0);
		writer.value(0x80, 7);
		// A step of four up.
		writer.bit(1);
		writer.bit(0);
		writer.value(0xc0, 2);
		// A step of six down.
		writer.bit(1);
		writer.bit(1);
		writer.bit(0);
		writer.value(0x40, 2);
		const data = wapeFile({ pcmSize: 3, stream: writer.pack() });
		const layout = readWapeLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeWape(data, layout).toString("hex")).toBe("80847e");
	});

	it("writes a run of the byte before", () => {
		const writer = new BitWriter();
		writer.bit(0);
		writer.value(0x10, 7);
		// A run of one byte, which is the smallest the five bits can say.
		writer.bit(1);
		writer.bit(1);
		writer.bit(1);
		writer.value(0, 5);
		const data = wapeFile({ pcmSize: 2, stream: writer.pack() });
		const layout = readWapeLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeWape(data, layout).toString("hex")).toBe("1010");
	});

	it("writes a byte of `0xFE` as `0xFF`", () => {
		const writer = new BitWriter();
		writer.bit(0);
		writer.value(0xfe, 7);
		const data = wapeFile({ pcmSize: 1, stream: writer.pack() });
		const layout = readWapeLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeWape(data, layout).toString("hex")).toBe("ff");
	});

	it("writes a sound out again with its own format fields", async () => {
		const writer = new BitWriter();
		writer.bit(0);
		writer.value(0x80, 7);
		const out = await extract(wapeFile({ pcmSize: 1, stream: writer.pack() }));
		expect(out.toString("latin1", 0, 4)).toBe("RIFF");
		expect(out.readUInt16LE(0x14)).toBe(1);
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(22050);
		expect(out.readUInt16LE(0x22)).toBe(8);
		expect(out.readUInt32LE(0x28)).toBe(1);
		expect(out.subarray(0x2c).toString("hex")).toBe("80");
	});

	it("refuses a step with no byte before it", () => {
		const writer = new BitWriter();
		writer.bit(1);
		writer.bit(0);
		writer.value(0x00, 2);
		const data = wapeFile({ pcmSize: 1, stream: writer.pack() });
		const layout = readWapeLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => decodeWape(data, layout)).toThrow(GarbroError);
		expect(() => decodeWape(data, layout)).toThrow("before its own start");
	});

	it("declines a file that does not hold a sound", async () => {
		const data = wapeFile({ pcmSize: 1, stream: Buffer.alloc(1) });
		data.write("RIFG", 0, "latin1");
		await expect(
			technoBrainWapeAudioFormat.open(new BufferByteSource(data), "sound.wav"),
		).rejects.toThrow("Not a TechnoBrain sound");
	});
});
