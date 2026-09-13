import { BufferByteSource } from "@garbro-mcp/core";
import { abmFormat, abmImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x46;
const PALETTE_OFFSET = 0x36;
const PALETTE_BYTES = 0x400;

interface AbmOptions {
	mode?: number;
	width?: number;
	height?: number;
	count?: number;
	frameOffset?: number;
	unpackedSize?: number;
	palette?: Buffer;
	marker?: string;
}

/** The header is a bitmap header the format reuses: sizes at the bitmap's offsets, the mode at 0x1C. */
function buildAbm(body: Buffer, options: AbmOptions = {}): Buffer {
	const palette = options.palette ?? Buffer.alloc(0);
	// The palette sits at 0x36, inside the region the metadata is read from, so the header grows to hold it.
	const header: Buffer = Buffer.alloc(
		Math.max(HEADER_SIZE, PALETTE_OFFSET + palette.length),
		0x00,
	);
	header.write(options.marker ?? "BM", 0, "latin1");
	header.writeUInt32LE(options.unpackedSize ?? body.length, 2);
	const offset = options.frameOffset ?? header.length;
	if ((options.mode ?? 0) === 1 || (options.mode ?? 0) === 2) {
		header.writeUInt16LE(options.count ?? 1, 0x3a);
		header.writeUInt32LE(offset, 0x42);
	} else {
		header.writeUInt32LE(offset, 0x0a);
	}
	header.writeUInt32LE(options.width ?? 4, 0x12);
	header.writeUInt32LE(options.height ?? 2, 0x16);
	header.writeInt16LE(options.mode ?? 24, 0x1c);
	if (palette.length > 0) palette.copy(header, PALETTE_OFFSET);
	return Buffer.concat([header, body]);
}

/** A colour ramp with distinct channels, so weaving mistakes are visible. */
function pixels24(count: number, seed = 1): number[] {
	const out: number[] = [];
	for (let index = 0; index < count; index += 1) {
		out.push((seed * 3 + index * 2) & 0xff);
	}
	return out;
}

type Op24 =
	| { kind: "literal"; marker: number; value: number }
	| { kind: "run"; bytes: number[] }
	| { kind: "skip"; count: number }
	| { kind: "empty" };

/** The twenty four bit stream: each literal is a marker byte and then the byte it stores. */
function stream24(ops: Op24[]): Buffer {
	const out: number[] = [];
	for (const op of ops) {
		if (op.kind === "literal") out.push(op.marker, op.value);
		else if (op.kind === "run") out.push(0xff, op.bytes.length, ...op.bytes);
		else if (op.kind === "skip") out.push(0x00, op.count);
		else out.push(0x00, 0x00);
	}
	return Buffer.from(out);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.abm"): Promise<Buffer> {
	const archive = await abmImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("lilim compressed bitmap", () => {
	it("is a separate format from the archive opener", async () => {
		expect(abmImageFormat.descriptor.id).toBe("lilim-abm-image");
		expect(abmFormat.descriptor.id).toBe("lilim-abm");
		const file = buildAbm(
			stream24([{ kind: "literal", marker: 1, value: 0x10 }]),
			{
				mode: 24,
			},
		);
		expect(await abmImageFormat.detect(sourceOf(file), "A.abm")).toBe(true);
		expect(await abmFormat.detect(sourceOf(file), "A.abm")).toBe(false);
	});

	it("accepts exactly the six modes, with their own guards", async () => {
		const body = stream24([{ kind: "literal", marker: 1, value: 0x10 }]);
		for (const mode of [1, 2, 8, -8, 24, 32]) {
			expect(
				await abmImageFormat.detect(
					sourceOf(buildAbm(body, { mode })),
					"A.abm",
				),
			).toBe(true);
		}
		for (const mode of [0, 3, 16, 64, 255, -24]) {
			expect(
				await abmImageFormat.detect(
					sourceOf(buildAbm(body, { mode })),
					"A.abm",
				),
			).toBe(false);
		}
		// Modes one and two carry a frame count of at most 255.
		expect(
			await abmImageFormat.detect(
				sourceOf(buildAbm(body, { mode: 1, count: 0x100 })),
				"A.abm",
			),
		).toBe(false);
		// The other modes decline a file that looks like an ordinary bitmap: a zero size word, or one equal to
		// the file's own length.
		const plain = buildAbm(body, { mode: 24, unpackedSize: 0 });
		expect(await abmImageFormat.detect(sourceOf(plain), "A.abm")).toBe(false);
		const asItsOwnSize = buildAbm(body, { mode: 24 });
		asItsOwnSize.writeUInt32LE(asItsOwnSize.length, 2);
		expect(await abmImageFormat.detect(sourceOf(asItsOwnSize), "A.abm")).toBe(
			false,
		);
		// A foreign first byte, and a frame that starts past the end.
		expect(
			await abmImageFormat.detect(
				sourceOf(buildAbm(body, { mode: 24, marker: "XM" })),
				"A.abm",
			),
		).toBe(false);
		expect(
			await abmImageFormat.detect(
				sourceOf(
					buildAbm(body, { mode: 24, frameOffset: HEADER_SIZE + body.length }),
				),
				"A.abm",
			),
		).toBe(false);
	});

	it("reports the dimensions and the mode's own bit depth", async () => {
		const cases: Array<[number, number]> = [
			[8, 8],
			[-8, 24],
			[24, 24],
			[32, 24],
			[1, 24],
			[2, 24],
		];
		for (const [mode, bitsPerPixel] of cases) {
			const file = buildAbm(Buffer.alloc(0x400, 0), {
				mode,
				width: 5,
				height: 3,
				...(mode === 8 || mode === -8
					? { palette: Buffer.alloc(PALETTE_BYTES, 0) }
					: {}),
			});
			const archive = await abmImageFormat.open(sourceOf(file), "A.abm");
			try {
				expect(archive.metadata).toMatchObject({ mode, bitsPerPixel });
				expect(archive.entries[0]?.metadata).toMatchObject({
					width: 5,
					height: 3,
					bitsPerPixel,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("copies a mode one image", async () => {
		// Four rows of four pixels at three bytes each: forty eight stored bytes copied as they are.
		const body = Buffer.from(pixels24(48, 3));
		const output = await extract(
			buildAbm(body, { mode: 1, width: 4, height: 4 }),
		);
		expect(output.readUInt16LE(28)).toBe(24);
		expect(output.readInt32LE(22)).toBe(-4);
		expect(output.subarray(54)).toEqual(body);
		// A body shorter than the image is an error rather than a padded image.
		await expect(
			extract(buildAbm(body.subarray(0, 47), { mode: 1, width: 4, height: 4 })),
		).rejects.toThrow();
	});

	it("reads the twenty four bit run stream", async () => {
		// A literal, a skipped pixel, a run of three, then two more literals with different markers: the marker
		// of a single literal is discarded, so its value does not reach the image.
		const ops: Op24[] = [
			{ kind: "literal", marker: 0x11, value: 0xa1 },
			{ kind: "skip", count: 1 },
			{ kind: "run", bytes: [0xb1, 0xb2, 0xb3] },
			{ kind: "literal", marker: 0x22, value: 0xc1 },
			{ kind: "literal", marker: 0x33, value: 0xc2 },
		];
		const output = await extract(
			buildAbm(stream24(ops), { mode: 24, width: 2, height: 1 }),
		);
		expect(output.subarray(54, 60)).toEqual(
			Buffer.from([0xa1, 0x00, 0xb1, 0xb2, 0xb3, 0xc1]),
		);
		// Six bytes a row are padded to eight, so the last two bytes are the row's own padding.
		expect(output.length).toBe(54 + 8);
		// The same stream with different marker values gives the same image.
		const other = ops.map((op) =>
			op.kind === "literal" ? { ...op, marker: 0x7f } : op,
		) as Op24[];
		expect(
			await extract(
				buildAbm(stream24(other), { mode: 24, width: 2, height: 1 }),
			),
		).toEqual(output);
	});

	it("weaves alpha through the thirty two bit stream", async () => {
		// Three literals make one pixel: the payloads are the colour and the **last marker** becomes the alpha.
		const ops: Op24[] = [
			{ kind: "literal", marker: 0xaa, value: 0x01 },
			{ kind: "literal", marker: 0xbb, value: 0x02 },
			{ kind: "literal", marker: 0xcc, value: 0x03 },
			{ kind: "run", bytes: [0x04, 0x05, 0x06] },
		];
		const output = await extract(
			buildAbm(stream24(ops), { mode: 32, width: 2, height: 1 }),
		);
		expect(output.subarray(54, 62)).toEqual(
			// Blue, green, red from the payloads, then the marker that completed the pixel as its alpha.
			Buffer.from([0x01, 0x02, 0x03, 0xcc, 0x04, 0x05, 0x06, 0xff]),
		);
	});

	it("reads the eight bit alpha stream", async () => {
		// Two palette slots with distinct colours, and a stream that writes one literal, skips one, then runs
		// two opaque pixels.
		const palette: Buffer = Buffer.alloc(PALETTE_BYTES, 0x00);
		palette[4] = 0x30; // index one: blue
		palette[5] = 0x40;
		palette[6] = 0x50;
		palette[8] = 0x60; // index two
		palette[9] = 0x70;
		palette[10] = 0x80;
		const body = Buffer.from([0x80, 0x01, 0x00, 0x01, 0xff, 0x02, 0x02, 0x01]);
		const output = await extract(
			buildAbm(body, { mode: -8, width: 4, height: 1, palette }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(54)).toEqual(
			Buffer.from([
				0x30,
				0x40,
				0x50,
				0x80, // index one with the marker as alpha
				0x00,
				0x00,
				0x00,
				0x00, // the skipped pixel
				0x60,
				0x70,
				0x80,
				0xff, // index two, opaque from the run
				0x30,
				0x40,
				0x50,
				0xff, // the run's second payload is index one
			]),
		);
	});

	it("reads a plain eight bit image with its palette", async () => {
		const palette: Buffer = Buffer.alloc(PALETTE_BYTES, 0x00);
		for (let index = 0; index < PALETTE_BYTES; index += 1) {
			palette[index] = index & 0xff;
		}
		const body = Buffer.from([2, 3, 4, 5]);
		const output = await extract(
			buildAbm(body, { mode: 8, width: 4, height: 1, palette }),
		);
		expect(output.readUInt16LE(28)).toBe(8);
		expect(output.readUInt32LE(46)).toBe(256);
		expect(output.subarray(54, 54 + PALETTE_BYTES)).toEqual(palette);
		expect(output.subarray(54 + PALETTE_BYTES)).toEqual(
			Buffer.from([2, 3, 4, 5]),
		);
		// A body that cannot fill the image fails.
		await expect(
			extract(
				buildAbm(body.subarray(0, 3), {
					mode: 8,
					width: 4,
					height: 1,
					palette,
				}),
			),
		).rejects.toThrow();
	});

	it("reads a mode two frame with its own dimensions", async () => {
		const header: Buffer = Buffer.alloc(17, 0x00);
		header.writeInt32LE(0, 0);
		header.writeInt32LE(0, 4);
		header.writeInt32LE(2, 8);
		header.writeInt32LE(1, 12);
		header[16] = 0x05; // the position byte, never read
		const ops: Op24[] = [
			{ kind: "literal", marker: 0x90, value: 0x11 },
			{ kind: "literal", marker: 0x91, value: 0x22 },
			{ kind: "literal", marker: 0x92, value: 0x33 },
			{ kind: "literal", marker: 0x93, value: 0x44 },
			{ kind: "literal", marker: 0x94, value: 0x55 },
			{ kind: "literal", marker: 0x95, value: 0x66 },
		];
		const body = Buffer.concat([header, stream24(ops)]);
		const output = await extract(
			buildAbm(body, { mode: 2, width: 8, height: 8 }),
		);
		// The frame says two by one, and that is the size of the bitmap it produces.
		expect(output.readInt32LE(18)).toBe(2);
		expect(output.readInt32LE(22)).toBe(-1);
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x92, 0x44, 0x55, 0x66, 0x95]),
		);
		// A frame with a negative origin or an empty size is not a frame.
		for (const [x, w] of [
			[-1, 2],
			[0, 0],
			[0, -2],
		] as const) {
			const broken = Buffer.from(header);
			broken.writeInt32LE(x, 0);
			broken.writeInt32LE(w, 8);
			await expect(
				extract(buildAbm(Buffer.concat([broken, stream24(ops)]), { mode: 2 })),
			).rejects.toThrow();
		}
	});
});
