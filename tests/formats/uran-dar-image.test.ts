import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readDarLayout,
	unpackDar,
	uranDarImageFormat,
} from "../../packages/formats/src/uran/dar-image.js";

const FRAME_HEAD_OFFSET = 0x40c;

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

interface Row {
	x: number;
	data: Buffer;
}

/** A row run: its offset into the row, its length and its bytes. */
function rowBytes(rows: Row[]): Buffer {
	const chunks: Buffer[] = [];
	for (const row of rows) {
		const head = Buffer.alloc(4);
		head.writeInt16LE(row.x, 0);
		head.writeUInt16LE(row.data.length, 2);
		chunks.push(head, row.data);
	}
	return Buffer.concat(chunks);
}

/** The first version: its head size and the table that says where the depth stands. */
function darV1(
	width: number,
	height: number,
	rows: Row[],
	bpp = 24,
	palette?: Buffer,
): Buffer {
	const headSize = 0x30;
	const frameHead = FRAME_HEAD_OFFSET + 2;
	const data = Buffer.alloc(frameHead + headSize + 0x40);
	Buffer.from("DAR:", "latin1").copy(data, 0);
	data[4] = 0x38;
	data[5] = 1;
	data.writeUInt16LE(1, 6);
	if (palette) palette.copy(data, 0xc);
	data.writeUInt16LE(headSize, FRAME_HEAD_OFFSET);
	data.writeUInt16LE(width, frameHead);
	data.writeUInt16LE(height, frameHead + 2);
	data.writeUInt16LE(
		rows.length > 0 ? 4 + (rows[0]?.data.length ?? 0) : 0,
		frameHead + 4,
	);
	data.writeUInt16LE(0, frameHead + 6);
	// The count of the table stands at fourteen and the depth at the count behind it.
	data[frameHead + 14] = 1;
	data[frameHead + 15] = bpp;
	const rowsData = rowBytes(rows);
	const frameOffset = frameHead + headSize;
	rowsData.copy(data, frameOffset);
	return data.subarray(0, frameOffset + rowsData.length);
}

/** The nothing version: its head is always eight bytes and its depth always eight bits. */
function darV0(
	width: number,
	height: number,
	rows: Row[],
	palette: Buffer,
): Buffer {
	const frameHead = FRAME_HEAD_OFFSET;
	const data = Buffer.alloc(frameHead + 8 + 0x40);
	Buffer.from("DAR:", "latin1").copy(data, 0);
	data[4] = 0x38;
	data[5] = 0;
	data.writeUInt16LE(1, 6);
	palette.copy(data, 0xc);
	data.writeUInt16LE(width, frameHead);
	data.writeUInt16LE(height, frameHead + 2);
	data.writeUInt16LE(
		rows.length > 0 ? 4 + (rows[0]?.data.length ?? 0) : 0,
		frameHead + 4,
	);
	data.writeUInt16LE(0, frameHead + 6);
	const rowsData = rowBytes(rows);
	const frameOffset = frameHead + 8;
	rowsData.copy(data, frameOffset);
	return data.subarray(0, frameOffset + rowsData.length);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await uranDarImageFormat.open(
		new BufferByteSource(data),
		"pic.dar",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Uran image", () => {
	it("reads the head of the first version", () => {
		const data = darV1(2, 1, [{ x: 0, data: Buffer.alloc(6) }]);
		expect(readDarLayout(data)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			version: 1,
			frameCount: 1,
			frameOffset: FRAME_HEAD_OFFSET + 2 + 0x30,
			rowSize: 10,
		});
	});

	it("reads the head of the nothing version as eight bits a pixel", () => {
		const data = darV0(2, 2, [], paletteBytes());
		expect(readDarLayout(data)).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 8,
			version: 0,
			frameOffset: FRAME_HEAD_OFFSET + 8,
		});
	});

	it("gates on the two marker bytes, the version and the count of frames", () => {
		const good = darV1(2, 1, [{ x: 0, data: Buffer.alloc(6) }]);
		expect(readDarLayout(good)).toBeDefined();
		const marker = Buffer.from(good);
		marker[4] = 0x39;
		expect(readDarLayout(marker)).toBeUndefined();
		const version = Buffer.from(good);
		version[5] = 2;
		expect(readDarLayout(version)).toBeUndefined();
		const frames = Buffer.from(good);
		frames.writeUInt16LE(0, 6);
		expect(readDarLayout(frames)).toBeUndefined();
		// A depth the reader does not know is turned away.
		const odd = darV1(2, 1, [{ x: 0, data: Buffer.alloc(6) }], 16);
		expect(readDarLayout(odd)).toBeUndefined();
	});

	it("places the runs of the rows bottom up", async () => {
		const data = darV0(
			2,
			2,
			[
				{ x: 0, data: Buffer.from([0, 1]) },
				{ x: 0, data: Buffer.from([2, 3]) },
			],
			paletteBytes(),
		);
		const layout = readDarLayout(data);
		if (!layout) throw new Error("no layout");
		// The first row of the stream becomes the last row of the picture.
		expect(unpackDar(data, layout).toString("hex")).toBe("02030001");
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0001020001020300");
		expect(out.subarray(0x436).toString("hex")).toBe("0203000000010000");
	});

	it("places a run at an offset inside its own row", async () => {
		const data = darV1(2, 1, [
			{ x: 2, data: Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]) },
		]);
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.subarray(54, 62).toString("hex")).toBe("0000aabbccdd0000");
	});

	it("refuses a run that reaches outside the picture", () => {
		const data = darV1(2, 1, [{ x: 4, data: Buffer.from([1, 2, 3, 4]) }]);
		const layout = readDarLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => unpackDar(data, layout)).toThrow(GarbroError);
		expect(() => unpackDar(data, layout)).toThrow("past its own end");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = darV1(2, 1, [{ x: 0, data: Buffer.alloc(6) }], 16);
		await expect(
			uranDarImageFormat.open(new BufferByteSource(data), "pic.dar"),
		).rejects.toThrow(GarbroError);
		await expect(
			uranDarImageFormat.open(new BufferByteSource(data), "pic.dar"),
		).rejects.toThrow("Not a Uran picture");
	});
});
