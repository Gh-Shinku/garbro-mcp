import { BufferByteSource } from "@garbro-mcp/core";
import { rbmImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 10;

type Op =
	| { kind: "literal"; pixel: [number, number, number] }
	| { kind: "match"; offsetPixels: number; countPixels: number };

function header(width: number, height: number, marker = "RBM"): Buffer {
	const bytes: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	bytes.write(marker, 0, "latin1");
	bytes.writeUInt16LE(width, 6);
	bytes.writeUInt16LE(height, 8);
	return bytes;
}

/**
 * The control bits of one byte are used from the most significant end downwards, and each bit's payload
 * follows the control byte in the same order — so the payloads of a group are collected and emitted with it.
 */
function buildPayLoad(ops: Op[]): Buffer {
	const out: number[] = [];
	for (let start = 0; start < ops.length; start += 8) {
		const group = ops.slice(start, start + 8);
		let control = 0;
		const payload: number[] = [];
		for (let index = 0; index < group.length; index += 1) {
			const op = group[index];
			if (!op) continue;
			if (op.kind === "match") {
				control |= 0x80 >> index;
				const word =
					((op.offsetPixels - 1) << 4) | ((op.countPixels - 1) & 0x0f);
				payload.push(word & 0xff, (word >> 8) & 0xff);
			} else {
				payload.push(...op.pixel);
			}
		}
		out.push(control, ...payload);
	}
	return Buffer.from(out);
}

function buildRbm(
	width: number,
	height: number,
	ops: Op[],
	options: { marker?: string; trailingBytes?: Buffer } = {},
): Buffer {
	return Buffer.concat([
		header(width, height, options.marker),
		buildPayLoad(ops),
		options.trailingBytes ?? Buffer.alloc(0),
	]);
}

/** One op per pixel: every pixel as a literal. */
function literalsOf(pixels: Buffer): Op[] {
	const ops: Op[] = [];
	for (let index = 0; index < pixels.length; index += 3) {
		ops.push({
			kind: "literal",
			pixel: [
				pixels[index] ?? 0,
				pixels[index + 1] ?? 0,
				pixels[index + 2] ?? 0,
			],
		});
	}
	return ops;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.rbm"): Promise<Buffer> {
	const archive = await rbmImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("mutation compressed image", () => {
	it("declares the three byte marker and no extension", () => {
		expect(rbmImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x52, 0x42, 0x4d]) },
		]);
		expect(rbmImageFormat.descriptor.extensions).toEqual([]);
		expect(rbmImageFormat.descriptor.id).toBe("mutation-rbm-image");
	});

	it("checks the marker, and no more than the reference does", async () => {
		const ops: Op[] = [{ kind: "literal", pixel: [1, 2, 3] }];
		expect(
			await rbmImageFormat.detect(sourceOf(buildRbm(1, 1, ops)), "A.rbm"),
		).toBe(true);
		expect(
			await rbmImageFormat.detect(
				sourceOf(buildRbm(1, 1, ops, { marker: "XBM" })),
				"A.rbm",
			),
		).toBe(false);
		expect(
			await rbmImageFormat.detect(
				sourceOf(header(1, 1).subarray(0, 9)),
				"A.rbm",
			),
		).toBe(false);
		// The fourth byte is not part of the signature — the reference's value has a zero high byte, so nothing
		// compares it.
		const strayFourth = buildRbm(1, 1, ops);
		strayFourth[3] = 0xff;
		expect(await rbmImageFormat.detect(sourceOf(strayFourth), "A.rbm")).toBe(
			true,
		);
	});

	it("reports the dimensions as sixteen bit words", async () => {
		const archive = await rbmImageFormat.open(
			sourceOf(buildRbm(3, 2, literalsOf(Buffer.alloc(18, 0x40)))),
			"CG_01.RBM",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_01.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
	});

	it("writes bottom up rows, padding what the stored stride leaves out", async () => {
		// Three pixels a row is nine bytes, which a bitmap pads to twelve; the stored rows are tighter than that.
		const pixels = Buffer.from([
			0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc,
			0xdd, 0xee, 0xff, 0x01, 0x02, 0x03,
		]);
		const output = await extract(buildRbm(3, 2, literalsOf(pixels)));
		expect(output.readUInt16LE(28)).toBe(24);
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.readUInt32LE(34)).toBe(24);
		const data = output.subarray(54);
		expect(data.subarray(0, 9)).toEqual(pixels.subarray(0, 9));
		expect(data.subarray(9, 12)).toEqual(Buffer.alloc(3, 0x00));
		expect(data.subarray(12, 21)).toEqual(pixels.subarray(9, 18));
		expect(data.subarray(21, 24)).toEqual(Buffer.alloc(3, 0x00));
	});

	it("reads a match, including one that overlaps its own output", async () => {
		// The first pixel is a literal and the match repeats it for the rest of the row: fifteen more pixels,
		// which is exactly what the sixteen pixel row has left.
		const ops: Op[] = [
			{ kind: "literal", pixel: [0x5a, 0x6b, 0x7c] },
			{ kind: "match", offsetPixels: 1, countPixels: 15 },
		];
		const output = await extract(buildRbm(16, 1, ops));
		const data = output.subarray(54);
		for (let pixel = 0; pixel < 16; pixel += 1) {
			expect(data.subarray(pixel * 3, pixel * 3 + 3)).toEqual(
				Buffer.from([0x5a, 0x6b, 0x7c]),
			);
		}
	});

	it("takes the first control bit from the top of the byte", async () => {
		// Two pixels: the first is a literal and the second is a match that copies it. Reading the bits from the
		// bottom would take both as literals and consume the match word as colour bytes instead.
		const ops: Op[] = [
			{ kind: "literal", pixel: [0x10, 0x20, 0x30] },
			{ kind: "match", offsetPixels: 1, countPixels: 1 },
		];
		const file = buildRbm(2, 1, ops);
		// One control byte, then the three literal bytes and the two match bytes. A literal is a **clear** bit,
		// so only the match's bit is set: the byte is 0x40, which the decoder reads second.
		expect(file.length).toBe(HEADER_SIZE + 1 + 3 + 2);
		expect(file[HEADER_SIZE]).toBe(0x40);
		const output = await extract(file);
		// Two pixels are six bytes, which the bitmap pads to eight.
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x10, 0x20, 0x30, 0x10, 0x20, 0x30, 0x00, 0x00]),
		);
	});

	it("rejects a match that reaches outside the image", async () => {
		// A match before anything has been written would read from a negative offset.
		await expect(
			extract(
				buildRbm(2, 1, [{ kind: "match", offsetPixels: 1, countPixels: 2 }]),
			),
		).rejects.toThrow();
		// A match that asks for more pixels than are left.
		await expect(
			extract(
				buildRbm(2, 1, [
					{ kind: "literal", pixel: [1, 2, 3] },
					{ kind: "match", offsetPixels: 1, countPixels: 4 },
				]),
			),
		).rejects.toThrow();
	});

	it("fills only what a truncated literal supplies", async () => {
		// The last literal has two of its three bytes, and the loop ends there, so the third stays zero.
		const ops: Op[] = [{ kind: "literal", pixel: [0x77, 0x88, 0x99] }];
		const complete = buildRbm(1, 1, ops);
		const output = await extract(complete.subarray(0, complete.length - 1));
		// One pixel is three bytes, which the bitmap pads to four; the pad byte is a zero, as is the byte the
		// truncated literal never supplied.
		expect(output.subarray(54)).toEqual(Buffer.from([0x77, 0x88, 0x00, 0x00]));
		// A stream that cannot even supply a control byte fails instead.
		await expect(extract(complete.subarray(0, HEADER_SIZE))).rejects.toThrow();
		// But a literal the stream has no bytes for is not an error: the reference ignores what its read
		// returned, so the pixel stays as it was allocated — and the loop ends because the image is full.
		const missing = await extract(complete.subarray(0, complete.length - 3));
		expect(missing.subarray(54)).toEqual(Buffer.alloc(4, 0x00));
	});
});
