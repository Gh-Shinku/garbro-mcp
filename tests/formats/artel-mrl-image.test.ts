import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	artelMrlImageFormat,
	decryptMrl,
	mrlDecompress,
	readMrlLayout,
	restoreMrl,
} from "../../packages/formats/src/artel/mrl-image.js";

const HEADER_SIZE = 0x18;
const INPUT_KEY = 8;

interface MrlOptions {
	width?: number;
	height?: number;
	/** The depth in bytes, as the head declares it. */
	depth?: number;
	flags?: number;
}

/** A file: the head and then the turned over stream. */
function mrlFile(stream: Buffer, options: MrlOptions = {}): Buffer {
	const head = Buffer.alloc(HEADER_SIZE);
	Buffer.from("MuMR", "latin1").copy(head, 0);
	head[4] = 0x4c;
	head[8] = options.flags ?? 0;
	head.writeUInt16LE(options.depth ?? 3, 0xc);
	head.writeUInt32LE(options.width ?? 2, 0x10);
	head.writeUInt32LE(options.height ?? 1, 0x14);
	return Buffer.concat([head, stream]);
}

/** A file of eight bits, whose colour map stands between the head and the stream. */
function mrlFileWithPalette(
	stream: Buffer,
	palette: Buffer,
	options: MrlOptions = {},
): Buffer {
	const file = mrlFile(stream, { ...options, depth: 1 });
	const head = file.subarray(0, HEADER_SIZE);
	return Buffer.concat([head, palette, file.subarray(HEADER_SIZE)]);
}

/** The inverse of `RestoreOutput`, so a stream unfolds to the channel planes a test wants. */
function inverseRestore(restored: Buffer): Buffer {
	const store = Buffer.alloc(restored.length);
	if (restored.length === 0) return store;
	store[0] = restored[0] ?? 0;
	for (let index = 1; index < restored.length; index += 1) {
		store[index] = (restored[index] ?? 0) ^ (restored[index - 1] ?? 0);
	}
	return store;
}

/** The run length code the reference unfolds: a byte of nothing stands for a run of zeros. */
function rleEncode(data: Buffer): Buffer {
	const chunks: number[] = [];
	let index = 0;
	while (index < data.length) {
		const value = data[index] ?? 0;
		if (value !== 0) {
			chunks.push(value);
			index += 1;
			continue;
		}
		let run = 0;
		while (index + run < data.length && data[index + run] === 0) run += 1;
		chunks.push(0);
		let remaining = run - 1;
		while (remaining >= 0xff) {
			chunks.push(0xff);
			remaining -= 0xff;
		}
		chunks.push(remaining);
		index += run;
	}
	return Buffer.from(chunks);
}

/** The whole stream of a file: the planes walked, run length coded and turned over. */
function mrlStream(planes: Buffer): Buffer {
	const pre = rleEncode(inverseRestore(planes));
	const stored: number[] = [];
	for (let index = 0; index < pre.length; index += 1) {
		stored.push((pre[index] ?? 0) ^ ((INPUT_KEY + index) & 0xff));
	}
	return Buffer.from(stored);
}

async function extract(data: Buffer, name = "pic.mrl"): Promise<Buffer> {
	const handle = await artelMrlImageFormat.open(
		new BufferByteSource(data),
		name,
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** A colour map whose entry `i` is the four bytes `i`, `i + 1`, `i + 2`, nothing. */
function paletteBytes(): Buffer {
	const palette = Buffer.alloc(0x400);
	for (let i = 0; i < 0x100; i += 1) {
		palette[i * 4] = i;
		palette[i * 4 + 1] = (i + 1) & 0xff;
		palette[i * 4 + 2] = (i + 2) & 0xff;
	}
	return palette;
}

describe("Artel ADVG engine image", () => {
	it("reads the head as the reference does", () => {
		expect(readMrlLayout(mrlFile(Buffer.alloc(0), { depth: 3 }))).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			hasAlpha: false,
		});
		// A picture of twenty four bits with an alpha channel is reported as thirty two.
		expect(
			readMrlLayout(mrlFile(Buffer.alloc(0), { depth: 3, flags: 8 })),
		).toMatchObject({ bitsPerPixel: 32, hasAlpha: true });
		// And the eight bit kind gives the depth in bytes.
		expect(readMrlLayout(mrlFile(Buffer.alloc(0), { depth: 1 }))).toMatchObject(
			{ bitsPerPixel: 8 },
		);
	});

	it("gates on the signature, the tag and the depth", () => {
		const good = mrlFile(Buffer.alloc(0));
		expect(readMrlLayout(good)).toBeDefined();
		const other = Buffer.from(good);
		other.write("MuMS", 0, "latin1");
		expect(readMrlLayout(other)).toBeUndefined();
		const tag = Buffer.from(good);
		tag[4] = 0x4d;
		expect(readMrlLayout(tag)).toBeUndefined();
		// A depth of sixteen bits is not one the reader knows.
		expect(
			readMrlLayout(mrlFile(Buffer.alloc(0), { depth: 2 })),
		).toBeUndefined();
		// Nor is a picture of no size.
		expect(
			readMrlLayout(mrlFile(Buffer.alloc(0), { width: 0 })),
		).toBeUndefined();
	});

	it("turns the stream over and walks it differentially", () => {
		expect(decryptMrl(Buffer.from([1, 2, 3])).toString("hex")).toBe(
			[1 ^ 8, 2 ^ 9, 3 ^ 10]
				.map((value) => value.toString(16).padStart(2, "0"))
				.join(""),
		);
		// The first byte stands and every byte behind it carries the one before it.
		expect(restoreMrl(Buffer.from([1, 2, 3])).toString("hex")).toBe("010300");
	});

	it("unfolds a run length code of zeros", () => {
		expect(mrlDecompress(Buffer.from([0x00, 0x02]), 3).toString("hex")).toBe(
			"000000",
		);
		expect(mrlDecompress(Buffer.from([0x00, 0xff, 0x01]), 257).length).toBe(
			257,
		);
		expect(
			mrlDecompress(Buffer.from([0x05, 0x00, 0x00]), 2).toString("hex"),
		).toBe("0500");
		// A run that is not ended by the stream is refused.
		expect(() => mrlDecompress(Buffer.from([0x00, 0xff]), 300)).toThrow(
			"cut short",
		);
	});

	it("reports the measurements of the picture", async () => {
		const handle = await artelMrlImageFormat.open(
			new BufferByteSource(
				mrlFile(mrlStream(Buffer.alloc(8, 1)), {
					width: 2,
					height: 1,
					depth: 4,
					flags: 8,
				}),
			),
			"dir/pic.mrl",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.encrypted).toBe(true);
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "rle",
			encrypted: true,
		});
	});

	it("reads a plane a channel into the interleaved pixels a bitmap wants", async () => {
		// Two pixels of three channels: blue `01`, `02`, green `03`, `04`, red `05`, `06`.
		const planes = Buffer.from([1, 2, 3, 4, 5, 6]);
		const out = await extract(mrlFile(mrlStream(planes), { depth: 3 }));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(1);
		expect(out.subarray(54, 62).toString("hex")).toBe("0103050204060000");
	});

	it("reads an eight bit picture through its colour map", async () => {
		const planes = Buffer.from([0, 1, 2, 3]);
		const out = await extract(
			mrlFileWithPalette(mrlStream(planes), paletteBytes(), {
				width: 2,
				height: 2,
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0001020001020300");
		expect(out.subarray(0x436).toString("hex")).toBe("0001000002030000");
	});

	it("reads a thirty two bit picture with its alpha channel", async () => {
		// Four channels of one pixel: blue, green, red and alpha.
		const planes = Buffer.from([1, 2, 3, 4]);
		const out = await extract(
			mrlFile(mrlStream(planes), { width: 1, height: 1, depth: 4, flags: 8 }),
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.subarray(54, 58).toString("hex")).toBe("01020304");
	});

	it("refuses an eight bit picture with an alpha channel and no place to hold it", async () => {
		const data = mrlFileWithPalette(
			mrlStream(Buffer.from([0, 1, 2, 3])),
			paletteBytes(),
			{ width: 2, height: 2, flags: 8 },
		);
		expect(
			await artelMrlImageFormat.detect(new BufferByteSource(data), "pic.mrl"),
		).toBe(false);
		const handle = await artelMrlImageFormat.open(
			new BufferByteSource(data),
			"pic.mrl",
		);
		await expect(handle.openEntry("0")).rejects.toThrow(GarbroError);
		await expect(handle.openEntry("0")).rejects.toThrow("without a place");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = mrlFile(Buffer.alloc(0), { depth: 2 });
		await expect(
			artelMrlImageFormat.open(new BufferByteSource(data), "pic.mrl"),
		).rejects.toThrow(GarbroError);
		await expect(
			artelMrlImageFormat.open(new BufferByteSource(data), "pic.mrl"),
		).rejects.toThrow("Not an Artel picture");
	});
});
