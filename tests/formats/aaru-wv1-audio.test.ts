import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	aaruWv1AudioFormat,
	decodeWv1,
	readWv1Layout,
} from "../../packages/formats/src/aaru/wv1-audio.js";

/** A sound: the head and the stream of nibbles. */
function wv1File(input: {
	channels: number;
	sampleCount: number;
	stream: Buffer;
	sampleRate?: number;
}): Buffer {
	const head = Buffer.alloc(0x30, 0x00);
	Buffer.from("WV1.0\0", "latin1").copy(head, 0);
	head.writeUInt16LE(input.channels, 0x0a);
	head.writeUInt32LE(input.sampleRate ?? 22050, 0x0e);
	head.writeInt32LE(input.sampleCount, 0x26);
	return Buffer.concat([head, input.stream]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await aaruWv1AudioFormat.open(
		new BufferByteSource(data),
		"sound.wv1",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Aaru compressed audio", () => {
	it("reads the head as the reference does", () => {
		const data = wv1File({
			channels: 2,
			sampleCount: 4,
			stream: Buffer.from([0x9f, 0x00]),
		});
		expect(readWv1Layout(data)).toEqual({
			channels: 2,
			sampleRate: 22050,
			sampleCount: 4,
			dataLength: 2,
			fileLength: 0x32,
		});
	});

	it("gates on the mark, the channels and the count", () => {
		const good = wv1File({
			channels: 1,
			sampleCount: 2,
			stream: Buffer.from([0x9f]),
		});
		expect(readWv1Layout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("WV2.0\0", 0, "latin1");
		expect(readWv1Layout(mark)).toBeUndefined();
		const channels = Buffer.from(good);
		channels.writeUInt16LE(3, 0x0a);
		expect(readWv1Layout(channels)).toBeUndefined();
		const none = Buffer.from(good);
		none.writeInt32LE(0, 0x26);
		expect(readWv1Layout(none)).toBeUndefined();
		// A stream shorter than the count declares is not refused: the reference ends quietly there.
		const short = Buffer.from(good);
		short.writeInt32LE(8, 0x26);
		expect(readWv1Layout(short)).toBeDefined();
	});

	it("walks a step of its own sample table", () => {
		// The first code steps down by the last of the eight steps of the first entry of the table, and the
		// second takes its step from the entry the first moved the index to.
		const stored = wv1File({
			channels: 1,
			sampleCount: 2,
			stream: Buffer.from([0x9f]),
		});
		const layout = readWv1Layout(stored);
		if (!layout) throw new Error("no layout");
		expect(decodeWv1(stored, layout).toString("hex")).toBe("eaffdeff");
	});

	it("writes a sound of one channel out again", async () => {
		const out = await extract(
			wv1File({ channels: 1, sampleCount: 2, stream: Buffer.from([0x9f]) }),
		);
		expect(out.toString("latin1", 0, 4)).toBe("RIFF");
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(22050);
		expect(out.readUInt16LE(0x22)).toBe(16);
		expect(out.readUInt32LE(0x28)).toBe(4);
		expect(out.subarray(0x2c).toString("hex")).toBe("eaffdeff");
	});

	it("gives every other sample to a walk of its own when there are two channels", async () => {
		const out = await extract(
			wv1File({
				channels: 2,
				sampleCount: 4,
				stream: Buffer.from([0x9f, 0x00]),
			}),
		);
		expect(out.readUInt16LE(0x16)).toBe(2);
		expect(out.readUInt32LE(0x28)).toBe(8);
		expect(out.subarray(0x2c).toString("hex")).toBe("eafffeffeefffeff");
	});

	it("ends the sound quietly where the stream runs out", async () => {
		// The head declares four samples but the stream holds one byte, which is two of them.
		const out = await extract(
			wv1File({ channels: 1, sampleCount: 4, stream: Buffer.from([0x9f]) }),
		);
		expect(out.subarray(0x2c).toString("hex")).toBe("eaffdeff00000000");
	});

	it("declines a file that does not hold a sound", async () => {
		const data = wv1File({
			channels: 1,
			sampleCount: 2,
			stream: Buffer.from([0x9f]),
		});
		data.write("WV2.0\0", 0, "latin1");
		await expect(
			aaruWv1AudioFormat.open(new BufferByteSource(data), "sound.wv1"),
		).rejects.toThrow(GarbroError);
		await expect(
			aaruWv1AudioFormat.open(new BufferByteSource(data), "sound.wv1"),
		).rejects.toThrow("Not an Aaru sound");
	});
});
