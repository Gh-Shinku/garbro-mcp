import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	ipacIesImageFormat,
	ipacIesRawImageFormat,
	readIesLayout,
	readIesRawLayout,
} from "../../packages/formats/src/ipac/ies-image.js";

const SIGNED_HEADER_SIZE = 0x14;
const SIGNED_PALETTE_OFFSET = 0x20;
const SIGNED_PIXEL_OFFSET = 0x420;
const RAW_HEADER_SIZE = 0x10;
const RAW_PALETTE_OFFSET = 0x14;
const RAW_PIXEL_OFFSET = 0x414;

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

/** A file of the signed kind: the head, its colour map when it has one, padding and then the payload. */
function signedFile(
	payload: Buffer,
	depth: number,
	width = 2,
	height = 1,
): Buffer {
	const head = Buffer.alloc(SIGNED_HEADER_SIZE);
	Buffer.from("IES2", "latin1").copy(head, 0);
	head.writeUInt32LE(width, 8);
	head.writeUInt32LE(height, 0xc);
	head.writeInt32LE(depth, 0x10);
	const parts: Buffer[] = [head];
	let used = SIGNED_HEADER_SIZE;
	if (depth === 8) {
		parts.push(Buffer.alloc(SIGNED_PALETTE_OFFSET - used), paletteBytes());
		used = SIGNED_PALETTE_OFFSET + 0x400;
	}
	if (used < SIGNED_PIXEL_OFFSET) {
		parts.push(Buffer.alloc(SIGNED_PIXEL_OFFSET - used));
	}
	parts.push(payload);
	return Buffer.concat(parts);
}

/** A file of the raw kind: the head, a four byte gap, the colour map and then the pixels. */
function rawFile(
	payload: Buffer,
	depth: number,
	width = 2,
	height = 1,
): Buffer {
	const head = Buffer.alloc(RAW_HEADER_SIZE);
	head.writeUInt32LE(width, 0);
	head.writeUInt32LE(height, 4);
	head.writeInt32LE(depth, 8);
	head.writeInt32LE(0, 0xc);
	return Buffer.concat([head, Buffer.alloc(4), paletteBytes(), payload]);
}

async function extract(
	format: typeof ipacIesImageFormat | typeof ipacIesRawImageFormat,
	data: Buffer,
	name: string,
): Promise<Buffer> {
	const handle = await format.open(new BufferByteSource(data), name);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("IPAC signed picture", () => {
	it("reads the head as the reference does", () => {
		const data = signedFile(Buffer.alloc(0), 24, 4, 3);
		expect(readIesLayout(data)).toEqual({
			width: 4,
			height: 3,
			bitsPerPixel: 24,
		});
	});

	it("finds a picture by its signature and declines a depth it cannot read", async () => {
		const good = signedFile(Buffer.alloc(0), 24);
		expect(
			await ipacIesImageFormat.detect(new BufferByteSource(good), "pic.ies"),
		).toBe(true);
		// Only eight and twenty four bits a pixel are read.
		const odd = signedFile(Buffer.alloc(0), 32);
		expect(readIesLayout(odd)).toBeUndefined();
		const other = Buffer.from(good);
		other.write("IES3", 0, "latin1");
		expect(readIesLayout(other)).toBeUndefined();
	});

	it("merges a twenty four bit picture with its alpha channel", async () => {
		const rgb = Buffer.from([1, 2, 3, 0x0b, 0x0c, 0x0d]);
		const alpha = Buffer.from([0x40, 0x80]);
		const out = await extract(
			ipacIesImageFormat,
			signedFile(Buffer.concat([rgb, alpha]), 24),
			"pic.ies",
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.subarray(54, 62).toString("hex")).toBe("010203400b0c0d80");
	});

	it("reads the colour map of an eight bit picture", async () => {
		const out = await extract(
			ipacIesImageFormat,
			signedFile(Buffer.from([0, 1]), 8),
			"pic.ies",
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		// The colour map stands at 0x20 and its entries are red, green, blue and nothing.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0201000003020100");
		expect(out.subarray(0x436).toString("hex")).toBe("00010000");
	});

	it("refuses a picture that is cut short of its pixels", async () => {
		const data = signedFile(Buffer.from([1, 2, 3]), 24);
		const handle = await ipacIesImageFormat.open(
			new BufferByteSource(data),
			"pic.ies",
		);
		await expect(handle.openEntry("0")).rejects.toThrow(GarbroError);
		await expect(handle.openEntry("0")).rejects.toThrow("cut short");
	});
});

describe("IPAC raw picture", () => {
	it("reads the head and checks the size of the pixels", () => {
		const pixels = Buffer.alloc(8);
		const data = rawFile(pixels, 32);
		expect(readIesRawLayout(data, "pic.ies", data.length)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
		// The pixels have to be exactly the size the measurements and the depth ask for.
		expect(readIesRawLayout(data, "pic.ies", data.length + 1)).toBeUndefined();
		// And the reference only looks at a file whose name carries the extension.
		expect(readIesRawLayout(data, "pic.bin", data.length)).toBeUndefined();
	});

	it("writes a thirty two bit picture out as it stands", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 0x0b, 0x0c, 0x0d, 0x0e]);
		const out = await extract(
			ipacIesRawImageFormat,
			rawFile(pixels, 32),
			"pic.ies",
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.subarray(54, 62).toString("hex")).toBe("010203040b0c0d0e");
	});

	it("reads the colour map of an eight bit picture", async () => {
		const out = await extract(
			ipacIesRawImageFormat,
			rawFile(Buffer.from([0, 1]), 8),
			"pic.ies",
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0201000003020100");
		expect(out.subarray(0x436).toString("hex")).toBe("00010000");
	});

	it("finds only a file whose head and size agree", async () => {
		const data = rawFile(Buffer.alloc(8), 32);
		expect(
			await ipacIesRawImageFormat.detect(new BufferByteSource(data), "pic.ies"),
		).toBe(true);
		const reserved = Buffer.from(data);
		reserved.writeInt32LE(1, 0xc);
		expect(
			await ipacIesRawImageFormat.detect(
				new BufferByteSource(reserved),
				"pic.ies",
			),
		).toBe(false);
	});
});
