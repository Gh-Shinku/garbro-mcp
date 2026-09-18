import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	majiroRc8ImageFormat,
	readRc8Layout,
	unpackRc8,
} from "../../packages/formats/src/majiro/rc8-image.js";

/** A picture: the head, the colour map and the runs. */
function rc8File(input: {
	width: number;
	height: number;
	stream: Buffer;
	mark?: string;
	palette?: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x14, 0x00);
	const signature = Buffer.alloc(4);
	signature.writeUInt32LE(0x9a925a98);
	signature.copy(head, 0);
	Buffer.from(input.mark ?? "8_00", "latin1").copy(head, 4);
	head.writeUInt32LE(input.width, 8);
	head.writeUInt32LE(input.height, 12);
	const palette = input.palette ?? defaultPalette();
	return Buffer.concat([head, palette, input.stream]);
}

/** A colour map whose entry is the same value three times over. */
function defaultPalette(): Buffer {
	const palette = Buffer.alloc(0x300, 0x00);
	for (let entry = 0; entry < 0x100; entry += 1) {
		palette[entry * 3] = entry;
		palette[entry * 3 + 1] = entry;
		palette[entry * 3 + 2] = entry;
	}
	return palette;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await majiroRc8ImageFormat.open(
		new BufferByteSource(data),
		"pic.rc8",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Majiro game engine indexed image", () => {
	it("reads the head as the reference does", () => {
		const data = rc8File({ width: 4, height: 2, stream: Buffer.alloc(8) });
		const layout = readRc8Layout(data);
		expect(layout).toMatchObject({ width: 4, height: 2, pixels: 8 });
		expect(layout?.palette.length).toBe(0x400);
		// The colour map is three bytes an entry, which a bitmap holds interleaved as blue, green, red.
		expect(layout?.palette.subarray(0, 8).toString("hex")).toBe(
			"0000000001010100",
		);
	});

	it("gates on the word, the mark and the measurements", () => {
		const good = rc8File({ width: 4, height: 2, stream: Buffer.alloc(8) });
		expect(readRc8Layout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("9_00", 4, "latin1");
		expect(readRc8Layout(mark)).toBeUndefined();
		const word = Buffer.from(good);
		word.writeUInt32LE(0x11223344, 0);
		expect(readRc8Layout(word)).toBeUndefined();
		const wide = Buffer.from(good);
		wide.writeUInt32LE(0x8001, 8);
		expect(readRc8Layout(wide)).toBeUndefined();
		const none = Buffer.from(good);
		none.writeUInt32LE(0, 12);
		expect(readRc8Layout(none)).toBeUndefined();
	});

	it("unfolds runs that stand and runs that reach back", () => {
		const data = rc8File({
			width: 4,
			height: 2,
			stream: Buffer.from([0xaa, 0x03, 0xbb, 0xcc, 0xdd, 0xee, 0xb8]),
		});
		const layout = readRc8Layout(data);
		if (!layout) throw new Error("no layout");
		// The first byte stands itself; a control byte of three says the next run holds four; then a control
		// whose place reaches a row back takes three bytes of the picture again.
		expect(unpackRc8(data, layout).toString("hex")).toBe("aabbccddeebbccdd");
	});

	it("takes the count of a run from the two bytes behind seven", () => {
		const data = rc8File({
			width: 4,
			height: 4,
			stream: Buffer.from([0xaa, 0x87, 0x05, 0x00]),
		});
		const layout = readRc8Layout(data);
		if (!layout) throw new Error("no layout");
		// The control reaches one place back with a run of fifteen, which takes the one byte there and
		// spreads it over the whole picture.
		expect(unpackRc8(data, layout).toString("hex")).toBe("aa".repeat(16));
	});

	it("refuses a place that does not reach back", () => {
		const data = rc8File({
			width: 2,
			height: 2,
			stream: Buffer.from([0xaa, 0xa8]),
		});
		const layout = readRc8Layout(data);
		if (!layout) throw new Error("no layout");
		expect(() => unpackRc8(data, layout)).toThrow(GarbroError);
		expect(() => unpackRc8(data, layout)).toThrow(
			"reaches outside its own runs",
		);
	});

	it("refuses a stream that is cut short", () => {
		const data = rc8File({
			width: 4,
			height: 2,
			stream: Buffer.from([0xaa, 0x03, 0xbb]),
		});
		const layout = readRc8Layout(data);
		if (!layout) throw new Error("no layout");
		expect(() => unpackRc8(data, layout)).toThrow("cut short of its runs");
	});

	it("writes the picture out with its colour map", async () => {
		const out = await extract(
			rc8File({
				width: 4,
				height: 2,
				stream: Buffer.from([0xaa, 0x03, 0xbb, 0xcc, 0xdd, 0xee, 0xb8]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.readUInt32LE(0x2e)).toBe(256);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0000000001010100");
		expect(out.subarray(0x436, 0x43e).toString("hex")).toBe("aabbccddeebbccdd");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = rc8File({ width: 2, height: 1, stream: Buffer.alloc(2) });
		data.write("9_00", 4, "latin1");
		await expect(
			majiroRc8ImageFormat.open(new BufferByteSource(data), "pic.rc8"),
		).rejects.toThrow(GarbroError);
		await expect(
			majiroRc8ImageFormat.open(new BufferByteSource(data), "pic.rc8"),
		).rejects.toThrow("Not a Majiro picture");
	});
});
