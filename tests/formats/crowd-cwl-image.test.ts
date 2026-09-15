import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	crowdCwdImageFormat,
	crowdCwlImageFormat,
	readCwdLayout,
	readCwdPixels,
	readCwlLayout,
	unfoldCwl,
} from "../../packages/formats/src/crowd/cwl-image.js";

const CWD_HEADER_SIZE = 0x38;
const CWD_TEXT = "cwd format  - version 1.00 -";
const KEY_BASE = 0x259a;
const SZDD_HEADER_SIZE = 0x0e;
const DATA_OFFSET = 0x42;

/** A picture of the plain format: the letters, the measurements behind the count and the pixels. */
function cwdFile(
	width: number,
	height: number,
	pixels: Buffer,
	keyByte = 0,
): Buffer {
	const key = keyByte + KEY_BASE;
	const head: Buffer = Buffer.alloc(CWD_HEADER_SIZE, 0x00);
	head.write(CWD_TEXT, 0, "latin1");
	head.writeUInt32LE((width - key) >>> 0, 0x2c);
	head.writeUInt32LE((height - key) >>> 0, 0x30);
	head[0x34] = keyByte;
	return Buffer.concat([head, pixels]);
}

/** A run of pixels, two bytes to the pixel, which carry the numbers given. */
function pixelRun(values: number[]): Buffer {
	const out: Buffer = Buffer.alloc(values.length * 2, 0x00);
	values.forEach((value, index) => {
		out.writeUInt16LE(value & 0xffff, index * 2);
	});
	return out;
}

/** The Microsoft variant of LZSS: control bytes least significant bit first, a set bit a byte of its own. */
class LzssWriter {
	private readonly groups: Array<{ control: number; payload: number[] }> = [];
	private control = 0;
	private payload: number[] = [];
	private ops = 0;

	literal(byte: number): this {
		this.control |= 1 << this.ops;
		this.payload.push(byte & 0xff);
		this.ops += 1;
		if (this.ops === 8) this.flush();
		return this;
	}

	private flush(): void {
		if (0 === this.ops) return;
		this.groups.push({ control: this.control, payload: this.payload });
		this.control = 0;
		this.payload = [];
		this.ops = 0;
	}

	finish(): Buffer {
		this.flush();
		const bytes: number[] = [];
		for (const { control, payload } of this.groups) {
			bytes.push(control, ...payload);
		}
		return Buffer.from(bytes);
	}
}

/** The picture written out a byte at a time, which is how the plain format looks inside the packed one. */
function literalsOf(data: Buffer): Buffer {
	const writer = new LzssWriter();
	for (const byte of data) writer.literal(byte);
	return writer.finish();
}

/** A packed picture: the fourteen byte header the length stands ten bytes into, and the pack behind it. */
function cwlFile(unfoldedSize: number, packed: Buffer): Buffer {
	const head: Buffer = Buffer.alloc(SZDD_HEADER_SIZE, 0x00);
	head.write("SZDD", 0, "latin1");
	head[4] = 0x41;
	head[5] = 0x5f;
	head.writeInt32LE(unfoldedSize, 10);
	return Buffer.concat([head, packed]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(
	format: typeof crowdCwdImageFormat,
	data: Buffer,
	sourcePath: string,
): Promise<Buffer> {
	const handle = await format.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Crowd picture formats", () => {
	it("finds a plain picture by the letters it begins with", async () => {
		const data = cwdFile(2, 1, pixelRun([0x1111, 0x2222]));
		expect(await crowdCwdImageFormat.detect(sourceOf(data), "cg.cwd")).toBe(
			true,
		);
		expect(readCwdLayout(data)).toEqual({ width: 2, height: 1 });
		// The four bytes alone are not enough: the reference checks the whole line of letters.
		const odd = Buffer.from(data);
		odd.write("cwd format  - version 1.01 -", 0, "latin1");
		expect(readCwdLayout(odd)).toBeUndefined();
		expect(
			readCwdLayout(Buffer.alloc(CWD_HEADER_SIZE - 1, 0x00)),
		).toBeUndefined();
		// A stored measurement that comes out at nothing once the count is put on it is turned away.
		const empty = cwdFile(2, 1, pixelRun([0, 0]));
		empty.writeUInt32LE(-KEY_BASE >>> 0, 0x2c);
		expect(readCwdLayout(empty)).toBeUndefined();
	});

	it("finds a packed picture by its four bytes", async () => {
		const inner = cwdFile(2, 1, pixelRun([0x1111, 0x2222]));
		const data = cwlFile(inner.length, literalsOf(inner));
		expect(await crowdCwlImageFormat.detect(sourceOf(data), "cg.cwl")).toBe(
			true,
		);
		expect(readCwlLayout(data)).toEqual({ width: 2, height: 1 });
		// A file that is not packed at all, or one whose pack does not unfold to a picture, is turned away.
		expect(readCwlLayout(cwdFile(2, 1, pixelRun([0, 0])))).toBeUndefined();
		expect(readCwlLayout(cwlFile(0, Buffer.alloc(0)))).toBeUndefined();
		expect(
			readCwlLayout(Buffer.alloc(SZDD_HEADER_SIZE - 1, 0x00)),
		).toBeUndefined();
	});

	it("raises the measurements by the count the byte at the end of the header gives", () => {
		const head: Buffer = Buffer.alloc(CWD_HEADER_SIZE, 0x00);
		head.write(CWD_TEXT, 0, "latin1");
		head.writeUInt32LE(3, 0x2c);
		head.writeUInt32LE(4, 0x30);
		head[0x34] = 0x66;
		expect(readCwdLayout(head)).toEqual({
			width: 3 + 0x66 + KEY_BASE,
			height: 4 + 0x66 + KEY_BASE,
		});
	});

	it("reports the measurements of a plain picture and writes it out as a high colour bitmap", async () => {
		const data = cwdFile(2, 2, pixelRun([0x001f, 0x03e0, 0x7c00, 0x7fff]));
		const handle = await crowdCwdImageFormat.open(sourceOf(data), "dir/cg.cwd");
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 16,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "none",
		});
		const bitmap = await extract(crowdCwdImageFormat, data, "cg.cwd");
		expect(bitmap.readUInt16LE(0x1c)).toBe(16);
		expect(bitmap.readUInt32LE(0x1e)).toBe(3);
		expect(bitmap.readInt32LE(0x16)).toBe(-2);
		// The masks of a high colour bitmap stand red, green and blue in that order.
		expect(bitmap.readUInt32LE(0x36)).toBe(0x7c00);
		expect(bitmap.readUInt32LE(0x3a)).toBe(0x03e0);
		expect(bitmap.readUInt32LE(0x3e)).toBe(0x001f);
		expect(bitmap.subarray(DATA_OFFSET, DATA_OFFSET + 8).toString("hex")).toBe(
			"1f00e003007cff7f",
		);
	});

	it("refuses a plain picture the file is short of", async () => {
		const data = cwdFile(2, 2, pixelRun([0x1111, 0x2222]));
		expect(await crowdCwdImageFormat.detect(sourceOf(data), "cg.cwd")).toBe(
			true,
		);
		await expect(extract(crowdCwdImageFormat, data, "cg.cwd")).rejects.toThrow(
			GarbroError,
		);
		await expect(extract(crowdCwdImageFormat, data, "cg.cwd")).rejects.toThrow(
			"Crowd picture is cut short of its pixels",
		);
	});

	it("unfolds the picture out of the packed stream", () => {
		const inner = cwdFile(2, 1, pixelRun([0x001f, 0x7fff]));
		const data = cwlFile(inner.length, literalsOf(inner));
		const unfolded = unfoldCwl(data);
		expect(unfolded?.toString("hex")).toBe(inner.toString("hex"));
		expect(readCwdLayout(unfolded ?? Buffer.alloc(0))).toEqual({
			width: 2,
			height: 1,
		});
		expect(
			readCwdPixels(unfolded ?? Buffer.alloc(0), {
				width: 2,
				height: 1,
			}).toString("hex"),
		).toBe("1f00ff7f");
	});

	it("reports the measurements of a packed picture and writes it out", async () => {
		const inner = cwdFile(
			3,
			2,
			pixelRun([0x001f, 0x03e0, 0x7c00, 0x0001, 0x0002, 0x0003]),
		);
		const data = cwlFile(inner.length, literalsOf(inner));
		const handle = await crowdCwlImageFormat.open(sourceOf(data), "cg.cwl");
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 3,
			height: 2,
			bitsPerPixel: 16,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "lzss",
		});
		const bitmap = await extract(crowdCwlImageFormat, data, "cg.cwl");
		expect(bitmap.readInt32LE(0x16)).toBe(-2);
		// The rows of a picture three pixels wide are padded to four bytes, and the padding is left as it was.
		expect(bitmap.subarray(DATA_OFFSET, DATA_OFFSET + 12).toString("hex")).toBe(
			"1f00e003007c000001000200",
		);
	});

	it("refuses a packed picture the stream is short of", async () => {
		const inner = cwdFile(2, 2, pixelRun([0x1111, 0x2222, 0x3333, 0x4444]));
		// The header says the pack unfolds to more than it holds, so the picture behind it is short.
		const data = cwlFile(
			inner.length,
			literalsOf(inner.subarray(0, inner.length - 2)),
		);
		await expect(extract(crowdCwlImageFormat, data, "cg.cwl")).rejects.toThrow(
			"Crowd picture is cut short of its pixels",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const data = cwdFile(0xffff, 0xffff, Buffer.alloc(0));
		expect(await crowdCwdImageFormat.detect(sourceOf(data), "cg.cwd")).toBe(
			true,
		);
		await expect(extract(crowdCwdImageFormat, data, "cg.cwd")).rejects.toThrow(
			"is too large",
		);
	});
});
