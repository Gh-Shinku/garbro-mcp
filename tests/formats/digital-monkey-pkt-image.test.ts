import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	digitalMonkeyPktImageFormat,
	readPktLayout,
	unpackPktRle,
} from "../../packages/formats/src/digital-monkey/pkt-image.js";

/** A picture: the head and the parts it points at. */
function pktFile(input: {
	mark: string;
	width: number;
	height: number;
	data?: Buffer;
	dataOffset?: number;
	alpha?: Buffer;
	alphaOffset?: number;
	alphaChunks?: number;
	mark5?: number;
}): Buffer {
	const head = Buffer.alloc(0x30, 0x00);
	Buffer.from(input.mark, "latin1").copy(head, 0);
	head.writeUInt8(input.mark5 ?? 0, 5);
	head.writeUInt32LE(input.width, 0x14);
	head.writeUInt32LE(input.height, 0x18);
	head.writeUInt32LE(input.dataOffset ?? 0, 0x20);
	head.writeUInt32LE(input.alphaOffset ?? 0, 0x24);
	head.writeUInt32LE(input.alpha ? (input.alphaChunks ?? 1) : 0, 0x28);
	head.writeInt32LE(input.alphaChunks ?? 0, 0x2c);
	const parts: Array<{ offset: number; bytes: Buffer }> = [];
	if (input.data) {
		parts.push({ offset: input.dataOffset ?? 0, bytes: input.data });
	}
	if (input.alpha) {
		parts.push({ offset: input.alphaOffset ?? 0, bytes: input.alpha });
	}
	const size = parts.reduce(
		(max, part) => Math.max(max, part.offset + part.bytes.length),
		head.length,
	);
	const file = Buffer.alloc(size, 0x00);
	head.copy(file, 0);
	for (const part of parts) part.bytes.copy(file, part.offset);
	return file;
}

/** A colour map of two hundred and fifty six entries of three bytes. */
function paletteBytes(): Buffer {
	const palette = Buffer.alloc(0x300, 0x00);
	for (let entry = 0; entry < 0x100; entry += 1) {
		palette[entry * 3] = entry;
		palette[entry * 3 + 1] = (entry + 1) & 0xff;
		palette[entry * 3 + 2] = (entry + 2) & 0xff;
	}
	return palette;
}

/** Runs of a count and a value. */
function runs(...pairs: Array<[number, number]>): Buffer {
	return Buffer.from(pairs.flatMap(([count, value]) => [count, value]));
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await digitalMonkeyPktImageFormat.open(
		new BufferByteSource(data),
		"pic.pkt",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Digital Monkey image", () => {
	it("reads the head of every version as the reference does", () => {
		const plain = pktFile({
			mark: "PKT10",
			width: 2,
			height: 1,
			data: Buffer.concat([paletteBytes(), Buffer.from([0x01, 0x02])]),
			dataOffset: 0x30,
		});
		expect(readPktLayout(plain)).toMatchObject({
			version: 10,
			width: 2,
			height: 1,
			bitsPerPixel: 8,
			dataOffset: 0x30,
			hasAlpha: false,
		});
		const colour = pktFile({
			mark: "PKT20",
			width: 2,
			height: 1,
			data: Buffer.alloc(6),
			dataOffset: 0x30,
		});
		expect(readPktLayout(colour)).toMatchObject({
			version: 20,
			bitsPerPixel: 24,
		});
		const grey = pktFile({
			mark: "PKT99",
			width: 2,
			height: 1,
			// The runs of the grey kind stand eight bytes of their own behind the place the head gives.
			alpha: Buffer.concat([Buffer.alloc(8, 0x00), runs([1, 0x80])]),
			alphaOffset: 0x30,
			alphaChunks: 1,
		});
		expect(readPktLayout(grey)).toMatchObject({
			version: 99,
			bitsPerPixel: 8,
			hasAlpha: false,
		});
	});

	it("gates on the marks, the word at five and the places", () => {
		const good = pktFile({
			mark: "PKT20",
			width: 2,
			height: 1,
			data: Buffer.alloc(6),
			dataOffset: 0x30,
		});
		expect(readPktLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("PKT30", 0, "latin1");
		expect(readPktLayout(mark)).toBeUndefined();
		const word = Buffer.from(good);
		word.writeUInt8(1, 5);
		expect(readPktLayout(word)).toBeUndefined();
		const width = Buffer.from(good);
		width.writeUInt32LE(0, 0x14);
		expect(readPktLayout(width)).toBeUndefined();
		// The pixels have to stand inside the file.
		const short = Buffer.from(good.subarray(0, 0x30));
		expect(readPktLayout(short)).toBeUndefined();
	});

	it("unwraps runs of a count and a value", () => {
		const output = Buffer.alloc(5, 0x00);
		unpackPktRle(runs([2, 0x11], [3, 0x22]), 0, 2, output);
		expect(output.toString("hex")).toBe("1111222222");
	});

	it("writes an eight bit picture out with its colour map", async () => {
		const out = await extract(
			pktFile({
				mark: "PKT10",
				width: 2,
				height: 1,
				data: Buffer.concat([paletteBytes(), Buffer.from([0x01, 0x02])]),
				dataOffset: 0x30,
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		// `ImageData.Create` keeps the stored order top down.
		expect(out.readInt32LE(0x16)).toBe(-1);
		// The colour map of the file is three bytes an entry, spread over four in the bitmap.
		expect(out.subarray(0x36, 0x36 + 8).toString("hex")).toBe(
			"0001020001020300",
		);
		expect(out.subarray(0x436, 0x43a).toString("hex")).toBe("01020000");
	});

	it("writes a twenty four bit picture out again", async () => {
		const out = await extract(
			pktFile({
				mark: "PKT20",
				width: 2,
				height: 1,
				data: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
				dataOffset: 0x30,
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("1122334455660000");
	});

	it("weaves the plane of fourth bytes into an eight bit picture", async () => {
		const out = await extract(
			pktFile({
				mark: "PKT10",
				width: 2,
				height: 1,
				data: Buffer.concat([paletteBytes(), Buffer.from([0x01, 0x02])]),
				dataOffset: 0x30,
				alpha: runs([2, 0x80]),
				alphaOffset: 0x30 + 0x300 + 2,
				alphaChunks: 1,
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// The colour of every pixel comes out of the map and the fourth byte out of the runs.
		expect(out.subarray(0x36).toString("hex")).toBe("0102038002030480");
	});

	it("weaves the plane of fourth bytes into a twenty four bit picture", async () => {
		const out = await extract(
			pktFile({
				mark: "PKT20",
				width: 2,
				height: 1,
				data: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
				dataOffset: 0x30,
				alpha: runs([1, 0x80], [1, 0x40]),
				alphaOffset: 0x30 + 6,
				alphaChunks: 2,
			}),
		);
		expect(out.subarray(0x36).toString("hex")).toBe("1122338044556640");
	});

	it("writes the grey kind out of its own runs", async () => {
		const out = await extract(
			pktFile({
				mark: "PKT99",
				width: 2,
				height: 1,
				alpha: Buffer.concat([Buffer.alloc(8, 0x00), runs([2, 0x80])]),
				alphaOffset: 0x30,
				alphaChunks: 1,
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.subarray(0x436, 0x43a).toString("hex")).toBe("80800000");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = pktFile({
			mark: "PKT20",
			width: 2,
			height: 1,
			data: Buffer.alloc(6),
			dataOffset: 0x30,
		});
		data.write("PKT30", 0, "latin1");
		await expect(
			digitalMonkeyPktImageFormat.open(new BufferByteSource(data), "pic.pkt"),
		).rejects.toThrow(GarbroError);
		await expect(
			digitalMonkeyPktImageFormat.open(new BufferByteSource(data), "pic.pkt"),
		).rejects.toThrow("Not a Digital Monkey picture");
	});
});
