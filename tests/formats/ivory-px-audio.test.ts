import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodePx,
	ivoryPxAudioFormat,
	readPxLayout,
} from "../../packages/formats/src/ivory/px-audio.js";

const PLAIN = Buffer.from(
	"6354524b280000000000000024000000000000002256000000000100080000000000000001020304",
	"hex",
);
const WALKED = Buffer.from(
	"6354524b29000000000000002400000005000000225600000000010010000200000000004020192f00",
	"hex",
);
/** What the walk of that sound stands for. */
const WALKED_PCM = Buffer.from("8400680070006c006c00", "hex");
/** A sound of the Ogg kind. */
const OGG = Buffer.from(
	"6354524b2800000000000000240000000000000044ac00000000020010000300000000004f676753",
	"hex",
);

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await ivoryPxAudioFormat.open(
		new BufferByteSource(data),
		"sound.px",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Ivory audio format", () => {
	it("reads the head of a sound of the plain kind", () => {
		expect(readPxLayout(PLAIN, PLAIN.length)).toEqual({
			kind: 0,
			headOffset: 0,
			headerLength: 0x24,
			dataLength: 4,
			rate: 22050,
			channels: 1,
			bitsPerSample: 8,
			sampleCount: 0,
			dataOffset: 0x24,
		});
	});

	it("reads the head of a sound walked of its own", () => {
		expect(readPxLayout(WALKED, WALKED.length)).toMatchObject({
			kind: 2,
			headerLength: 0x24,
			dataLength: 5,
			rate: 22050,
			channels: 1,
			sampleCount: 5,
			dataOffset: 0x24,
		});
	});

	it("turns away a head that names no sound", () => {
		const wrongMark = Buffer.from(WALKED);
		wrongMark.write("cTRX", 0, "latin1");
		expect(readPxLayout(wrongMark, wrongMark.length)).toBeUndefined();
		const shortHead = Buffer.from(WALKED);
		shortHead.writeInt32LE(0x10, 0x0c);
		expect(readPxLayout(shortHead, shortHead.length)).toBeUndefined();
		expect(readPxLayout(Buffer.alloc(4), 4)).toBeUndefined();
	});

	it("stands the places of the walk of a sound beside the places before them", () => {
		const layout = readPxLayout(WALKED, WALKED.length);
		if (!layout) throw new Error("the head stands in the sound");
		expect(decodePx(WALKED, layout)).toEqual(WALKED_PCM);
	});

	it("hands out the places of a sound of the plain kind as a wave", async () => {
		const out = await extract(PLAIN);
		expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(22050);
		expect(out.readUInt16LE(0x22)).toBe(8);
		expect(out.subarray(0x2c)).toEqual(Buffer.from([1, 2, 3, 4]));
	});

	it("hands out the places of a sound walked of its own as a wave", async () => {
		const out = await extract(WALKED);
		expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(22050);
		expect(out.readUInt16LE(0x22)).toBe(16);
		expect(out.subarray(0x2c)).toEqual(WALKED_PCM);
	});

	it("reads a head that stands behind words of its own", async () => {
		// The words of the sound stand behind words of their own, the words of the head then standing at the
		// eight places behind those.
		const data = Buffer.concat([
			Buffer.from("fPX ", "latin1"),
			Buffer.alloc(4, 0x00),
			WALKED,
		]);
		const layout = readPxLayout(data, data.length);
		expect(layout).toMatchObject({ headOffset: 8, dataOffset: 0x2c });
		expect((await extract(data)).subarray(0x2c)).toEqual(WALKED_PCM);
	});

	it("hands out a sound of the Ogg kind as it stands", async () => {
		const out = await extract(OGG);
		expect(out.subarray(0, 4).toString("latin1")).toBe("OggS");
		const handle = await ivoryPxAudioFormat.open(
			new BufferByteSource(OGG),
			"sound.px",
		);
		expect(handle.metadata).toMatchObject({ audio: "ogg", kind: 3 });
		expect(handle.entries[0]?.path).toBe("sound.ogg");
	});

	it("turns a sound of a kind this project does not read away", async () => {
		const other = Buffer.from(WALKED);
		other.writeUInt16LE(5, 0x1e);
		await expect(
			ivoryPxAudioFormat.detect(new BufferByteSource(other)),
		).resolves.toBe(false);
		await expect(extract(other)).rejects.toThrow(GarbroError);
	});

	it("turns a walk cut short of the places of the sound away", () => {
		const layout = readPxLayout(WALKED, WALKED.length);
		if (!layout) throw new Error("the head stands in the sound");
		const cut = Buffer.from(WALKED.subarray(0, WALKED.length - 3));
		expect(() => decodePx(cut, { ...layout, dataLength: 2 })).toThrow(
			"Ivory sound is cut short of the places of its walk",
		);
	});

	it("is told by the words of the head", async () => {
		expect(ivoryPxAudioFormat.descriptor.id).toBe("ivory-px-audio");
		expect(ivoryPxAudioFormat.descriptor.extensions).toEqual(["px", "trk"]);
		await expect(
			ivoryPxAudioFormat.detect(new BufferByteSource(PLAIN)),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(WALKED);
		wrongMark.write("cTRX", 0, "latin1");
		await expect(
			ivoryPxAudioFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
