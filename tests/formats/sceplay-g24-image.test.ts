import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	applyG2408Delta,
	applyG24ColorDelta,
	readG2408Layout,
	readG24aLayout,
	sceplayG2408ImageFormat,
	sceplayG24aImageFormat,
	unpackG24Rle,
} from "../../packages/formats/src/sceplay/g24-image.js";

/** An LZSS stream of literals alone: a control byte of eight set bits before every eight bytes. */
function literalLzss(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let start = 0; start < data.length; start += 8) {
		parts.push(Buffer.from([0xff]), data.subarray(start, start + 8));
	}
	return Buffer.concat(parts);
}

/** The word and the size behind the head, and then the walk itself. */
function g24Stream(signature: string, size: number, body: Buffer): Buffer {
	const head = Buffer.alloc(8, 0x00);
	Buffer.from(signature, "latin1").copy(head, 0);
	head.writeInt32LE(size, 4);
	return Buffer.concat([head, body]);
}

/** A twenty four bit picture: the head, the padding up to the stream and the walk. */
function g24aFile(input: {
	width: number;
	height: number;
	walk: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x2c, 0x00);
	Buffer.from("g24a", "latin1").copy(head, 0);
	head.writeUInt32LE(input.width, 8);
	head.writeUInt32LE(input.height, 0x0c);
	return Buffer.concat([head, input.walk]);
}

/** An eight bit picture: the head, the padding up to the stream and the walk. */
function g2408File(input: {
	width: number;
	height: number;
	walk: Buffer;
	kind?: string;
}): Buffer {
	const head = Buffer.alloc(0x30, 0x00);
	Buffer.from("g240", "latin1").copy(head, 0);
	head.writeUInt8((input.kind ?? "a").charCodeAt(0), 5);
	head.writeUInt32LE(input.width, 0x0c);
	head.writeUInt32LE(input.height, 0x10);
	return Buffer.concat([head, input.walk]);
}

async function extract(
	format: typeof sceplayG24aImageFormat,
	data: Buffer,
): Promise<Buffer> {
	const handle = await format.open(new BufferByteSource(data), "pic.g24");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Sceplayer image", () => {
	it("reads the head of both formats as the reference does", () => {
		const colour = g24aFile({
			width: 2,
			height: 1,
			walk: g24Stream("re", 6, Buffer.alloc(6)),
		});
		expect(readG24aLayout(colour)).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			stride: 6,
			streamOffset: 0x2c,
		});
		const grey = g2408File({
			width: 4,
			height: 1,
			walk: g24Stream("re", 4, Buffer.alloc(4)),
		});
		expect(readG2408Layout(grey)).toMatchObject({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			stride: 4,
			kind: "a",
		});
		// The letter behind the mark may be `b` as well.
		expect(
			readG2408Layout(
				g2408File({
					width: 4,
					height: 1,
					walk: g24Stream("re", 4, Buffer.alloc(4)),
					kind: "b",
				}),
			)?.kind,
		).toBe("b");
	});

	it("gates on the marks, the letter and the measurements", () => {
		const good = g24aFile({
			width: 2,
			height: 1,
			walk: g24Stream("re", 6, Buffer.alloc(6)),
		});
		expect(readG24aLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("g24b", 0, "latin1");
		expect(readG24aLayout(mark)).toBeUndefined();
		const width = Buffer.from(good);
		width.writeUInt32LE(0, 8);
		expect(readG24aLayout(width)).toBeUndefined();
		const short = Buffer.from(good.subarray(0, 0x2c));
		expect(readG24aLayout(short)).toBeUndefined();
		const letter = g2408File({
			width: 4,
			height: 1,
			walk: g24Stream("re", 4, Buffer.alloc(4)),
			kind: "c",
		});
		expect(readG2408Layout(letter)).toBeUndefined();
	});

	it("unfolds a run walk with its own mark", () => {
		const output = Buffer.alloc(8, 0x00);
		// A byte that stands, then the mark once, twice and then three times over.
		unpackG24Rle(
			Buffer.from([0x11, 0xf0, 0x00, 0xf0, 0x02, 0xf0, 0x03, 0x22]),
			0,
			output,
		);
		expect(output.toString("hex")).toBe("11f0f0f022222200");
	});

	it("steps the colour of every pixel from the one before it", () => {
		const pixels = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		applyG24ColorDelta(pixels);
		expect(pixels.toString("hex")).toBe("010203050709");
	});

	it("steps the grey of every pixel from the one behind it", () => {
		const pixels = Buffer.from([0x0a, 0x0b, 0x0c, 0x0d]);
		applyG2408Delta(pixels);
		expect(pixels.toString("hex")).toBe("2e24190d");
	});

	it("writes a twenty four bit picture out again", async () => {
		const out = await extract(
			sceplayG24aImageFormat,
			g24aFile({
				width: 2,
				height: 1,
				walk: g24Stream(
					"re",
					6,
					Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]),
				),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(1);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0102030507090000");
	});

	it("unfolds a picture behind the engine's own LZSS", async () => {
		const pixels = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		const out = await extract(
			sceplayG24aImageFormat,
			g24aFile({
				width: 2,
				height: 1,
				walk: g24Stream("le", 6, literalLzss(pixels)),
			}),
		);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0102030507090000");
	});

	it("writes an eight bit picture of each kind out again", async () => {
		const walk = g24Stream("re", 4, Buffer.from([0x0a, 0x0b, 0x0c, 0x0d]));
		const stepped = await extract(
			sceplayG2408ImageFormat,
			g2408File({ width: 4, height: 1, walk }),
		);
		expect(stepped.readUInt16LE(0x1c)).toBe(8);
		expect(stepped.subarray(0x436, 0x43a).toString("hex")).toBe("2e24190d");
		// The second kind stands as it stands.
		const plain = await extract(
			sceplayG2408ImageFormat,
			g2408File({ width: 4, height: 1, walk, kind: "b" }),
		);
		expect(plain.subarray(0x436, 0x43a).toString("hex")).toBe("0a0b0c0d");
	});

	it("refuses a walk it does not know", async () => {
		const data = g24aFile({
			width: 2,
			height: 1,
			walk: g24Stream("xx", 6, Buffer.alloc(6)),
		});
		const handle = await sceplayG24aImageFormat.open(
			new BufferByteSource(data),
			"pic.g24",
		);
		await expect(handle.openEntry("0")).rejects.toThrow(GarbroError);
		await expect(handle.openEntry("0")).rejects.toThrow(
			"a walk this reader does not know",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = g24aFile({
			width: 2,
			height: 1,
			walk: g24Stream("re", 6, Buffer.alloc(6)),
		});
		data.write("g24b", 0, "latin1");
		await expect(
			sceplayG24aImageFormat.open(new BufferByteSource(data), "pic.g24"),
		).rejects.toThrow("Not a Sceplayer picture");
	});
});
