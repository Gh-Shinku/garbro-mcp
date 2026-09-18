import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	adler32,
	keroqKgdImageFormat,
	readKgdLayout,
	restoreKgdPng,
} from "../../packages/formats/src/keroq/kgd-image.js";

/** The checksum the reference stands behind a chunk, worked out here on its own. */
function checksum(data: Buffer): number {
	let first = 1;
	let second = 0;
	for (const byte of data) {
		first = (first + byte) % 65521;
		second = (second + first) % 65521;
	}
	return ((second << 16) | first) >>> 0;
}

/** A picture: a head and then the pieces of its stream. */
function kgdFile(input: {
	width: number;
	height: number;
	bitsPerPlane?: number;
	colorType?: number;
	pieces?: Buffer[];
	kind?: number;
	mark?: number;
	kindField?: number;
	declare?: number;
}): Buffer {
	const head = Buffer.alloc(0x19, 0x00);
	Buffer.from([0x89, 0x4b, 0x47, 0x44]).copy(head, 0);
	head.writeInt32LE(input.mark ?? 0x10, 4);
	head.writeUInt8(input.kindField ?? 1, 8);
	head.writeUInt32LE(input.width, 9);
	head.writeUInt32LE(input.height, 0x0d);
	head.writeUInt8(input.bitsPerPlane ?? 8, 0x11);
	head.writeUInt8(input.colorType ?? 0, 0x12);
	const parts: Buffer[] = [head];
	for (const piece of input.pieces ?? [
		Buffer.from([0x08, 0xd7, 0x63, 0x18, 0x00]),
	]) {
		const size = Buffer.alloc(4, 0x00);
		size.writeUInt32LE(input.declare ?? piece.length, 0);
		parts.push(size, Buffer.from([input.kind ?? 2]), piece);
	}
	return Buffer.concat(parts);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await keroqKgdImageFormat.open(
		new BufferByteSource(data),
		"pic.kgd",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("KeroQ image", () => {
	it("reads the head as the reference does", () => {
		expect(readKgdLayout(kgdFile({ width: 2, height: 1 }))).toEqual({
			width: 2,
			height: 1,
			bitsPerPlane: 8,
			colorType: 0,
			bitsPerPixel: 8,
		});
		// Two trebles the bits of a plane, three means twenty four bits, four doubles them and six takes
		// them four times over.
		expect(
			readKgdLayout(kgdFile({ width: 2, height: 1, colorType: 2 }))
				?.bitsPerPixel,
		).toBe(24);
		expect(
			readKgdLayout(kgdFile({ width: 2, height: 1, colorType: 3 }))
				?.bitsPerPixel,
		).toBe(24);
		expect(
			readKgdLayout(kgdFile({ width: 2, height: 1, colorType: 4 }))
				?.bitsPerPixel,
		).toBe(16);
		expect(
			readKgdLayout(kgdFile({ width: 2, height: 1, colorType: 6 }))
				?.bitsPerPixel,
		).toBe(32);
	});

	it("gates on the mark, the kind byte and the kind of picture", () => {
		const good = kgdFile({ width: 2, height: 1 });
		expect(readKgdLayout(good)).toBeDefined();
		expect(
			readKgdLayout(kgdFile({ width: 2, height: 1, mark: 0x20 })),
		).toBeUndefined();
		expect(
			readKgdLayout(kgdFile({ width: 2, height: 1, kindField: 2 })),
		).toBeUndefined();
		// Only the kinds nought, two, three, four and six are read.
		expect(
			readKgdLayout(kgdFile({ width: 2, height: 1, colorType: 1 })),
		).toBeUndefined();
		expect(
			readKgdLayout(kgdFile({ width: 2, height: 1, colorType: 5 })),
		).toBeUndefined();
		expect(readKgdLayout(kgdFile({ width: 0, height: 1 }))).toBeUndefined();
	});

	it("works the checksum out as the compressed stream of the kind does", () => {
		// One byte of nought leaves both sums at one, and a byte of one climbs both of them.
		expect(adler32(Buffer.alloc(0))).toBe(1);
		expect(adler32(Buffer.from([0x00]))).toBe(0x00010001);
		expect(adler32(Buffer.from([0x01]))).toBe(0x00020002);
		// The header of a two by one picture of eight bit grey.
		expect(
			adler32(
				Buffer.from([
					0x00, 0x00, 0x00, 0x02, 0x00, 0x00, 0x00, 0x01, 0x08, 0x00, 0x00,
					0x00, 0x00,
				]),
			),
		).toBe(0x004f000c);
	});

	it("puts the signature, the header and the pieces back together", async () => {
		const out = await extract(
			kgdFile({
				width: 2,
				height: 1,
				pieces: [Buffer.from([0x08, 0xd7, 0x63, 0x18, 0x00])],
			}),
		);
		expect(out.subarray(0, 8).toString("hex")).toBe("89504e470d0a1a0a");
		// The header is thirteen bytes long and named for what it holds.
		expect(out.readUInt32BE(8)).toBe(13);
		expect(out.subarray(12, 16).toString("latin1")).toBe("IHDR");
		expect(out.readUInt32BE(0x10)).toBe(2);
		expect(out.readUInt32BE(0x14)).toBe(1);
		expect(out[0x18]).toBe(8);
		expect(out[0x19]).toBe(0);
		// Three bytes the engine leaves alone and then the checksum of the thirteen bytes.
		expect(out.subarray(0x1a, 0x1d).toString("hex")).toBe("000000");
		expect(out.readUInt32BE(0x1d)).toBe(checksum(out.subarray(0x10, 0x1d)));
		// Then the piece itself, as a chunk of the stream of the kind.
		const piece = Buffer.from([0x08, 0xd7, 0x63, 0x18, 0x00]);
		expect(out.readUInt32BE(0x21)).toBe(piece.length);
		expect(out.subarray(0x25, 0x29).toString("latin1")).toBe("IDAT");
		expect(out.subarray(0x29, 0x29 + piece.length).toString("hex")).toBe(
			piece.toString("hex"),
		);
		expect(out.readUInt32BE(0x29 + piece.length)).toBe(checksum(piece));
		// And the twelve bytes of the end.
		const end = 0x29 + piece.length + 4;
		expect(out.readUInt32BE(end)).toBe(0);
		expect(out.subarray(end + 4, end + 8).toString("latin1")).toBe("IEND");
		expect(out.readUInt32BE(end + 8)).toBe(0xae426082);
		expect(out.length).toBe(end + 12);
	});

	it("puts every piece of the stream back in the order it stands in", async () => {
		const first = Buffer.from([0x01, 0x02, 0x03]);
		const second = Buffer.from([0x04, 0x05, 0x06, 0x07]);
		const out = await extract(
			kgdFile({ width: 2, height: 1, pieces: [first, second] }),
		);
		expect(out.readUInt32BE(0x21)).toBe(first.length);
		expect(out.subarray(0x25, 0x29).toString("latin1")).toBe("IDAT");
		const behind = 0x21 + 12 + first.length;
		expect(out.readUInt32BE(behind)).toBe(second.length);
		expect(out.subarray(behind + 4, behind + 8).toString("latin1")).toBe(
			"IDAT",
		);
		expect(
			out.subarray(behind + 8, behind + 8 + second.length).toString("hex"),
		).toBe(second.toString("hex"));
	});

	it("declines a piece that is not part of the stream", async () => {
		const data = kgdFile({ width: 2, height: 1, kind: 3 });
		// The head still holds, so the picture is found and only its stream is turned away.
		expect(await keroqKgdImageFormat.detect(new BufferByteSource(data))).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"KeroQ picture holds a piece that is not part of its stream",
		);
	});

	it("declines a piece that does not stand inside the file", () => {
		// The piece says it is longer than it is.
		const data = kgdFile({ width: 2, height: 1, declare: 0x10 });
		expect(() =>
			restoreKgdPng(data, {
				width: 2,
				height: 1,
				bitsPerPlane: 8,
				colorType: 0,
				bitsPerPixel: 8,
			}),
		).toThrow("KeroQ picture is cut short of its stream");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = kgdFile({ width: 2, height: 1, mark: 0x20 });
		await expect(
			keroqKgdImageFormat.open(new BufferByteSource(data), "pic.kgd"),
		).rejects.toThrow(GarbroError);
		await expect(
			keroqKgdImageFormat.open(new BufferByteSource(data), "pic.kgd"),
		).rejects.toThrow("Not a KeroQ picture");
	});
});
