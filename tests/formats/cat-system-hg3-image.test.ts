import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	catSystemHg3ImageFormat,
	readHg3Layout,
} from "../../packages/formats/src/cat-system/hg3-image.js";

/** `GetBitCount` written the other way round: the zeros that lead and then the value's own bits. */
function bitCountCode(value: number): number[] {
	let zeros = 0;
	while (1 << (zeros + 1) <= value) zeros += 1;
	const bits: number[] = [];
	for (let index = 0; index < zeros; index += 1) bits.push(0);
	bits.push(1);
	for (let index = zeros - 1; index >= 0; index -= 1) {
		bits.push((value >> index) & 1);
	}
	return bits;
}

function packLsb(bits: number[]): Buffer {
	const packed = Buffer.alloc(Math.ceil(bits.length / 8), 0x00);
	bits.forEach((bit, index) => {
		if (bit !== 0) {
			packed[index >> 3] = (packed[index >> 3] ?? 0) | (1 << (index & 7));
		}
	});
	return packed;
}

/** A walk of a single run that copies the whole picture. */
function runStream(outputSize: number): Buffer {
	const bits: number[] = [1];
	bits.push(...bitCountCode(outputSize));
	bits.push(...bitCountCode(outputSize));
	return packLsb(bits);
}

/** 0x38 is where the standard head ends, so the section stands right behind it. */
const HEAD_SIZE = 0x38;

function hg3File(input: {
	width: number;
	height: number;
	bpp: number;
	pixels: Buffer;
	section?: string;
	headSize?: number;
}): Buffer {
	const headSize = input.headSize ?? HEAD_SIZE;
	const section = 0x14 + headSize;
	const pixelSize = input.bpp >> 3;
	const outputSize = input.width * pixelSize * input.height;
	const head = Buffer.alloc(0x4c, 0x00);
	Buffer.from("HG-3", "latin1").copy(head, 0);
	head.writeUInt32LE(0x0c, 0x04);
	Buffer.from("stdinfo\0", "latin1").copy(head, 0x14);
	head.writeUInt32LE(headSize, 0x1c);
	head.writeUInt32LE(input.width, 0x24);
	head.writeUInt32LE(input.height, 0x28);
	head.writeInt32LE(input.bpp, 0x2c);
	head.writeUInt32LE(input.width, 0x44);
	head.writeUInt32LE(input.height, 0x48);
	const body = Buffer.alloc(section + 0x28, 0x00);
	head.copy(body, 0);
	const name = input.section ?? "img0000\0";
	Buffer.from(name, "latin1").copy(body, section);
	if ("img0000\0" === name) {
		const packed = deflateSync(input.pixels);
		const control = deflateSync(runStream(outputSize));
		body.writeInt32LE(packed.length, section + 0x18);
		body.writeInt32LE(outputSize, section + 0x1c);
		body.writeInt32LE(control.length, section + 0x20);
		body.writeInt32LE(control.length, section + 0x24);
		return Buffer.concat([body, packed, control]);
	}
	return body;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await catSystemHg3ImageFormat.open(
		new BufferByteSource(data),
		"pic.hg3",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("CatSystem HG-3 image", () => {
	it("reads the head as the reference does", () => {
		const data = hg3File({
			width: 4,
			height: 1,
			bpp: 24,
			pixels: Buffer.alloc(12),
		});
		expect(readHg3Layout(data)).toMatchObject({
			kind: "plain",
			headerSize: HEAD_SIZE,
			width: 4,
			height: 1,
			bitsPerPixel: 24,
			canvasWidth: 4,
			canvasHeight: 1,
			dataOffset: 0x14 + HEAD_SIZE + 0x28,
			dataUnpacked: 12,
		});
	});

	it("reads the two kinds of picture whose own decoder it does not carry", () => {
		for (const section of ["img_jpg\0", "img_wbp\0"]) {
			const data = hg3File({
				width: 4,
				height: 1,
				bpp: 24,
				pixels: Buffer.alloc(12),
				section,
			});
			const layout = readHg3Layout(data);
			expect(layout?.kind).toBe("img_jpg\0" === section ? "jpeg" : "webp");
		}
	});

	it("gates on the mark, the version, the info mark and the section", () => {
		const good = hg3File({
			width: 4,
			height: 1,
			bpp: 24,
			pixels: Buffer.alloc(12),
		});
		expect(readHg3Layout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("HG-2", 0, "latin1");
		expect(readHg3Layout(mark)).toBeUndefined();
		const version = Buffer.from(good);
		version.writeUInt32LE(0x0d, 0x04);
		expect(readHg3Layout(version)).toBeUndefined();
		const info = Buffer.from(good);
		info.write("stdinfp\0", 0x14, "latin1");
		expect(readHg3Layout(info)).toBeUndefined();
		const section = Buffer.from(good);
		section.write("img0001\0", 0x14 + HEAD_SIZE, "latin1");
		expect(readHg3Layout(section)).toBeUndefined();
		// The depth has to be one the reader has a layout for.
		const depth = Buffer.from(good);
		depth.writeInt32LE(8, 0x2c);
		expect(readHg3Layout(depth)).toBeUndefined();
	});

	it("unfolds a plain picture of two zlib streams", async () => {
		const pixels = Buffer.alloc(12, 0x00);
		pixels[0] = 1;
		const out = await extract(
			hg3File({ width: 4, height: 1, bpp: 24, pixels }),
		);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(1);
		expect(out.subarray(0x36).toString("hex")).toBe("200000200000200000200000");
	});

	it("refuses a picture whose own decoder it does not carry", async () => {
		const data = hg3File({
			width: 4,
			height: 1,
			bpp: 24,
			pixels: Buffer.alloc(12),
			section: "img_jpg\0",
		});
		const handle = await catSystemHg3ImageFormat.open(
			new BufferByteSource(data),
			"pic.hg3",
		);
		expect(handle.entries).toHaveLength(1);
		await expect(handle.openEntry("0")).rejects.toThrow(GarbroError);
		await expect(handle.openEntry("0")).rejects.toThrow(
			"behind a jpeg section is not supported",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = hg3File({
			width: 4,
			height: 1,
			bpp: 24,
			pixels: Buffer.alloc(12),
		});
		data.write("HG-2", 0, "latin1");
		await expect(
			catSystemHg3ImageFormat.open(new BufferByteSource(data), "pic.hg3"),
		).rejects.toThrow("Not a CatSystem picture");
	});
});
