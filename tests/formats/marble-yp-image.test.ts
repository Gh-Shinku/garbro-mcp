import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	marbleYpImageFormat,
	unpackYp,
} from "../../packages/formats/src/marble/yp-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

const FRAME_MASK = 0x3fff;
/** GARbro `YpFormat.CountTable`, which a run names its count through. */
const COUNT_TABLE: readonly number[] = [
	3, 4, 5, 6, 7, 8, 9, 0xa, 0xb, 0xc, 0xe, 0x10, 0x18, 0x20, 0x40, 0x80,
];

/** A count the reference's table holds, named by the number of its entry. */
function tableIndex(count: number): number {
	const index = COUNT_TABLE.indexOf(count);
	if (index === -1) throw new Error(`the count table holds no ${count}`);
	return index;
}

type Op = ["literal", number] | ["run", number, number];

/**
 * Packs what the reference unfolds: control bits from the highest down, a **set** bit meaning a run, and a
 * frame that is written to as the stream goes, so a run may copy what a run before it wrote.
 */
function ypPack(ops: Op[]): Buffer {
	const frame: Buffer = Buffer.alloc(0x4000, 0x00);
	let framePosition = 0;
	const chunks: Buffer[] = [];
	for (let start = 0; start < ops.length; start += 8) {
		const group = ops.slice(start, start + 8);
		const payload: Buffer[] = [];
		let control = 0;
		let bit = 0x80;
		for (const op of group) {
			if ("literal" === op[0]) {
				const value = op[1];
				payload.push(Buffer.from([value]));
				frame[framePosition++ & FRAME_MASK] = value;
			} else {
				control |= bit;
				const offset = op[1];
				const count = op[2];
				payload.push(
					Buffer.from([
						((offset & 0x0f) << 4) | (tableIndex(count) & 0x0f),
						(offset >> 4) & 0xff,
					]),
				);
				let source = framePosition - offset;
				for (let index = 0; index < count; index += 1) {
					const value = frame[source++ & FRAME_MASK] ?? 0;
					frame[framePosition++ & FRAME_MASK] = value;
				}
			}
			bit >>= 1;
		}
		chunks.push(Buffer.from([control]), ...payload);
	}
	return Buffer.concat(chunks);
}

/** A whole file: the two letters, the two lengths, and the packed stream. */
function ypFile(
	bitmap: Buffer,
	parts?: { unpackedSize?: number; packedSize?: number },
): Buffer {
	const stream = ypPack(Array.from(bitmap, (byte): Op => ["literal", byte]));
	const head: Buffer = Buffer.alloc(8, 0x00);
	head.write("YP", 0, "latin1");
	const unpacked = parts?.unpackedSize ?? bitmap.length;
	head[2] = unpacked & 0xff;
	head[3] = (unpacked >> 8) & 0xff;
	head[4] = (unpacked >> 16) & 0xff;
	const packed = parts?.packedSize ?? stream.length;
	head[5] = packed & 0xff;
	head[6] = (packed >> 8) & 0xff;
	head[7] = (packed >> 16) & 0xff;
	return Buffer.concat([head, stream]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await marbleYpImageFormat.open(
		new BufferByteSource(data),
		"marble.yp",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

const PIXELS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12];

describe("DarkNiteSystem image format", () => {
	it("finds a picture by the two letters of its header", async () => {
		const data = ypFile(writeBmp24(2, 2, Buffer.from(PIXELS)));
		expect(
			await marbleYpImageFormat.detect(new BufferByteSource(data), "marble.yp"),
		).toBe(true);
		const odd = Buffer.from(data);
		odd[0] = 0x58;
		expect(
			await marbleYpImageFormat.detect(new BufferByteSource(odd), "marble.yp"),
		).toBe(false);
		expect(
			await marbleYpImageFormat.detect(
				new BufferByteSource(Buffer.from("YP\0\0\0\0\0", "latin1")),
				"marble.yp",
			),
		).toBe(false);
	});

	it("reports the measurements of the bitmap behind the stream", async () => {
		const data = ypFile(writeBmp24(2, 2, Buffer.from(PIXELS)));
		const handle = await marbleYpImageFormat.open(
			new BufferByteSource(data),
			"dir/marble.yp",
		);
		expect(handle.entries[0]?.path).toBe("marble.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			unpackedSize: 70,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "lzss",
		});
	});

	it("unfolds the bitmap and writes it out again", async () => {
		const out = await extract(ypFile(writeBmp24(2, 2, Buffer.from(PIXELS))));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.subarray(0x36).toString("hex")).toBe(
			"01020304050600000708090a0b0c0000",
		);
	});

	it("takes the length the stream unfolds to and never looks at the packed one", async () => {
		// The stream unfolds to the bitmap the header promises; the packed length is what it is, and the
		// reference reads that word and never looks at it again.
		const bitmap = writeBmp24(2, 2, Buffer.from(PIXELS));
		const out = await extract(ypFile(bitmap, { packedSize: 1 }));
		expect(out.subarray(0x36, 0x3a).toString("hex")).toBe("01020304");
	});

	it("refuses a stream that stops in the middle of a literal", async () => {
		// The picture is claimed to be longer than the stream holds, and the control byte the stream ends with
		// promises eight literals with nothing behind them.
		const bitmap = writeBmp24(2, 2, Buffer.from(PIXELS));
		const file = Buffer.concat([
			ypFile(bitmap, { unpackedSize: 0x100 }),
			Buffer.from([0x00]),
		]);
		const handle = await marbleYpImageFormat.open(
			new BufferByteSource(file),
			"marble.yp",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(GarbroError);
		await expect(handle.openEntry(entry.id)).rejects.toThrow(
			"DarkNiteSystem picture is cut short of its stream",
		);
	});
});

describe("DarkNiteSystem packed stream", () => {
	it("copies a run backwards from behind the place the frame stands at", () => {
		// The frame is written to as the stream goes, so the third byte of the run is the byte the run itself
		// has just written.
		const out = unpackYp(
			ypPack([
				["literal", 0x41],
				["literal", 0x42],
				["run", 2, 3],
			]),
			5,
		);
		expect(out.toString("hex")).toBe("4142414241");
	});

	it("takes the count of a run from the table of the reference", () => {
		const out = unpackYp(
			ypPack([
				["literal", 0x11],
				["run", 1, 0x80],
			]),
			129,
		);
		expect(out.length).toBe(129);
		expect(out.subarray(0, 3).toString("hex")).toBe("111111");
		expect(out[128]).toBe(0x11);
	});

	it("holds a run to what is left of the picture", () => {
		const out = unpackYp(
			ypPack([
				["literal", 0x22],
				["run", 1, 0x80],
			]),
			2,
		);
		expect(out.toString("hex")).toBe("2222");
	});

	it("gives up where a control byte is wanted", () => {
		expect(unpackYp(Buffer.alloc(0), 4).toString("hex")).toBe("00000000");
	});

	it("refuses a stream that stops inside a literal", () => {
		expect(() => unpackYp(Buffer.from([0x00]), 4)).toThrow(GarbroError);
		expect(() => unpackYp(Buffer.from([0x00]), 4)).toThrow(
			"DarkNiteSystem picture is cut short of its stream",
		);
	});

	it("refuses a stream that stops inside a run", () => {
		expect(() => unpackYp(Buffer.from([0x80, 0x00]), 4)).toThrow(
			"DarkNiteSystem picture is cut short of its stream",
		);
	});
});
